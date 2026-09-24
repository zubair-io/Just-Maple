import UIKit
import CloudKit
import MapleCompanionTransport

@MainActor protocol PhoneCloudMailbox {
    func uploadActions(deviceID:UUID,actions:[SyncTaskAction])async throws
    func actionReceipts(deviceID:UUID,ids:[UUID])async throws->[SyncTaskActionReceipt]
    func upload(_ request:SyncRequest) async throws
    func snapshot(deviceID:UUID) async throws -> SyncResponse?
    func receipts(deviceID:UUID,captureIDs:[UUID]) async throws -> [UUID]
}
extension CloudCompanionMailbox: PhoneCloudMailbox {}
extension PhoneCloudMailbox {
    func uploadActions(deviceID:UUID,actions:[SyncTaskAction])async throws {if !actions.isEmpty {throw CloudMailboxError.invalidPayload}}
    func actionReceipts(deviceID:UUID,ids:[UUID])async throws->[SyncTaskActionReceipt]{guard ids.isEmpty else{throw CloudMailboxError.invalidPayload};return []}
}

@MainActor struct PhoneSyncDependencies {
    var accountID:() async throws -> String
    var load:(String) throws -> PairingConfiguration?
    var mailbox:(PairingConfiguration,String,@escaping @MainActor () async throws -> Void) -> any PhoneCloudMailbox
    static func live() -> Self {
        let cloud=CloudCompanionIdentity()
        return Self(accountID:{try await cloud.accountID()},load:{try cloud.load(accountID:$0)},
                    mailbox:{config,account,check in CloudCompanionMailbox(configuration:config,accountID:account,accountCheck:check)})
    }
}

@MainActor final class CompanionSync {
    private let service="com.just.maple.companion.iphone"
    private let store:CompanionStore
    private var configuration:PairingConfiguration?
    private let dependencies:PhoneSyncDependencies
    private let preferences:UserDefaults
    private var cloudAccount:String?
    private var accountObserver:NSObjectProtocol?
    private var activeObserver:NSObjectProtocol?
    var cloudEnabled:Bool {!preferences.bool(forKey:"companionCloudPaused") && !preferences.bool(forKey:"companionManualMode")}
    private var active=false
    private var generation=0
    private var loop:Task<Void,Never>?
    var status="Connecting to iCloud…"
    var paired:Bool {configuration != nil}
    init(store:CompanionStore, dependencies:PhoneSyncDependencies?=nil, preferences:UserDefaults = .standard){self.store=store;self.dependencies=dependencies ?? .live();self.preferences=preferences;preferences.removeObject(forKey:"companionCloudPaused");preferences.removeObject(forKey:"companionManualMode")}
    func start() {
        guard !ProcessInfo.processInfo.arguments.contains("--companion-ui-test"), NSClassFromString("XCTestCase")==nil else{return}
        status=cloudEnabled ? "Checking iCloud…" : "Connection paused"
        do {
            if preferences.bool(forKey:"companionManualMode"),let data=try PairingKeychain.load(service:service,account:"mac") {configuration=try SyncCodec.decode(PairingConfiguration.self,from:data);status="Waiting for your Mac"}
        } catch {status="Could not open Mac pairing. Connect Mac to retry."}
        accountObserver=NotificationCenter.default.addObserver(forName:.CKAccountChanged,object:nil,queue:.main){[weak self] _ in
            Task{@MainActor in
                guard let self,self.cloudEnabled else{return}
                self.generation+=1;self.configuration=nil;self.cloudAccount=nil
                try? self.store.clearMac()
                self.status="iCloud account changed. Checking before syncing…"
            }
        }
        activeObserver=NotificationCenter.default.addObserver(forName:UIApplication.didBecomeActiveNotification,object:nil,queue:.main){[weak self] _ in Task{@MainActor in await self?.sync()}}
        loop?.cancel()
        loop=Task{[weak self] in
            while !Task.isCancelled {
                if UIApplication.shared.applicationState == .active {await self?.sync()}
                try? await Task.sleep(for:.seconds(20))
            }
        }
    }
    func stop(){generation+=1;loop?.cancel();loop=nil;if let accountObserver {NotificationCenter.default.removeObserver(accountObserver)};accountObserver=nil;if let activeObserver {NotificationCenter.default.removeObserver(activeObserver)};activeObserver=nil}
    func pair(presenter:UIViewController)async throws {
        guard !active else{return}
        preferences.set(true,forKey:"companionManualMode")
        generation+=1;configuration=nil;cloudAccount=nil
        active=true;let started=generation
        defer{active=false;if configuration==nil {status="Not paired yet"}}
        let alert=UIAlertController(title:"Connect your Mac",message:"On your Mac, open Connections → iPhone companion → Pair iPhone. Paste its temporary code here, then approve this phone on your Mac.",preferredStyle:.alert)
        alert.addTextField{$0.placeholder="Pairing code";$0.autocorrectionType = .no;$0.autocapitalizationType = .none;$0.isSecureTextEntry=true}
        let code:String?=await withCheckedContinuation{continuation in
            alert.addAction(UIAlertAction(title:"Cancel",style:.cancel){_ in continuation.resume(returning:nil)})
            alert.addAction(UIAlertAction(title:"Connect",style:.default){_ in continuation.resume(returning:alert.textFields?.first?.text)})
            presenter.present(alert,animated:true)
        }
        guard let code else{return}
        guard code.utf8.count<4096,let data=Data(base64Encoded:code.trimmingCharacters(in:.whitespacesAndNewlines)) else{throw CompanionError.invalidPairing}
        let config=try SyncCodec.decode(PairingConfiguration.self,from:data)
        guard let expiry=config.expiresAt,expiry>Date(),expiry<Date().addingTimeInterval(600),config.secret.count==32 else{throw CompanionError.invalidPairing}
        guard let device=UUID(uuidString:store.snapshot.deviceID) else{throw CompanionError.storageUnavailable}
        status="Approve this iPhone on your Mac"
        let request=SyncRequest(deviceID:device,operation:"pair")
        let reply=try await CompanionTransportClient.exchange(configuration:config,payload:SyncCodec.encode(request))
        guard generation==started else{throw CompanionError.invalidPairing}
        let response=try SyncCodec.decode(SyncResponse.self,from:reply)
        guard response.deviceID==device,response.version==1,response.receivedIDs.isEmpty else{throw CompanionError.invalidPairing}
        try PairingKeychain.save(SyncCodec.encode(config),service:service,account:"mac")
        configuration=config;generation+=1
        try store.accept(response,sentIDs:[])
        status="Connected to your Mac"
        // Background loop handles any pending captures after this pairing command returns.
    }
    func sync()async {
        guard !active,cloudEnabled || preferences.bool(forKey:"companionManualMode") else{return}
        active=true;defer{active=false}
        if cloudEnabled {await refreshCloud()}
        guard let configuration,let device=UUID(uuidString:store.snapshot.deviceID) else{return}
        let started=generation
        do {
            let uploaded=Set(store.snapshot.uploadedIDs ?? [])
            let pending=store.pending
            let ordered=cloudEnabled ? pending.filter{!uploaded.contains($0.id.lowercased())} + pending.filter{uploaded.contains($0.id.lowercased())} : pending
            let captures=try ordered.prefix(8).map {capture -> SyncCapture in
                guard let id=UUID(uuidString:capture.id) else{throw CompanionError.invalidCapture}
                return .init(id:id,text:capture.text,createdAt:capture.createdAt)
            }
            let request=SyncRequest(deviceID:device,operation:"sync",captures:captures)
            if let account=cloudAccount {
                try await syncCloud(configuration:configuration,account:account,request:request,started:started)
                return
            }
            let reply=try await CompanionTransportClient.exchange(configuration:configuration,payload:SyncCodec.encode(request))
            guard generation==started else{return}
            if let account=cloudAccount {
                guard try await dependencies.accountID()==account,generation==started,
                      try dependencies.load(account)==configuration else{throw CompanionError.accountChanged}
            }
            try store.accept(SyncCodec.decode(SyncResponse.self,from:reply),sentIDs:Set(captures.map(\.id)))
            status=store.pending.isEmpty ? "Up to date" : "Sending saved captures…"
        } catch CompanionError.accountChanged {
            guard generation==started else{return}
            generation+=1;self.configuration=nil;cloudAccount=nil;try? store.clearMac()
            status="iCloud connection changed. Waiting to verify your account."
        } catch {
            guard generation==started else{return}
            status=cloudEnabled ? CloudMailboxError.safeDescription(error)+" Your captures are safe; retrying while the app is open." : "Mac unavailable. Your captures are safe; retrying while the app is open."
        }
    }
    private func syncCloud(configuration:PairingConfiguration,account:String,request:SyncRequest,started:Int) async throws {
        let check: @MainActor () async throws -> Void = { [weak self] in
            try Task.checkCancellation()
            guard let self,self.generation==started,self.cloudEnabled else { throw CompanionError.accountChanged }
            guard try await self.dependencies.accountID()==account,self.generation==started,
                  try self.dependencies.load(account)==configuration else { throw CompanionError.accountChanged }
        }
        let mailbox=dependencies.mailbox(configuration,account,check)
        try await check()
        let actions=Array(store.pendingTaskActions.prefix(8))
        if !actions.isEmpty {
            try await mailbox.uploadActions(deviceID:request.deviceID,actions:actions)
            try await check()
            let receipts=try await mailbox.actionReceipts(deviceID:request.deviceID,ids:actions.map(\.id))
            try await check()
            try store.acceptActionReceipts(receipts,sent:Set(actions.map(\.id)))
        }
        try await mailbox.upload(request)
        try await check()
        let sent=Set(request.captures.map(\.id))
        try store.markUploaded(sent)
        let receipts=try await mailbox.receipts(deviceID:request.deviceID,captureIDs:Array(sent))
        try await check()
        try store.acceptReceipts(receipts,sentIDs:sent)
        let response=try await mailbox.snapshot(deviceID:request.deviceID)
        try await check()
        if let response { try store.accept(response,sentIDs:[]) }
        status=store.pending.isEmpty
            ? (response == nil ? "Connected to iCloud. Waiting for your Mac’s first update." : "Synced with iCloud")
            : (store.pending.allSatisfy { (store.snapshot.uploadedIDs ?? []).contains($0.id.lowercased()) }
                ? "Saved in iCloud. Waiting for your Mac to process captures." : "Uploading saved captures to iCloud…")
    }
    func enableCloud()async {
        preferences.set(false,forKey:"companionCloudPaused")
        preferences.set(false,forKey:"companionManualMode")
        generation+=1;configuration=nil;cloudAccount=nil
        await sync()
    }
    private func refreshCloud()async {
        let started=generation
        do {
            let account=try await dependencies.accountID()
            guard generation==started,cloudEnabled else{return}
            try store.bindCloudAccount(account)
            guard let config=try dependencies.load(account) else {
                if configuration != nil {generation+=1}
                configuration=nil;cloudAccount=nil;try store.clearMac()
                status="Waiting for your Mac’s iCloud credential. Open or restart the updated Just Maple app on your Mac, using the same iCloud account with Keychain sync enabled.";return
            }
            if configuration != config {generation+=1;configuration=config}
            cloudAccount=account
            status="Syncing with iCloud…"
        } catch CompanionError.accountChanged {
            guard generation==started,cloudEnabled else{return}
            generation+=1;configuration=nil;cloudAccount=nil
            status="iCloud account changed. Sign back into the account used for these captures."
        } catch CloudCompanionIdentityError.accountUnavailable {
            guard generation==started,cloudEnabled else{return}
            generation+=1;configuration=nil;cloudAccount=nil;try? store.clearMac()
            status="Sign into iCloud to connect your Mac. Your captures stay on this iPhone."
        } catch {
            guard generation==started,cloudEnabled else{return}
            generation+=1;configuration=nil;cloudAccount=nil
            status="iCloud unavailable. Check iCloud sign-in and Keychain sync; your captures stay on this iPhone."
        }
    }
    func disconnect()throws {
        preferences.set(true,forKey:"companionCloudPaused")
        preferences.set(false,forKey:"companionManualMode")
        cloudAccount=nil
        generation+=1;configuration=nil;status="Connection paused"
        try store.clearMac()
        try PairingKeychain.delete(service:service,account:"mac")
    }
}
