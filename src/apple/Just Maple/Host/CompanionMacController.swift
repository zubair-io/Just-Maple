import AppKit
import CloudKit
import Observation
import MapleCore
import MapleCompanionTransport

@MainActor protocol CompanionMacMailbox {
    func pending(limit: Int) async throws -> [SyncRequest]
    func acknowledge(deviceID: UUID, captureIDs: [UUID]) async throws
    func pendingActions() async throws -> [SyncDeviceTaskAction]
    func acknowledgeAction(deviceID:UUID,receipt:SyncTaskActionReceipt) async throws
    func publishSnapshot(_ response: SyncResponse) async throws
}
extension CloudCompanionMailbox: CompanionMacMailbox {}
extension CompanionMacMailbox {
    func pendingActions()async throws->[SyncDeviceTaskAction]{[]}
    func acknowledgeAction(deviceID:UUID,receipt:SyncTaskActionReceipt)async throws{throw CloudMailboxError.invalidPayload}
}

@MainActor struct CompanionMacDependencies {
    typealias Handler = @MainActor @Sendable (Data) async throws -> Data
    typealias Authorization = @MainActor () async throws -> Void
    var cloud: CloudCompanionIdentity
    var preferences: UserDefaults
    var loadLocal: (String) throws -> Data?
    var saveLocal: (String, Data) throws -> Void
    var deleteLocal: (String) throws -> Void
    var start: (PairingConfiguration, @escaping Handler) async throws -> Void
    var stop: () -> Void
    var isListening: () -> Bool
    var mailboxFactory: ((PairingConfiguration, String, @escaping Authorization) -> any CompanionMacMailbox)?
    var automaticMonitoring = true
    var alert: ((NSAlert) async -> NSApplication.ModalResponse)?
    static func native() -> Self {
        let server = CompanionTransportServer()
        let service = "com.just.maple.companion.mac"
        let cloud = CloudCompanionIdentity()
        return Self(cloud: cloud, preferences: .standard,
                    loadLocal: { try PairingKeychain.load(service: service, account: $0) },
                    saveLocal: { try PairingKeychain.save($1, service: service, account: $0) },
                    deleteLocal: { try PairingKeychain.delete(service: service, account: $0) },
                    start: { try await server.start(configuration: $0, handler: $1) },
                    stop: { server.stop() }, isListening: { server.port != nil },
                    mailboxFactory: { configuration, account, authorize in
                        CloudCompanionMailbox(configuration: configuration, accountID: account, accountCheck: authorize)
                    })
    }
}

@MainActor @Observable final class CompanionMacController {
    private struct Record: Codable {var configuration:PairingConfiguration;var deviceID:UUID}
    private let dependencies: CompanionMacDependencies
    private var listenerSession: UUID?
    init(dependencies: CompanionMacDependencies? = nil) { self.dependencies = dependencies ?? .native();self.dependencies.preferences.removeObject(forKey:"companionCloudPaused");self.dependencies.preferences.removeObject(forKey:"companionManualMode") }
    private struct CloudBinding:Codable {var accountID:String;var configuration:PairingConfiguration;var published:Bool}
    private var cloud: CloudCompanionIdentity { dependencies.cloud }
    private var cloudBinding:CloudBinding?
    private var cloudConfiguration:PairingConfiguration?
    private var cloudLoop:Task<Void,Never>?
    private var accountObserver:NSObjectProtocol?
    private var cloudGeneration=0
    private var cloudBusy=false
    private var mailbox: (any CompanionMacMailbox)?
    private var publishedSnapshot: Data?
    private var publishedAt: Date?
    var cloudEnabled:Bool {!dependencies.preferences.bool(forKey:"companionCloudPaused") && !dependencies.preferences.bool(forKey:"companionManualMode")}
    private var record:Record?
    private var invitation:PairingConfiguration?
    private var approving=false
    private var copiedCode:String?
    private var expiryTask:Task<Void,Never>?
    var status="Not paired"
    var paired:Bool {record != nil || cloudConfiguration != nil}
    private weak var model:AppModel?

    func restore(model:AppModel)async {
        self.model=model
        if dependencies.automaticMonitoring, accountObserver==nil {
            accountObserver=NotificationCenter.default.addObserver(forName:.CKAccountChanged,object:nil,queue:.main){[weak self] _ in
                Task{@MainActor in self?.invalidateCloud();await self?.cloudTick()}
            }
        }
        if cloudEnabled {
            if !dependencies.automaticMonitoring { await cloudTick(); return }
            cloudLoop?.cancel()
            cloudLoop=Task{[weak self] in
                while !Task.isCancelled {await self?.cloudTick();try? await Task.sleep(for:.seconds(20))}
            }
            return
        }
        guard dependencies.preferences.bool(forKey:"companionManualMode") else{status="iCloud connection paused";return}
        do {
            guard let data=try dependencies.loadLocal("phone") else{return}
            let saved=try SyncCodec.decode(Record.self,from:data)
            record=saved
            try await listen(saved.configuration)
            status="Paired · ready when your iPhone connects"
        } catch {status="Could not start iPhone connection. Pair again to retry."}
    }
    func invite(model:AppModel)async throws {
        self.model=model
        cloudLoop?.cancel();invalidateCloud()
        dependencies.preferences.set(true,forKey:"companionManualMode")
        guard record==nil else{throw MapleError.invalid("Disconnect the current iPhone before pairing another.")}
        expiryTask?.cancel();stopListener();clearCode()
        let config=try PairingConfiguration.create(expiresAt:Date().addingTimeInterval(300))
        invitation=config
        try await listen(config)
        status="Waiting for iPhone · code expires in 5 minutes"
        let code=try SyncCodec.encode(config).base64EncodedString()
        let alert=NSAlert();alert.messageText="Connect your iPhone"
        alert.informativeText="On your iPhone, choose Connect Mac and paste this code. Keep both apps open on the same network. Only share this code with your own phone. You will approve the phone here before it receives any data."
        let field=NSTextField(wrappingLabelWithString:code);field.isSelectable=true;field.frame=NSRect(x:0,y:0,width:420,height:110)
        alert.accessoryView=field;alert.addButton(withTitle:"Copy code");alert.addButton(withTitle:"Cancel pairing")
        let choice=await show(alert)
        guard invitation?.id==config.id else{return}
        if choice == .alertFirstButtonReturn {
            NSPasteboard.general.clearContents();NSPasteboard.general.setString(code,forType:.string);copiedCode=code
            expiryTask=Task { [weak self] in
                try? await Task.sleep(for:.seconds(300))
                guard !Task.isCancelled,let self,self.record==nil,self.invitation?.id==config.id else{return}
                self.stopListener();self.invitation=nil;self.status="Pairing code expired. Create a new code to retry."
                // Remove only our own unchanged clipboard item.
                if NSPasteboard.general.string(forType:.string)==code {NSPasteboard.general.clearContents()}
            }
        } else {stopListener();invitation=nil;status="Not paired"}
    }
    func disconnect()throws {
        // Stop first, including in-flight handlers; authorization is rechecked after awaits.
        dependencies.preferences.set(true,forKey:"companionCloudPaused")
        dependencies.preferences.set(false,forKey:"companionManualMode")
        cloudLoop?.cancel();invalidateCloud()
        stopListener();expiryTask?.cancel();record=nil;invitation=nil;clearCode()
        try dependencies.deleteLocal("phone")
        status="Not paired"
    }
    private func stopListener(session: UUID? = nil) {
        if let session, listenerSession != session { return }
        listenerSession = nil
        dependencies.stop()
    }
    private func listen(_ config:PairingConfiguration)async throws {
        let session = UUID()
        listenerSession = session
        do {
            try await dependencies.start(config){[weak self] data in
                guard let self, self.listenerSession == session else{throw MapleError.invalid("Mac unavailable.")}
                return try await self.receive(data,configuration:config)
            }
        } catch {
            stopListener(session: session)
            throw error
        }
    }
    func receive(_ data:Data,configuration:PairingConfiguration)async throws->Data {
        let request=try SyncCodec.decode(SyncRequest.self,from:data)
        guard request.version==1,request.captures.count<=8,["pair","sync"].contains(request.operation),
              request.operation != "pair" || request.captures.isEmpty else{throw MapleError.invalid("Unsupported companion request.")}
        if cloudConfiguration?.id==configuration.id {
            guard let binding=cloudBinding,cloudEnabled else{throw MapleError.invalid("iCloud connection paused.")}
            let generation=cloudGeneration
            try await validateCloud(configuration: configuration, accountID: binding.accountID, generation: generation)
            guard let store=model?.store else{throw MapleError.invalid("Mac unavailable.")}
            var receipts:[UUID]=[]
            for capture in request.captures {
                try Task.checkCancellation()
                guard generation==cloudGeneration,cloudEnabled else{throw MapleError.invalid("Connection paused.")}
                let receipt=try await store.ingestCompanionCapture(.init(id:capture.id,text:capture.text,createdAt:capture.createdAt),authenticatedDeviceID:request.deviceID)
                receipts.append(receipt.id)
            }
            let world=try await store.worldSnapshot()
            let people=try await store.people(limit:12)
            try await validateCloud(configuration: configuration, accountID: binding.accountID, generation: generation)
            status="Connected through iCloud · last sync \(Date().formatted(date:.omitted,time:.shortened))"
            return try SyncCodec.encode(CompanionSyncProjection.make(world:world,deviceID:request.deviceID,receivedIDs:receipts,people:people))
        }
        if record==nil {
            guard request.operation=="pair",invitation?.id==configuration.id,
                  let expiry=configuration.expiresAt,expiry>Date(),!approving else{throw MapleError.invalid("Pair on your Mac first.")}
            approving=true
            defer{approving=false}
            let alert=NSAlert();alert.messageText="Allow this iPhone to connect?"
            alert.informativeText="Approve only if you just pasted your pairing code into your iPhone. It can send captures to this Mac and read your tasks and current state. Device: \(request.deviceID.uuidString.suffix(8))"
            alert.addButton(withTitle:"Allow iPhone");alert.addButton(withTitle:"Decline")
            let choice=await show(alert)
            try Task.checkCancellation()
            guard choice == .alertFirstButtonReturn,invitation?.id==configuration.id,expiry>Date() else{throw MapleError.invalid("Pairing was not approved.")}
            let saved=Record(configuration:configuration,deviceID:request.deviceID)
            try dependencies.saveLocal("phone", SyncCodec.encode(saved))
            record=saved;invitation=nil;expiryTask?.cancel();clearCode()
        }
        guard let record,record.configuration.id==configuration.id,record.deviceID==request.deviceID,
              let store=model?.store else{throw MapleError.invalid("This device is not paired.")}
        var receipts:[UUID]=[]
        for capture in request.captures {
            guard self.record?.configuration.id==configuration.id else{throw MapleError.invalid("Device disconnected.")}
            let receipt=try await store.ingestCompanionCapture(.init(id:capture.id,text:capture.text,createdAt:capture.createdAt),authenticatedDeviceID:record.deviceID)
            receipts.append(receipt.id)
        }
        let world=try await store.worldSnapshot()
            let people=try await store.people(limit:12)
        guard self.record?.configuration.id==configuration.id else{throw MapleError.invalid("Device disconnected.")}
        status="Paired · last connected \(Date().formatted(date:.omitted,time:.shortened))"
        // Acknowledged IDs come only from committed ingestion; a lost reply is safe to retry.
        return try SyncCodec.encode(CompanionSyncProjection.make(world:world,deviceID:record.deviceID,receivedIDs:receipts,people:people))
    }
    private func invalidateCloud(){
        cloudGeneration+=1
        if cloudConfiguration != nil {stopListener()}
        cloudConfiguration=nil
        mailbox=nil;publishedSnapshot=nil;publishedAt=nil
        if cloudEnabled {status="Checking your iCloud account…"}
    }
    private func validateCloud(configuration: PairingConfiguration, accountID: String, generation: Int) async throws {
        guard generation == cloudGeneration, cloudEnabled, cloudConfiguration == configuration else { throw MapleError.invalid("Connection paused.") }
        do {
            let current = try await cloud.accountID()
            guard generation == cloudGeneration, cloudEnabled,
                  cloudConfiguration == configuration else { throw MapleError.invalid("Connection paused.") }
            guard current == accountID, try cloud.load(accountID: current) == configuration else {
                invalidateCloud()
                throw MapleError.invalid("iCloud connection changed.")
            }
        } catch {
            // A stale request must never invalidate a newer manual/cloud listener.
            if generation == cloudGeneration { invalidateCloud() }
            throw error
        }
    }
    func enableCloud(model:AppModel)async throws {
        self.model=model
        cloudLoop?.cancel(); invalidateCloud(); stopListener()
        record=nil;invitation=nil;expiryTask?.cancel();clearCode()
        dependencies.preferences.set(true,forKey:"companionCloudPaused")
        let generation = cloudGeneration
        // Verify workspace ownership before changing modes or granting fresh publication permission.
        if let data=try dependencies.loadLocal("cloud-owner") {
            var binding=try SyncCodec.decode(CloudBinding.self,from:data)
            let account = try await cloud.accountID()
            guard generation == cloudGeneration else { throw MapleError.invalid("Connection changed.") }
            guard account==binding.accountID else{throw MapleError.invalid("This workspace belongs to a different iCloud account. Sign back into that account.")}
            binding.published=false
            try dependencies.saveLocal("cloud-owner", SyncCodec.encode(binding))
        }
        guard generation == cloudGeneration else { throw MapleError.invalid("Connection changed.") }
        dependencies.preferences.set(false,forKey:"companionCloudPaused")
        dependencies.preferences.set(false,forKey:"companionManualMode")
        await restore(model:model)
    }
    func cloudTick()async {
        guard cloudEnabled,!cloudBusy else{return}
        cloudBusy=true;defer{cloudBusy=false}
        let generation=cloudGeneration
        do {
            let account=try await cloud.accountID()
            guard generation==cloudGeneration,cloudEnabled else{return}
            var binding:CloudBinding
            if let data=try dependencies.loadLocal("cloud-owner") {
                binding=try SyncCodec.decode(CloudBinding.self,from:data)
                guard binding.accountID==account else {
                    invalidateCloud();status="iCloud account changed. Sharing is stopped; sign back into this workspace’s account.";return
                }
            } else {
                guard try cloud.load(accountID:account)==nil else{invalidateCloud();status="Another Mac owns this iCloud connection. Open Maple on that Mac.";return}
                binding=CloudBinding(accountID:account,configuration:try PairingConfiguration.create(),published:false)
                try dependencies.saveLocal("cloud-owner", SyncCodec.encode(binding))
            }
            let config:PairingConfiguration
            if let saved=try cloud.load(accountID:account) {config=saved}
            else {config=try cloud.publishNew(accountID:account,configuration:binding.configuration)}
            guard config==binding.configuration else {invalidateCloud();status="Another Mac owns this iCloud connection.";return}
            if !binding.published {binding.published=true;try dependencies.saveLocal("cloud-owner", SyncCodec.encode(binding))}
            cloudBinding=binding
            if cloudConfiguration != config || !dependencies.isListening() {
                cloudConfiguration=config
                do { try await listen(config) }
                catch {
                    guard generation==cloudGeneration,cloudEnabled else{return}
                    // Nearby discovery is optional when the private iCloud mailbox is available.
                    if dependencies.mailboxFactory == nil { throw error }
                }
                guard generation==cloudGeneration,cloudEnabled else{return}
                status="Ready through iCloud · open Maple on your iPhone"
            }
            if let factory = dependencies.mailboxFactory {
                if mailbox == nil {
                    mailbox = factory(config, account) { [weak self] in
                        guard let self else { throw MapleError.invalid("Mac unavailable.") }
                        try await self.validateCloud(configuration: config, accountID: account, generation: generation)
                    }
                }
                if let mailbox {
                    do { try await syncMailbox(mailbox, configuration: config, accountID: account, generation: generation) }
                    catch {
                        guard generation==cloudGeneration,cloudEnabled else{return}
                        status=CloudMailboxError.safeDescription(error)+" Your data is safe; Maple will retry automatically."
                    }
                }
            }
        } catch {
            guard generation == cloudGeneration, cloudEnabled else { return }
            invalidateCloud()
            status="iCloud connection unavailable. Check iCloud sign-in and Keychain sync; Maple will retry."
        }
    }
    private func syncMailbox(_ mailbox: any CompanionMacMailbox, configuration: PairingConfiguration,
                             accountID: String, generation: Int) async throws {
        guard let store = model?.store else { throw MapleError.invalid("Mac data is not ready.") }
        try await validateCloud(configuration: configuration, accountID: accountID, generation: generation)
        let actions=try await mailbox.pendingActions()
        for envelope in actions.prefix(32) {
            try await validateCloud(configuration:configuration,accountID:accountID,generation:generation)
            let action=envelope.action
            guard action.valid,action.intent == nil,let status=TaskStatus(rawValue:action.status) else{throw CloudMailboxError.invalidPayload}
            let outcome:String
            do {
                _ = try await store.correctTaskInference(nodeID:action.taskID,status:status,separate:false,expectedVersion:action.expectedVersion,requestID:"companion-action:"+envelope.deviceID.uuidString.lowercased()+":"+action.id.uuidString.lowercased())
                outcome="applied"
            } catch MapleError.invalid {outcome="conflict"}
            try await validateCloud(configuration:configuration,accountID:accountID,generation:generation)
            try await mailbox.acknowledgeAction(deviceID:envelope.deviceID,receipt:.init(id:action.id,outcome:outcome))
        }
        let pending = try await mailbox.pending(limit: 32)
        try await validateCloud(configuration: configuration, accountID: accountID, generation: generation)
        var needsRetry = false
        for request in pending.prefix(32) {
            guard request.version == 1, request.operation == "sync", request.captures.count <= 8 else { needsRetry = true; continue }
            var receipts: [UUID] = []
            for capture in request.captures {
                try Task.checkCancellation()
                try await validateCloud(configuration: configuration, accountID: accountID, generation: generation)
                do {
                    let receipt = try await store.ingestCompanionCapture(.init(id: capture.id, text: capture.text, createdAt: capture.createdAt), authenticatedDeviceID: request.deviceID)
                    receipts.append(receipt.id)
                } catch { needsRetry = true }
                try await validateCloud(configuration: configuration, accountID: accountID, generation: generation)
            }
            if !receipts.isEmpty {
                try await mailbox.acknowledge(deviceID: request.deviceID, captureIDs: Array(Set(receipts)))
                try await validateCloud(configuration: configuration, accountID: accountID, generation: generation)
            }
        }
        let world = try await store.worldSnapshot()
        let people = try await store.people(limit: 12)
        try await validateCloud(configuration: configuration, accountID: accountID, generation: generation)
        let response = CompanionSyncProjection.make(world: world, deviceID: configuration.id, receivedIDs: [], people: people, displayName: model?.name)
        var comparable = response; comparable.asOf = Date(timeIntervalSince1970: 0)
        let fingerprint = try JSONSerialization.data(withJSONObject: JSONSerialization.jsonObject(with: SyncCodec.encode(comparable)), options: [.sortedKeys])
        if fingerprint != publishedSnapshot || publishedAt.map({ Date().timeIntervalSince($0) >= 300 }) != false {
            try await mailbox.publishSnapshot(response)
            try await validateCloud(configuration: configuration, accountID: accountID, generation: generation)
            publishedSnapshot = fingerprint; publishedAt = Date()
        }
        status = needsRetry ? "iCloud synced; some captures need a retry. Original notes remain on your iPhone." : "Synced through iCloud · last checked \(Date().formatted(date: .omitted, time: .shortened))"
    }
    private func clearCode(){
        if let copiedCode,NSPasteboard.general.string(forType:.string)==copiedCode {NSPasteboard.general.clearContents()}
        copiedCode=nil
    }
    private func show(_ alert:NSAlert)async->NSApplication.ModalResponse {
        if let show = dependencies.alert { return await show(alert) }
        if let window=NSApp.keyWindow ?? NSApp.windows.first(where:{$0.isVisible}) {
            return await withTaskCancellationHandler {
                await withCheckedContinuation{continuation in alert.beginSheetModal(for:window){continuation.resume(returning:$0)}}
            } onCancel: {
                Task { @MainActor in if alert.window.sheetParent != nil {NSApp.endSheet(alert.window,returnCode:NSApplication.ModalResponse.cancel.rawValue)} }
            }
        }
        return alert.runModal()
    }
}
