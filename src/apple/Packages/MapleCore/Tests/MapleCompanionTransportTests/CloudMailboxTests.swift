import CloudKit
import Foundation
import Testing
@testable import MapleCompanionTransport

@MainActor private final class FixtureMailboxStore:CloudMailboxStore {
    var records:[String:CloudMailboxRecord]=[:]
    var log:[CloudMailboxRecord]=[]
    var pageSize=100
    var invalidNextCursor=false
    var requestedCursors:[Data?]=[]
    var failAfterWrite=false
    var fetchError=false
    var onWrite:(()->Void)?
    func fetch(_ ids:[String])async throws->[CloudMailboxRecord] {
        if fetchError{throw FixtureFailure.unavailable}
        return ids.compactMap{records[$0]}
    }
    func save(_ value:CloudMailboxRecord)async throws {
        guard records[value.id]?.version==value.version else{throw CloudMailboxError.conflict}
        var record=value;record.version=Data(UUID().uuidString.utf8)
        records[value.id]=record;log.append(record);onWrite?()
        if failAfterWrite{failAfterWrite=false;throw FixtureFailure.unavailable}
    }
    func changes(after cursor:Data?,limit:Int)async throws->CloudMailboxPage {
        requestedCursors.append(cursor)
        if invalidNextCursor{invalidNextCursor=false;throw CloudMailboxError.invalidCursor}
        let offset=cursor.flatMap{Int(String(decoding:$0,as:UTF8.self))} ?? 0
        let end=min(log.count,offset+min(limit,pageSize))
        return .init(records:Array(log[offset..<end]),cursor:Data(String(end).utf8),moreComing:end<log.count)
    }
}
private enum FixtureFailure:Error {case unavailable,accountChanged}

@MainActor struct CloudMailboxTests {
    let account=String(repeating:"a",count:64)
    private func mailbox(_ store:FixtureMailboxStore,_ config:PairingConfiguration,account:String?=nil)->CloudCompanionMailbox {
        .init(configuration:config,accountID:account ?? self.account,store:store,accountCheck:{})
    }
    func capture(_ text:String="Synthetic private capture")->SyncCapture {
        .init(id:UUID(),text:text,createdAt:Date(timeIntervalSince1970:1_700_000_000))
    }
    @Test func actionsAreEncryptedIdempotentAndSeparateFromObservationReceipts()async throws {
        let store=FixtureMailboxStore(),config=try PairingConfiguration.create(),device=UUID()
        let phone=mailbox(store,config),mac=mailbox(store,config)
        let action=SyncTaskAction(taskID:"task:fixture",expectedVersion:1,status:"completed")
        store.failAfterWrite=true
        await #expect(throws:FixtureFailure.self){try await phone.uploadActions(deviceID:device,actions:[action])}
        try await phone.uploadActions(deviceID:device,actions:[action])
        #expect(store.records.count==1)
        #expect(!String(decoding:try #require(store.records.values.first).payload,as:UTF8.self).contains(action.taskID))
        #expect(try await mac.pendingActions()==[.init(deviceID:device,action:action)])
        #expect(try await mac.pending().isEmpty)
        #expect(try await phone.actionReceipts(deviceID:device,ids:[action.id]).isEmpty)
        try await mac.acknowledgeAction(deviceID:device,receipt:.init(id:action.id,outcome:"applied"))
        #expect(try await phone.actionReceipts(deviceID:device,ids:[action.id])==[.init(id:action.id,outcome:"applied")])
        #expect(try await phone.receipts(deviceID:device,captureIDs:[action.id]).isEmpty)
        #expect(try await mailbox(store,config).pendingActions().isEmpty)
        var altered=action;altered.status="open"
        await #expect(throws:CloudMailboxError.self){try await phone.uploadActions(deviceID:device,actions:[altered])}
    }
    @Test func unsupportedDeliveryIsDurableWithoutApplicationAndUndoIsRecipientScoped() async throws {
        let store=FixtureMailboxStore(),config=try PairingConfiguration.create(),device=UUID(),other=UUID()
        let phone=mailbox(store,config),mac=mailbox(store,config)
        let action=SyncTaskAction(taskID:"task:fixture",expectedVersion:1,intent:.done)
        try await phone.uploadActions(deviceID:device,actions:[action])
        try await mac.acknowledgeAction(deviceID:device,receipt:.init(id:action.id,outcome:"unsupported"))
        #expect(try await mac.pendingActions().isEmpty)
        #expect(try await phone.actionReceipts(deviceID:device,ids:[action.id]).first?.outcome=="unsupported")
        var task=SyncTask(id:action.taskID,title:"Fixture",status:"waiting",activities:["Label"],due:nil)
        task.activityIDs=["activity:stable"]
        task.actionState = .init(resurfaceAt:nil,reviewAt:nil,waitingOn:"Actor",lastMutationScope:device.uuidString.lowercased(),lastMutationID:action.id.uuidString.lowercased(),lastAction:"waiting",canUndo:false)
        var response=SyncResponse(deviceID:config.id,receivedIDs:[],tasks:[task]);response.supportedTaskIntents=SyncTaskIntent.allCases.map(\.rawValue)
        try await mac.publishSnapshot(response)
        #expect(try await phone.snapshot(deviceID:device)?.tasks.first?.actionState?.canUndo==true)
        #expect(try await phone.snapshot(deviceID:other)?.tasks.first?.actionState?.canUndo==false)
        #expect(try await phone.snapshot(deviceID:device)?.tasks.first?.activityIDs==["activity:stable"])
    }
    @Test func immutableEncryptedUploadRetriesAfterLostCloudReply()async throws {
        let store=FixtureMailboxStore(),config=try PairingConfiguration.create(),device=UUID(),item=capture()
        let phone=mailbox(store,config)
        store.failAfterWrite=true
        await #expect(throws:FixtureFailure.self){try await phone.upload(.init(deviceID:device,operation:"sync",captures:[item]))}
        try await phone.upload(.init(deviceID:device,operation:"sync",captures:[item]))
        #expect(store.records.count==1)
        #expect(!String(decoding:try #require(store.records.values.first).payload,as:UTF8.self).contains(item.text))
        let mac=mailbox(store,config)
        let pending=try await mac.pending()
        #expect(pending.count==1 && pending.first?.deviceID==device)
        #expect(pending.first?.captures==[item])
        #expect(try await phone.receipts(deviceID:device,captureIDs:[item.id]).isEmpty)
        var altered=item;altered.text="Changed content"
        await #expect(throws:CloudMailboxError.self){try await phone.upload(.init(deviceID:device,operation:"sync",captures:[altered]))}
        try await mac.acknowledge(deviceID:device,captureIDs:[item.id])
        #expect(try await phone.receipts(deviceID:device,captureIDs:[item.id])==[item.id])
        #expect(try await phone.receipts(deviceID:UUID(),captureIDs:[item.id]).isEmpty)
        #expect(try await mailbox(store,config).pending().isEmpty)
    }
    @Test func pagesRetainUnacknowledgedWorkAndReceiptsSurviveRestart()async throws {
        let store=FixtureMailboxStore();store.pageSize=2
        let config=try PairingConfiguration.create(),device=UUID(),items=(0..<7).map{capture("Synthetic paged capture \($0)")}
        let phone=mailbox(store,config),mac=mailbox(store,config)
        try await phone.upload(.init(deviceID:device,operation:"sync",captures:items))
        let first=try await mac.pending(limit:1)
        let firstID=try #require(first.first?.captures.first?.id)
        #expect(try await mac.pending(limit:1).first?.captures.first?.id==firstID)
        var ingested=Set<UUID>()
        for _ in 0..<25 {
            for request in try await mac.pending(limit:2) {
                let ids=request.captures.map(\.id);ingested.formUnion(ids)
                try await mac.acknowledge(deviceID:request.deviceID,captureIDs:ids)
            }
            if ingested.count==items.count{break}
        }
        #expect(ingested==Set(items.map(\.id)))
        #expect(Set(try await phone.receipts(deviceID:device,captureIDs:items.map(\.id)))==ingested)
        let restarted=mailbox(store,config)
        for _ in 0..<10 {#expect(try await restarted.pending().isEmpty)}
    }
    @Test func snapshotReplacementIsRecipientScopedAndDoesNotAcknowledgeUploads()async throws {
        let store=FixtureMailboxStore(),config=try PairingConfiguration.create(),mac=mailbox(store,config),phone=UUID(),other=UUID()
        let now=Date(timeIntervalSince1970:1_700_000_000)
        let task=SyncTask(id:"fixture",title:"Synthetic task",status:"open",activities:[],due:nil)
        try await mac.publishSnapshot(.init(deviceID:other,receivedIDs:[UUID()],asOf:now,tasks:[task],activities:[.init(id:"a",name:"Synthetic area",kind:"area",lifecycle:"active",openTaskCount:1)],people:[.init(id:"p",name:"Synthetic person",pinned:true,relationship:"Family")]))
        let received=try #require(try await mac.snapshot(deviceID:phone))
        #expect(received.deviceID==phone && received.receivedIDs.isEmpty)
        #expect(received.tasks==[task] && received.activities.count==1 && received.people.count==1)
        try await mac.publishSnapshot(.init(deviceID:other,receivedIDs:[],asOf:now.addingTimeInterval(1)))
        try await mac.publishSnapshot(.init(deviceID:other,receivedIDs:[],asOf:now,tasks:[task]))
        #expect(try await mac.snapshot(deviceID:phone)?.tasks.isEmpty==true)
        #expect(try await mac.snapshot(deviceID:phone)?.asOf==now.addingTimeInterval(1))
    }
    @Test func accountOrKeyMismatchCannotDecryptAndAccountChangeAfterWriteFailsClosed()async throws {
        let store=FixtureMailboxStore(),config=try PairingConfiguration.create(),device=UUID(),item=capture()
        try await mailbox(store,config).upload(.init(deviceID:device,operation:"sync",captures:[item]))
        let wrong=PairingConfiguration(id:config.id,secret:Data(repeating:0,count:32),serviceName:config.serviceName)
        await #expect(throws:(any Error).self){try await mailbox(store,wrong).pending()}
        await #expect(throws:(any Error).self){try await mailbox(store,config,account:String(repeating:"b",count:64)).pending()}
        var changed=false
        let checked=CloudCompanionMailbox(configuration:config,accountID:account,store:store,accountCheck:{if changed{throw FixtureFailure.accountChanged}})
        store.onWrite={changed=true}
        await #expect(throws:FixtureFailure.self){try await checked.acknowledge(deviceID:device,captureIDs:[item.id])}
        let before=store.records.count
        await #expect(throws:FixtureFailure.self){try await checked.upload(.init(deviceID:device,operation:"sync",captures:[capture()]))}
        #expect(store.records.count==before)
    }
    @Test func invalidInputsAndUnavailableCloudNeverProduceSuccessOrReceipts()async throws {
        let store=FixtureMailboxStore(),config=try PairingConfiguration.create(),phone=mailbox(store,config),device=UUID()
        await #expect(throws:CloudMailboxError.self){try await phone.upload(.init(deviceID:device,operation:"sync",captures:[capture(String(repeating:"x",count:16_385))]))}
        #expect(store.records.isEmpty)
        await #expect(throws:CloudMailboxError.self){try await phone.pending(limit:33)}
        store.fetchError=true
        await #expect(throws:FixtureFailure.self){try await phone.snapshot(deviceID:device)}
        await #expect(throws:FixtureFailure.self){try await phone.receipts(deviceID:device,captureIDs:[UUID()])}
        let legacy=Data(#"{"version":1,"deviceID":"00000000-0000-0000-0000-000000000001","receivedIDs":[],"asOf":1700000000000,"tasks":[],"states":[]}"#.utf8)
        let response=try SyncCodec.decode(SyncResponse.self,from:legacy)
        #expect(response.activities.isEmpty && response.people.isEmpty)
    }
    @Test func expiredCursorRescansWithoutDuplicatingReceiptsAndErrorsAreSanitized()async throws {
        let store=FixtureMailboxStore(),config=try PairingConfiguration.create(),device=UUID(),item=capture()
        let mac=mailbox(store,config)
        try await mailbox(store,config).upload(.init(deviceID:device,operation:"sync",captures:[item]))
        _ = try await mac.pending();try await mac.acknowledge(deviceID:device,captureIDs:[item.id])
        store.invalidNextCursor=true
        await #expect(throws:CloudMailboxError.self){try await mac.pending()}
        #expect(try await mac.pending().isEmpty)
        #expect(store.requestedCursors.last! == nil)
        let error=CKError(.permissionFailure,userInfo:[NSLocalizedDescriptionKey:"PRIVATE RECORD AND SECRET"])
        #expect(CloudMailboxError.safeDescription(error).contains("iCloud access"))
        #expect(!CloudMailboxError.safeDescription(error).contains("PRIVATE"))
        #expect(CloudMailboxError.safeDescription(CKError(.quotaExceeded)).contains("storage is full"))
    }

    @Test func rejectionDiagnosticsExposeOnlyStageCodesAndWhitelistedFlags()throws {
        let underlying=NSError(domain:"CKInternalErrorDomain",code:2000,userInfo:[NSLocalizedDescriptionKey:"Record type PRIVATE_TYPE does not exist for PRIVATE_ACCOUNT"])
        let rejected=CKError(.serverRejectedRequest,userInfo:[NSUnderlyingErrorKey:underlying,NSLocalizedDescriptionKey:"PRIVATE HTTP BODY"])
        let partial=CKError(.partialFailure,userInfo:[CKPartialErrorsByItemIDKey:["PRIVATE_RECORD_ID":rejected]])
        let diagnostic=CloudMailboxRequestFailure.wrapping(partial,stage:.zoneCreate)
        let description=CloudMailboxError.safeDescription(diagnostic)
        #expect(description.contains("zone creation"))
        #expect(description.contains("2, 15"))
        #expect(description.contains("2000"))
        #expect(description.contains("schema missing"))
        #expect(!description.contains("PRIVATE"))
        #expect(CloudMailboxRequestFailure.wrapping(CKError(.zoneNotFound),stage:.zoneFetch) is CKError)
    }

}
