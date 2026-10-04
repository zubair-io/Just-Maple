import Foundation
import Testing
import UIKit
import MapleCompanionTransport
@testable import Just_Maple_iPhone

@MainActor private final class ForbiddenUITestMailbox:PhoneCloudMailbox {
    var calls=0
    func upload(_ request:SyncRequest)async throws {calls+=1;throw CompanionError.storageUnavailable}
    func snapshot(deviceID:UUID)async throws->SyncResponse? {calls+=1;throw CompanionError.storageUnavailable}
    func receipts(deviceID:UUID,captureIDs:[UUID])async throws->[UUID] {calls+=1;throw CompanionError.storageUnavailable}
}
@MainActor struct CompanionUITestIsolationTests {
    @Test func explicitSyncEnablePairAndDisconnectCannotTouchLiveDependenciesOrPersonalPreferences()async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent("companion-isolation-"+UUID().uuidString)
        let preferenceSuite="synthetic-personal-preferences-"+UUID().uuidString
        let personalPreferences=try #require(UserDefaults(suiteName:preferenceSuite))
        defer {try? FileManager.default.removeItem(at:root);personalPreferences.removePersistentDomain(forName:preferenceSuite)}
        personalPreferences.set(true,forKey:"companionCloudPaused")
        personalPreferences.set(true,forKey:"companionManualMode")
        let store=try CompanionStore(directory:root),device=try #require(UUID(uuidString:store.snapshot.deviceID))
        var task=SyncTask(id:"task:synthetic-isolation",title:"Synthetic pending task",status:"open",activities:[],due:nil);task.version=1
        try store.accept(.init(deviceID:device,receivedIDs:[],tasks:[task]),sentIDs:[])
        let action=SyncTaskAction(taskID:task.id,expectedVersion:1,status:"completed")
        try store.taskAction(action)
        let captureID=UUID().uuidString.lowercased()
        try store.capture(id:captureID,text:"Synthetic isolated capture")
        let before=try #require(JSONSerialization.jsonObject(with:SyncCodec.encode(store.snapshot)) as? NSDictionary)
        var accountCalls=0,credentialCalls=0,mailboxCreations=0
        let forbidden=ForbiddenUITestMailbox()
        let dependencies=PhoneSyncDependencies(accountID:{accountCalls+=1;throw CompanionError.storageUnavailable},load:{_ in credentialCalls+=1;return nil},mailbox:{_,_,_ in mailboxCreations+=1;return forbidden})
        let sync=CompanionSync(store:store,dependencies:dependencies,preferences:personalPreferences,uiTestMode:true)
        #expect(!sync.cloudEnabled && !sync.paired)
        #expect(personalPreferences.bool(forKey:"companionCloudPaused"))
        #expect(personalPreferences.bool(forKey:"companionManualMode"))
        sync.start()
        await sync.sync() // Explicit syncMac and task/group/daily bridge actions reach this entry point.
        await sync.enableCloud()
        try await sync.pair(presenter:UIViewController())
        try sync.disconnect()
        await sync.sync()
        sync.stop()
        #expect(accountCalls==0 && credentialCalls==0 && mailboxCreations==0 && forbidden.calls==0)
        #expect(personalPreferences.bool(forKey:"companionCloudPaused"))
        #expect(personalPreferences.bool(forKey:"companionManualMode"))
        #expect(sync.status=="UI test · sync disabled")
        #expect(try (JSONSerialization.jsonObject(with:SyncCodec.encode(store.snapshot)) as? NSDictionary)==before)
        let reopened=try CompanionStore(directory:root)
        #expect(reopened.pendingTaskActions==[action])
        #expect(reopened.pending.map(\.id)==[captureID])
    }

    @Test func uiAndHostedUnitTestLaunchesSelectIsolatedStorageButNormalLaunchDoesNot() {
        #expect(CompanionBridge.isolatedTestHost(arguments:["Just Maple","--companion-ui-test"],hasXCTest:false))
        #expect(CompanionBridge.isolatedTestHost(arguments:["Just Maple"],hasXCTest:true))
        #expect(!CompanionBridge.isolatedTestHost(arguments:["Just Maple"],hasXCTest:false))
    }
}
