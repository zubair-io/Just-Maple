import Foundation
import Testing
import MapleCompanionTransport
@testable import Just_Maple_iPhone

@MainActor private final class FixtureMailbox: PhoneCloudMailbox {
    var actions:[SyncTaskAction]=[]
    var actionReplies:[SyncTaskActionReceipt]=[]
    func uploadActions(deviceID:UUID,actions:[SyncTaskAction])async throws{if fail {throw CompanionError.storageUnavailable};self.actions=actions}
    func actionReceipts(deviceID:UUID,ids:[UUID])async throws->[SyncTaskActionReceipt]{actionReplies.filter{ids.contains($0.id)}}
    var requests:[SyncRequest]=[]
    var acknowledged:[UUID]=[]
    var response:SyncResponse?
    var afterUpload:(() -> Void)?
    var fail=false
    func upload(_ request:SyncRequest) async throws {
        if fail { throw CompanionError.storageUnavailable }
        requests.append(request);afterUpload?()
    }
    func receipts(deviceID:UUID,captureIDs:[UUID]) async throws -> [UUID] { acknowledged }
    func snapshot(deviceID:UUID) async throws -> SyncResponse? { response }
}

@MainActor struct RemoteSyncTests {
    @Test func taskCommandPersistsUntilMacReceiptAndRejectsUnknownReceipts()async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let suite="fixture-actions-"+UUID().uuidString
        let preferences=UserDefaults(suiteName:suite)!
        defer{try? FileManager.default.removeItem(at:root);preferences.removePersistentDomain(forName:suite)}
        let store=try CompanionStore(directory:root),device=try #require(UUID(uuidString:store.snapshot.deviceID)),config=try PairingConfiguration.create(),mailbox=FixtureMailbox()
        var task=SyncTask(id:"task:fixture",title:"Synthetic task",status:"open",activities:[],due:nil);task.version=1
        try store.accept(.init(deviceID:device,receivedIDs:[],tasks:[task]),sentIDs:[])
        let action=SyncTaskAction(taskID:task.id,expectedVersion:1,status:"completed")
        try store.taskAction(action);try store.taskAction(action)
        let reopened=try CompanionStore(directory:root)
        #expect(reopened.pendingTaskActions==[action])
        let sync=CompanionSync(store:reopened,dependencies:.init(accountID:{"fixture-account"},load:{_ in config},mailbox:{_,_,_ in mailbox}),preferences:preferences)
        await sync.sync()
        #expect(mailbox.actions==[action] && reopened.pendingTaskActions==[action])
        #expect(throws:CompanionError.self){try reopened.acceptActionReceipts([.init(id:UUID(),outcome:"applied")],sent:[action.id])}
        mailbox.actionReplies=[.init(id:action.id,outcome:"applied")]
        await sync.sync()
        #expect(reopened.pendingTaskActions.isEmpty)
        #expect(try CompanionStore(directory:root).snapshot.taskActionReceipts==mailbox.actionReplies)
    }
    @Test func oldPausePreferenceMigratesAndMissingCredentialReconnectsWithoutUserAction() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let suite="fixture-auto-"+UUID().uuidString
        let preferences=try #require(UserDefaults(suiteName:suite))
        defer {try? FileManager.default.removeItem(at:root);preferences.removePersistentDomain(forName:suite)}
        preferences.set(true,forKey:"companionCloudPaused");preferences.set(true,forKey:"companionManualMode")
        let store=try CompanionStore(directory:root), mailbox=FixtureMailbox(), config=try PairingConfiguration.create()
        var credential:PairingConfiguration?
        let sync=CompanionSync(store:store,dependencies:.init(accountID:{"fixture-account"},load:{_ in credential},mailbox:{_,_,_ in mailbox}),preferences:preferences)
        #expect(sync.cloudEnabled)
        await sync.sync()
        #expect(mailbox.requests.isEmpty)
        credential=config
        var response=SyncResponse(deviceID:try #require(UUID(uuidString:store.snapshot.deviceID)),receivedIDs:[])
        response.displayName="Fixture User";mailbox.response=response
        await sync.sync()
        #expect(sync.status=="Synced with iCloud")
        #expect(store.snapshot.mac?.displayName=="Fixture User")
        mailbox.fail=true;await sync.sync()
        mailbox.fail=false;await sync.sync()
        #expect(sync.status=="Synced with iCloud")
    }
    @Test func uploadIsNotReceiptAndLaterMacReceiptSurvivesRestart() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let suite="fixture-remote-"+UUID().uuidString
        let preferences=try #require(UserDefaults(suiteName:suite))
        defer {try? FileManager.default.removeItem(at:root);preferences.removePersistentDomain(forName:suite)}
        let store=try CompanionStore(directory:root), id=UUID()
        let date=Date().addingTimeInterval(-90*86400)
        try store.capture(id:id.uuidString,text:"Synthetic remote capture",at:date)
        let device=try #require(UUID(uuidString:store.snapshot.deviceID))
        let config=try PairingConfiguration.create(), mailbox=FixtureMailbox()
        let sync=CompanionSync(store:store,dependencies:.init(accountID:{"fixture-account"},load:{_ in config},mailbox:{_,_,_ in mailbox}),preferences:preferences)
        await sync.sync()
        #expect(mailbox.requests.first?.captures.first?.createdAt==date)
        #expect(store.pending.count==1)
        #expect(store.snapshot.uploadedIDs==[id.uuidString.lowercased()])
        #expect((store.snapshot.receivedIDs ?? []).isEmpty)
        #expect(sync.status.contains("Waiting for your Mac"))
        mailbox.acknowledged=[id]
        mailbox.response = .init(deviceID:device,receivedIDs:[],tasks:[.init(id:"fixture",title:"Synthetic task",status:"open",activities:[],due:nil)])
        await sync.sync()
        let reopened=try CompanionStore(directory:root)
        #expect(reopened.pending.isEmpty)
        #expect(reopened.snapshot.mac?.tasks.first?.id=="fixture")
        #expect(sync.status=="Synced with iCloud")
    }
    @Test func uploadsLaterBatchesWithoutWaitingForSleepingMacAndKeepsCacheOnFailure() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let suite="fixture-batches-"+UUID().uuidString
        let preferences=try #require(UserDefaults(suiteName:suite))
        defer {try? FileManager.default.removeItem(at:root);preferences.removePersistentDomain(forName:suite)}
        let store=try CompanionStore(directory:root), config=try PairingConfiguration.create(), mailbox=FixtureMailbox()
        for index in 0..<12 {try store.capture(id:UUID().uuidString,text:"Synthetic batch \(index)")}
        let device=try #require(UUID(uuidString:store.snapshot.deviceID))
        mailbox.response = .init(deviceID:device,receivedIDs:[],tasks:[.init(id:"fixture-cache",title:"Synthetic cached task",status:"open",activities:[],due:nil)])
        let sync=CompanionSync(store:store,dependencies:.init(accountID:{"fixture-account"},load:{_ in config},mailbox:{_,_,_ in mailbox}),preferences:preferences)
        await sync.sync();await sync.sync()
        #expect(Set(mailbox.requests.flatMap{$0.captures.map(\.id)}).count==12)
        #expect(store.pending.count==12)
        #expect(store.snapshot.uploadedIDs?.count==12)
        mailbox.fail=true
        await sync.sync()
        #expect(store.snapshot.mac?.tasks.first?.id=="fixture-cache")
        #expect(store.pending.count==12)
        #expect(sync.status.contains("unavailable"))
    }
    @Test func accountSwitchDuringUploadCannotAcceptReceiptOrSnapshot() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let suite="fixture-switch-"+UUID().uuidString
        let preferences=try #require(UserDefaults(suiteName:suite))
        defer {try? FileManager.default.removeItem(at:root);preferences.removePersistentDomain(forName:suite)}
        let store=try CompanionStore(directory:root), id=UUID(), config=try PairingConfiguration.create(), mailbox=FixtureMailbox()
        try store.capture(id:id.uuidString,text:"Synthetic original account capture")
        var account="original-fixture"
        mailbox.afterUpload={account="other-fixture"}
        mailbox.acknowledged=[id]
        let sync=CompanionSync(store:store,dependencies:.init(accountID:{account},load:{_ in config},mailbox:{_,_,_ in mailbox}),preferences:preferences)
        await sync.sync()
        #expect(store.pending.count==1)
        #expect(store.snapshot.uploadedIDs==nil)
        #expect(store.snapshot.mac==nil)
        #expect(store.snapshot.cloudAccountID=="original-fixture")
        await sync.sync()
        #expect(mailbox.requests.count==1)
    }
    @Test func staleSnapshotCannotResurrectRemovedTaskButReceiptsStillPersist() throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer {try? FileManager.default.removeItem(at:root)}
        let store=try CompanionStore(directory:root), id=UUID()
        try store.capture(id:id.uuidString,text:"Synthetic receipt fixture")
        let device=try #require(UUID(uuidString:store.snapshot.deviceID)), now=Date()
        try store.accept(.init(deviceID:device,receivedIDs:[],asOf:now,tasks:[]),sentIDs:[])
        try store.accept(.init(deviceID:device,receivedIDs:[id],asOf:now.addingTimeInterval(-30),tasks:[.init(id:"removed-fixture",title:"Deleted fixture task",status:"open",activities:[],due:nil)]),sentIDs:[id])
        #expect(store.snapshot.mac?.tasks.isEmpty==true)
        #expect(store.pending.isEmpty)
        #expect(throws:CompanionError.self){try store.acceptReceipts([UUID()],sentIDs:[id])}
        #expect(throws:CompanionError.self){try store.markUploaded([UUID()])}
    }
}
