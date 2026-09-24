import CryptoKit
import Foundation

/// Encrypted transport only. The Mac's SQLite ingestion remains authoritative. Pending cursor
/// is deliberately process-local: restart rescans durable captures and filters durable receipts.
/// No capture is acknowledged merely because CloudKit accepted its upload.
@MainActor public final class CloudCompanionMailbox {
    private struct CaptureEnvelope:Codable,Equatable {var deviceID:UUID;var capture:SyncCapture}
    private struct Receipt:Codable {var deviceID:UUID;var captureID:UUID}
    private let configuration:PairingConfiguration
    private let accountID:String
    private let store:any CloudMailboxStore
    private let accountCheck:@MainActor ()async throws->Void
    private let scope:String
    private var actionCursor:Data?
    private var waitingActions:[String:SyncDeviceTaskAction]=[:]
    private var cursor:Data?
    private var waiting:[String:CaptureEnvelope]=[:]
    public init(configuration:PairingConfiguration,accountID:String,store:(any CloudMailboxStore)?=nil,
                accountCheck:(@MainActor ()async throws->Void)?=nil) {
        self.configuration=configuration;self.accountID=accountID
        scope=Self.hash("v1|\(accountID)|\(configuration.id.uuidString.lowercased())")
        self.accountCheck=accountCheck ?? {
            let identity=CloudCompanionIdentity()
            guard try await identity.accountID()==accountID,try identity.load(accountID:accountID)==configuration else{throw CloudMailboxError.accountChanged}
        }
        self.store=store ?? NativeCloudMailboxStore(containerIdentifier:CloudCompanionIdentity.defaultContainerIdentifier,zoneName:"maple-\(scope)",accountCheck:self.accountCheck)
    }
    private static func hash(_ value:String)->String {SHA256.hash(data:Data(value.utf8)).map{String(format:"%02x",$0)}.joined()}
    private func captureID(_ device:UUID,_ capture:UUID)->String {Self.hash("\(device.uuidString.lowercased())|\(capture.uuidString.lowercased())")}
    private func check()async throws {
        try Task.checkCancellation()
        guard configuration.secret.count==32,accountID.count==64 else{throw CloudMailboxError.invalidPayload}
        try await accountCheck();try Task.checkCancellation()
    }
    private func fetch(_ ids:[String])async throws->[CloudMailboxRecord] {try await check();do{let result=try await store.fetch(ids);try await check();return result}catch CloudMailboxError.invalidCursor{cursor=nil;throw CloudMailboxError.invalidCursor}}
    private func save(_ record:CloudMailboxRecord)async throws {try await check();do{try await store.save(record);try await check()}catch CloudMailboxError.invalidCursor{cursor=nil;throw CloudMailboxError.invalidCursor}}
    private func seal<T:Encodable>(_ value:T,id:String)throws->Data {
        let data=try SyncCodec.encode(value)
        guard data.count<=CompanionFrame.maximumLength else{throw CloudMailboxError.invalidPayload}
        return try AES.GCM.seal(data,using:SymmetricKey(data:configuration.secret),authenticating:Data("\(scope)|\(id)".utf8)).combined!
    }
    private func open<T:Decodable>(_ type:T.Type,record:CloudMailboxRecord)throws->T {
        guard record.payload.count<=CompanionFrame.maximumLength+28 else{throw CloudMailboxError.invalidPayload}
        let data=try AES.GCM.open(AES.GCM.SealedBox(combined:record.payload),using:SymmetricKey(data:configuration.secret),authenticating:Data("\(scope)|\(record.id)".utf8))
        return try SyncCodec.decode(type,from:data)
    }
    private func validate(_ capture:SyncCapture)throws {
        guard !capture.text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty,capture.text.utf8.count<=16_384,
              capture.createdAt.timeIntervalSince1970.isFinite,capture.createdAt<=Date().addingTimeInterval(300) else{throw CloudMailboxError.invalidPayload}
    }
    public func upload(_ request:SyncRequest)async throws {
        guard request.version==1,request.operation=="sync",request.captures.count<=8,Set(request.captures.map(\.id)).count==request.captures.count else{throw CloudMailboxError.invalidPayload}
        try await check()
        for capture in request.captures {
            try validate(capture)
            let envelope=CaptureEnvelope(deviceID:request.deviceID,capture:capture),id="c-"+captureID(request.deviceID,capture.id)
            if let existing=try await fetch([id]).first {
                guard try open(CaptureEnvelope.self,record:existing)==envelope else{throw CloudMailboxError.conflictingCapture};continue
            }
            do{try await save(.init(id:id,payload:seal(envelope,id:id)))}catch CloudMailboxError.conflict {
                guard let existing=try await fetch([id]).first,try open(CaptureEnvelope.self,record:existing)==envelope else{throw CloudMailboxError.conflictingCapture}
            }
        }
    }
    public func receipts(deviceID:UUID,captureIDs:[UUID])async throws->[UUID] {
        guard captureIDs.count<=32 else{throw CloudMailboxError.invalidPayload}
        let names=captureIDs.map{"r-"+captureID(deviceID,$0)}
        let records=try await fetch(names)
        return try records.map{record in
            let receipt=try open(Receipt.self,record:record)
            guard receipt.deviceID==deviceID,captureIDs.contains(receipt.captureID),record.id=="r-"+captureID(deviceID,receipt.captureID) else{throw CloudMailboxError.invalidPayload}
            return receipt.captureID
        }
    }
    /// Call only after corresponding captures have durably committed through KnowledgeStore.ingest.
    public func acknowledge(deviceID:UUID,captureIDs:[UUID])async throws {
        guard captureIDs.count<=32 else{throw CloudMailboxError.invalidPayload}
        for capture in captureIDs {
            let id="r-"+captureID(deviceID,capture),receipt=Receipt(deviceID:deviceID,captureID:capture)
            do{try await save(.init(id:id,payload:seal(receipt,id:id)))}catch CloudMailboxError.conflict {
                guard try await receipts(deviceID:deviceID,captureIDs:[capture]).contains(capture) else{throw CloudMailboxError.invalidPayload}
            }
            waiting["c-"+captureID(deviceID,capture)]=nil
        }
    }
    /// One bounded zone-change page per call. More pages are consumed by subsequent host polls.
    /// Retained in-flight captures survive page advancement; failures leave them pending.
    public func pending(limit:Int=32)async throws->[SyncRequest] {
        guard (1...32).contains(limit) else{throw CloudMailboxError.invalidPayload}
        try await check()
        if waiting.count<limit {
            let page:CloudMailboxPage
            do{page=try await store.changes(after:cursor,limit:100)}catch CloudMailboxError.invalidCursor {cursor=nil;throw CloudMailboxError.invalidCursor}
            try await check()
            guard page.records.count<=100 else{throw CloudMailboxError.invalidPayload}
            var additions:[String:CaptureEnvelope]=[:]
            for record in page.records where record.id.hasPrefix("c-") {
                let envelope=try open(CaptureEnvelope.self,record:record);try validate(envelope.capture)
                guard record.id=="c-"+captureID(envelope.deviceID,envelope.capture.id) else{throw CloudMailboxError.invalidPayload}
                additions[record.id]=envelope
            }
            waiting.merge(additions){_,new in new};cursor=page.cursor
        }
        // Batch deterministic receipt reads to keep each poll bounded without one CloudKit
        // round-trip per historical capture. At most 131 captures are cached (31 + one page).
        for (device,entries) in Dictionary(grouping:Array(waiting.values),by:{ $0.deviceID }) {
            let ids=entries.map{ $0.capture.id }
            for offset in stride(from:0,to:ids.count,by:32) {
                let delivered=try await receipts(deviceID:device,captureIDs:Array(ids[offset..<min(offset+32,ids.count)]))
                for id in delivered {waiting["c-"+captureID(device,id)]=nil}
            }
        }
        var output:[SyncRequest]=[]
        // One capture per request keeps partial ingestion and retries straightforward.
        for (_,envelope) in waiting.sorted(by:{$0.key<$1.key}).prefix(limit) {
            output.append(.init(deviceID:envelope.deviceID,operation:"sync",captures:[envelope.capture]))
        }
        return output
    }
    public func uploadActions(deviceID:UUID,actions:[SyncTaskAction])async throws {
        guard actions.count<=8,Set(actions.map(\.id)).count==actions.count,actions.allSatisfy(\.valid) else {throw CloudMailboxError.invalidPayload}
        for action in actions {
            let id="a-"+captureID(deviceID,action.id), envelope=SyncDeviceTaskAction(deviceID:deviceID,action:action)
            if let existing=try await fetch([id]).first {
                guard try open(SyncDeviceTaskAction.self,record:existing)==envelope else {throw CloudMailboxError.conflictingCapture};continue
            }
            do {try await save(.init(id:id,payload:seal(envelope,id:id)))} catch CloudMailboxError.conflict {
                guard let existing=try await fetch([id]).first,try open(SyncDeviceTaskAction.self,record:existing)==envelope else {throw CloudMailboxError.conflictingCapture}
            }
        }
    }
    public func actionReceipts(deviceID:UUID,ids:[UUID])async throws->[SyncTaskActionReceipt] {
        guard ids.count<=32 else{throw CloudMailboxError.invalidPayload}
        return try await fetch(ids.map{"ar-"+captureID(deviceID,$0)}).map {record in
            let receipt=try open(SyncTaskActionReceipt.self,record:record)
            guard ids.contains(receipt.id),record.id=="ar-"+captureID(deviceID,receipt.id),["applied","conflict"].contains(receipt.outcome) else{throw CloudMailboxError.invalidPayload}
            return receipt
        }
    }
    public func acknowledgeAction(deviceID:UUID,receipt:SyncTaskActionReceipt)async throws {
        guard ["applied","conflict"].contains(receipt.outcome) else{throw CloudMailboxError.invalidPayload}
        let id="ar-"+captureID(deviceID,receipt.id)
        do {try await save(.init(id:id,payload:seal(receipt,id:id)))} catch CloudMailboxError.conflict {
            guard try await actionReceipts(deviceID:deviceID,ids:[receipt.id])==[receipt] else{throw CloudMailboxError.conflict}
        }
        waitingActions["a-"+captureID(deviceID,receipt.id)]=nil
    }
    public func pendingActions()async throws->[SyncDeviceTaskAction] {
        try await check()
        if waitingActions.count<32 {
            let page:CloudMailboxPage
            do {page=try await store.changes(after:actionCursor,limit:100)} catch CloudMailboxError.invalidCursor {actionCursor=nil;throw CloudMailboxError.invalidCursor}
            try await check()
            guard page.records.count<=100 else{throw CloudMailboxError.invalidPayload}
            var additions:[String:SyncDeviceTaskAction]=[:]
            for record in page.records where record.id.hasPrefix("a-") {
                let value=try open(SyncDeviceTaskAction.self,record:record)
                guard value.action.valid,record.id=="a-"+captureID(value.deviceID,value.action.id) else{throw CloudMailboxError.invalidPayload}
                additions[record.id]=value
            }
            waitingActions.merge(additions){_,new in new};actionCursor=page.cursor
        }
        for (device,entries) in Dictionary(grouping:Array(waitingActions.values),by:{ $0.deviceID }) {
            let ids=entries.map{ $0.action.id }
            for offset in stride(from:0,to:ids.count,by:32) {
                for receipt in try await actionReceipts(deviceID:device,ids:Array(ids[offset..<min(offset+32,ids.count)])) {waitingActions["a-"+captureID(device,receipt.id)]=nil}
            }
        }
        return waitingActions.sorted{$0.key<$1.key}.prefix(32).map(\.value)
    }
    public func publishSnapshot(_ response:SyncResponse)async throws {
        guard response.version==1,response.tasks.count<=50,response.states.count<=32,response.activities.count<=32,response.people.count<=12,response.asOf.timeIntervalSince1970.isFinite,response.asOf<=Date().addingTimeInterval(300) else{throw CloudMailboxError.invalidPayload}
        var value=response;value.deviceID=configuration.id;value.receivedIDs=[]
        for _ in 0..<3 {
            let existing=try await fetch(["snapshot"]).first
            if let existing,try open(SyncResponse.self,record:existing).asOf>value.asOf{return}
            do{try await save(.init(id:"snapshot",payload:seal(value,id:"snapshot"),version:existing?.version));return}catch CloudMailboxError.conflict{continue}
        }
        throw CloudMailboxError.conflict
    }
    public func snapshot(deviceID:UUID)async throws->SyncResponse? {
        guard let record=try await fetch(["snapshot"]).first else{return nil}
        var value=try open(SyncResponse.self,record:record)
        guard value.version==1,value.tasks.count<=50,value.states.count<=32,value.activities.count<=32,value.people.count<=12,value.asOf.timeIntervalSince1970.isFinite,value.asOf<=Date().addingTimeInterval(300) else{throw CloudMailboxError.invalidPayload}
        value.deviceID=deviceID;value.receivedIDs=[];return value
    }
}
