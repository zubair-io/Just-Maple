import Foundation
import Testing
import MapleCompanionTransport
@testable import Just_Maple_iPhone

@MainActor struct DailyNotePhoneTests {
    func note(day:String="2026-09-27",revision:Int=1)throws->SyncDailyNote {
        let value:[String:Any]=["day":day,"timeZone":"UTC","revision":revision,"blocks":[["id":"fixture-block","day":day,"kind":"text","content":"Synthetic phone fixture","version":1,"position":0,"createdAt":1_700_000_000,"updatedAt":1_700_000_000,"actor":"user","userEdited":true]],"cleared":[]]
        return try JSONDecoder().decode(SyncDailyNote.self,from:JSONSerialization.data(withJSONObject:value))
    }
    @Test func queuedEditSurvivesRestartAndWaitsForAppliedSnapshot()throws {
        let directory=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer{try? FileManager.default.removeItem(at:directory)}
        let store=try CompanionStore(directory:directory),device=try #require(UUID(uuidString:store.snapshot.deviceID))
        var response=SyncResponse(deviceID:device,receivedIDs:[]);response.dailyNotes=[try note()]
        try store.accept(response,sentIDs:[])
        let action=SyncDailyAction(mutation:.init(kind:"edit",blockID:"fixture-block",expectedVersion:1,requestID:UUID().uuidString,day:"2026-09-27",timeZone:"UTC",content:"Phone draft"))
        try store.dailyAction(action);try store.dailyAction(action)
        let reopened=try CompanionStore(directory:directory)
        #expect(reopened.pendingDailyActions==[action])
        var reply=try #require(try reopened.dailyReply(day:"2026-09-27",timeZone:"UTC") as? [String:Any])
        #expect((reply["sync"] as? [String:Any])?["status"] as? String == "pending")
        try reopened.acceptDailyReceipts([.init(id:action.id,outcome:"applied",resultingRevision:2)],sent:[action.id])
        #expect(reopened.pendingDailyActions.isEmpty)
        reply=try #require(try reopened.dailyReply(day:"2026-09-27",timeZone:"UTC") as? [String:Any])
        #expect((reply["sync"] as? [String:Any])?["status"] as? String == "pending")
        response.asOf=Date().addingTimeInterval(1);response.dailyNotes=[try note(revision:2)]
        try reopened.accept(response,sentIDs:[])
        reply=try #require(try reopened.dailyReply(day:"2026-09-27",timeZone:"UTC") as? [String:Any])
        #expect((reply["sync"] as? [String:Any])?["status"] as? String == "cached")
    }
    @Test func movedBlockSettlesWhenOriginalDayAgesOutOfCache()throws {
        let directory=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer{try? FileManager.default.removeItem(at:directory)}
        let store=try CompanionStore(directory:directory),device=try #require(UUID(uuidString:store.snapshot.deviceID))
        var response=SyncResponse(deviceID:device,receivedIDs:[]);response.dailyNotes=[try note()]
        try store.accept(response,sentIDs:[])
        let action=SyncDailyAction(mutation:.init(kind:"move",blockID:"fixture-block",expectedVersion:1,requestID:UUID().uuidString,day:"2026-09-27",timeZone:"UTC",targetDay:"2026-09-28"))
        try store.dailyAction(action)
        try store.acceptDailyReceipts([.init(id:action.id,outcome:"applied",resultingRevision:2)],sent:[action.id])
        response.asOf=Date().addingTimeInterval(1);response.dailyNotes=[try note(day:"2026-09-28",revision:2)]
        try store.accept(response,sentIDs:[])
        let reply=try #require(try store.dailyReply(day:"2026-09-28",timeZone:"UTC") as? [String:Any])
        #expect((reply["sync"] as? [String:Any])?["status"] as? String == "cached")
        #expect(throws:CompanionError.self){try store.dailyReply(day:"2026-09-27",timeZone:"UTC")}
    }
    @Test func pruningReceiptsCannotResendAcknowledgedCommands()throws {
        let directory=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer{try? FileManager.default.removeItem(at:directory)}
        let store=try CompanionStore(directory:directory),device=try #require(UUID(uuidString:store.snapshot.deviceID))
        var response=SyncResponse(deviceID:device,receivedIDs:[]);response.dailyNotes=[try note(revision:1000)]
        try store.accept(response,sentIDs:[])
        for _ in 0..<105 {
            let action=SyncDailyAction(mutation:.init(kind:"create",blockID:UUID().uuidString,expectedVersion:0,requestID:UUID().uuidString,day:"2026-09-27",timeZone:"UTC",content:"Fixture",blockKind:"text"))
            try store.dailyAction(action)
            try store.acceptDailyReceipts([.init(id:action.id,outcome:"applied",resultingRevision:2)],sent:[action.id])
        }
        #expect(store.pendingDailyActions.isEmpty)
        #expect(store.snapshot.dailyActions?.count==100 && store.snapshot.dailyReceipts?.count==100)
        #expect(try CompanionStore(directory:directory).pendingDailyActions.isEmpty)
    }
    @Test func unavailableDayAndWrongReceiptNeverBecomeEmptySuccess()throws {
        let directory=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer{try? FileManager.default.removeItem(at:directory)}
        let store=try CompanionStore(directory:directory)
        #expect(throws:CompanionError.self){try store.dailyReply(day:"2026-09-27",timeZone:"UTC")}
        #expect(throws:CompanionError.self){try store.acceptDailyReceipts([.init(id:UUID(),outcome:"applied")],sent:[])}
    }
}
