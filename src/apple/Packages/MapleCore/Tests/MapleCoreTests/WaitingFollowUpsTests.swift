import Foundation
import Testing
@testable import MapleCore

struct WaitingFollowUpsTests {
    let now=Date(timeIntervalSince1970:floor(Date().timeIntervalSince1970))
    func seed(_ store:KnowledgeStore,review:Date?=nil,due:Date?=nil) async throws -> LifeTask {
        var task=LifeTask();task.title="Fixture form confirmation"
        if let due {var spec=DueSpec();spec.kind = .instant;spec.instant=due;task.due=spec}
        task=try await store.saveTask(task,expectedVersion:0,requestID:UUID().uuidString,at:now)
        _ = try await store.applyTaskAction(nodeID:"task:"+task.id,change:TaskActionChange(kind:"waiting",issuedAt:now.addingTimeInterval(-3600),reviewAt:review,waitingOn:"Fixture reviewer"),expectedVersion:task.version,requestID:UUID().uuidString,scope:"fixture",at:now)
        return try #require(await store.tasks().first{$0.id==task.id})
    }
    @Test func reviewCreatesSeparateActionOnceAndParentRemainsWaitingAcrossRestart() async throws {
        let dir=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true)
        defer {try? FileManager.default.removeItem(at:dir)}
        let path=dir.appendingPathComponent("fixture.sqlite").path
        let store=try KnowledgeStore(path:path)
        let parent=try await seed(store,review:now.addingTimeInterval(60))
        try await store.materializeWaitingFollowUps(at:now)
        #expect(try await store.tasks().count==1)
        try await store.materializeOccurrences(at:now.addingTimeInterval(60))
        let followup=try #require(await store.tasks().first{$0.waitingFollowUp != nil})
        #expect(followup.title.contains("Follow up with Fixture reviewer"))
        #expect(followup.waitingFollowUp?.parentNodeID=="task:"+parent.id)
        #expect(followup.waitingFollowUp?.reason=="review_due")
        #expect(try await store.tasks().first{$0.id==parent.id}?.status == .waiting)
        let reopened=try KnowledgeStore(path:path)
        try await reopened.materializeWaitingFollowUps(at:now.addingTimeInterval(3600))
        #expect(try await reopened.tasks().count==2)
        #expect(try await reopened.attention(at:now.addingTimeInterval(3600)).map(\.taskID)==[followup.id])
    }
    @Test func completionAndDismissalNeverRespawnAndNoDueMeansNoReview() async throws {
        for action in ["done","notNeeded"] {
            let store=try KnowledgeStore(path:":memory:")
            _ = try await seed(store,review:now)
            try await store.materializeWaitingFollowUps(at:now)
            let followup=try #require(await store.tasks().first{$0.waitingFollowUp != nil})
            _ = try await store.applyTaskAction(nodeID:"task:"+followup.id,change:TaskActionChange(kind:action,issuedAt:now),expectedVersion:followup.version,requestID:"finish",scope:"fixture",at:now)
            try await store.materializeWaitingFollowUps(at:now.addingTimeInterval(86400*10))
            #expect(try await store.tasks().filter{$0.waitingFollowUp != nil}.count==1)
            #expect(try await store.tasks().first{$0.id==followup.id}?.status.terminal==true)
        }
        let store=try KnowledgeStore(path:":memory:")
        _ = try await seed(store)
        try await store.materializeWaitingFollowUps(at:now.addingTimeInterval(86400*10))
        #expect(try await store.tasks().count==1)
    }
    @Test func deadlineCreatesReviewWithoutClaimingCompletionAndParentChangeInvalidatesUntouchedReview() async throws {
        let store=try KnowledgeStore(path:":memory:")
        let parent=try await seed(store,review:now.addingTimeInterval(86400),due:now)
        try await store.materializeWaitingFollowUps(at:now)
        let followup=try #require(await store.tasks().first{$0.waitingFollowUp != nil})
        #expect(followup.waitingFollowUp?.reason=="deadline_reached")
        #expect(followup.status == .open && followup.completedAt==nil)
        _ = try await store.correctTaskInference(nodeID:"task:"+parent.id,status:.completed,separate:false,expectedVersion:parent.version,requestID:"parent-done",at:now)
        try await store.materializeWaitingFollowUps(at:now)
        let result=try #require(await store.tasks().first{$0.id==followup.id})
        #expect(result.status == .cancelled && result.completedAt==nil)
    }
    @Test func explicitFollowupEditsAreNeverOverwrittenWhenParentChanges() async throws {
        let store=try KnowledgeStore(path:":memory:")
        let parent=try await seed(store,review:now)
        try await store.materializeWaitingFollowUps(at:now)
        var followup=try #require(await store.tasks().first{$0.waitingFollowUp != nil})
        followup.title="Fixture user edited review"
        followup=try await store.saveTask(followup,expectedVersion:followup.version,requestID:"edit",at:now)
        _ = try await store.correctTaskInference(nodeID:"task:"+parent.id,status:.open,separate:false,expectedVersion:parent.version,requestID:"clear-blocker",at:now)
        try await store.materializeWaitingFollowUps(at:now)
        #expect(try await store.tasks().first{$0.id==followup.id}?.status == .open)
        #expect(try await store.tasks().first{$0.id==followup.id}?.title==followup.title)
    }
    @Test func acceptedSourceKeepsItsExistingReviewInsteadOfCreatingAnother() async throws {
        let store=try KnowledgeStore(path:":memory:"),helper=ObligationIdentityTests(),event=ObligationIdentityTests().event("1")
        try await store.ingest(event)
        var source=try await store.offerTask(helper.suggestion(event))
        _ = try await store.applyTaskAction(nodeID:"source:"+source.id,change:TaskActionChange(kind:"waiting",issuedAt:now.addingTimeInterval(-3600),reviewAt:now,waitingOn:"Fixture reviewer"),expectedVersion:source.version,requestID:"waiting",scope:"fixture",at:now)
        try await store.materializeWaitingFollowUps(at:now)
        let original=try #require(await store.tasks().first{$0.waitingFollowUp != nil})
        source=try #require(await store.worldSnapshot().suggestions.first)
        _ = try await store.reviewSuggestion(id:source.id,action:"accept",edited:nil,expectedVersion:source.version,requestID:"accept",at:now)
        try await store.materializeWaitingFollowUps(at:now)
        #expect(try await store.tasks().filter{$0.waitingFollowUp != nil}.map(\.id)==[original.id])
    }
    @Test func explicitNewReviewTimeCreatesOneNewOccurrenceWithoutRepeatingOverdueDeadline() async throws {
        let store=try KnowledgeStore(path:":memory:")
        let parent=try await seed(store,review:now,due:now.addingTimeInterval(-60))
        try await store.materializeWaitingFollowUps(at:now)
        let first=try #require(await store.tasks().first{$0.waitingFollowUp != nil})
        _ = try await store.applyTaskAction(nodeID:"task:"+first.id,change:TaskActionChange(kind:"notNeeded",issuedAt:now),expectedVersion:first.version,requestID:"dismiss",scope:"fixture",at:now)
        _ = try await store.applyTaskAction(nodeID:"task:"+parent.id,change:TaskActionChange(kind:"waiting",issuedAt:now,reviewAt:now.addingTimeInterval(3600),waitingOn:"Fixture reviewer"),expectedVersion:parent.version,requestID:"reschedule",scope:"fixture",at:now)
        try await store.materializeWaitingFollowUps(at:now)
        #expect(try await store.tasks().filter{$0.waitingFollowUp != nil}.count==1)
        try await store.materializeWaitingFollowUps(at:now.addingTimeInterval(3600))
        try await store.materializeWaitingFollowUps(at:now.addingTimeInterval(7200))
        let reviews=try await store.tasks().filter{$0.waitingFollowUp != nil}
        #expect(reviews.count==2)
        #expect(reviews.filter{$0.status == .open}.count==1)
        #expect(reviews.first{$0.id==first.id}?.status == .cancelled)
    }
    @Test func followupDoesNotCarryOldEvidenceIntoModelContext() async throws {
        let store=try KnowledgeStore(path:":memory:")
        let old=Event(type:"message.received",source:Source(connector:"gmail",account:"fixture",externalID:"old",revision:"1"),occurredAt:now.addingTimeInterval(-40*86400),subjects:["person:self"],content:"Fixture old private content")
        try await store.ingest(old)
        var parent=try await seed(store,review:now)
        parent.evidenceIDs=[old.id];parent=try await store.saveTask(parent,expectedVersion:parent.version,requestID:"evidence",at:now)
        try await store.materializeWaitingFollowUps(at:now)
        let current=Event(type:"message.received",source:Source(connector:"gmail",account:"fixture",externalID:"new",revision:"1"),occurredAt:now,subjects:["person:self"],content:"Fixture current message")
        try await store.ingest(current)
        let context=try await store.modelContext(for:current.id,at:now)
        #expect(context.world?.tasks.isEmpty==true)
        let input=try await store.reconciliationInput(at:now)
        #expect(input.nodes.isEmpty)
        #expect(try await store.eventCount()==2)
    }

    @Test func canonicalWaitingRootAndConsolidatedSourceYieldOnlyOneReview() async throws {
        let store=try KnowledgeStore(path:":memory:"),helper=ObligationIdentityTests()
        let first=helper.event("1",occurrence:"first"),second=helper.event("2",occurrence:"second")
        try await store.ingest(first);try await store.ingest(second)
        let a=try await store.offerTask(helper.suggestion(first)),b=try await store.offerTask(helper.suggestion(second))
        let accepted=try await store.reviewSuggestion(id:a.id,action:"accept",edited:nil,expectedVersion:a.version,requestID:"accept",at:now)
        let task=try #require(await store.tasks().first{$0.id==accepted.acceptedTaskID})
        for (id,version) in [("task:"+task.id,task.version),("source:"+b.id,b.version)] {
            _ = try await store.applyTaskAction(nodeID:id,change:TaskActionChange(kind:"waiting",issuedAt:now.addingTimeInterval(-3600),reviewAt:now,waitingOn:"Fixture reviewer"),expectedVersion:version,requestID:id,scope:"fixture",at:now)
        }
        let job=try #require(await store.acquireTaskReconciliation(at:now.addingTimeInterval(5)))
        let output=ReconciliationOutput(duplicates:[DuplicateDecision(firstID:"task:"+task.id,secondID:"source:"+b.id,reason:"Fixture same obligation",confidence:0.99)],progress:[])
        try await store.finishTaskReconciliation(job,response:JSONCodec.string(output),at:now.addingTimeInterval(5))
        try await store.materializeWaitingFollowUps(at:now.addingTimeInterval(5))
        #expect(try await store.tasks().filter{$0.waitingFollowUp != nil}.count==1)
        #expect(try await store.tasks().first{$0.waitingFollowUp != nil}?.waitingFollowUp?.parentNodeID=="task:"+task.id)
    }
    @Test func storageFailureRollsBackTaskMappingAndHistoryTogether() async throws {
        let store=try KnowledgeStore(path:":memory:")
        _ = try await seed(store,review:now)
        try await store.fixtureFailWaitingHistory(true)
        await #expect(throws:Error.self) {try await store.materializeWaitingFollowUps(at:now)}
        #expect(try await store.tasks().count==1)
        try await store.fixtureFailWaitingHistory(false)
        try await store.materializeWaitingFollowUps(at:now)
        try await store.materializeWaitingFollowUps(at:now)
        #expect(try await store.tasks().count==2)
    }

    @Test func parentUndoRestoresOnlyAutomaticallyInvalidatedUneditedReview() async throws {
        for correction in ["none","done","notNeeded","edit"] {
            let store=try KnowledgeStore(path:":memory:")
            let parent=try await seed(store,review:now)
            try await store.materializeWaitingFollowUps(at:now)
            let original=try #require(await store.tasks().first{$0.waitingFollowUp != nil})
            if correction=="done" || correction=="notNeeded" {
                _ = try await store.applyTaskAction(nodeID:"task:"+original.id,change:TaskActionChange(kind:correction,issuedAt:now),expectedVersion:original.version,requestID:"review-correction",scope:"fixture",at:now)
            }
            let done=try await store.applyTaskAction(nodeID:"task:"+parent.id,change:TaskActionChange(kind:"done",issuedAt:now),expectedVersion:parent.version,requestID:"parent-done",scope:"fixture",at:now)
            try await store.materializeWaitingFollowUps(at:now)
            if correction=="edit" {
                var review=try #require(await store.tasks().first{$0.id==original.id});review.title="Fixture edited closed review"
                _ = try await store.saveTask(review,expectedVersion:review.version,requestID:"edit",at:now)
            }
            _ = try await store.applyTaskAction(nodeID:"task:"+parent.id,change:TaskActionChange(kind:"undo",issuedAt:now,targetMutationID:"parent-done"),expectedVersion:done.version,requestID:"parent-undo",scope:"fixture",at:now)
            try await store.materializeWaitingFollowUps(at:now)
            try await store.materializeWaitingFollowUps(at:now)
            let reviews=try await store.tasks().filter{$0.waitingFollowUp != nil}
            #expect(reviews.count==1 && reviews.first?.id==original.id)
            #expect(reviews.first?.status == (correction=="none" ? .open:correction=="done" ? .completed:.cancelled))
            if correction=="none" {#expect(reviews.first?.description==original.description)}
        }
    }

}


private extension KnowledgeStore {
    func fixtureFailWaitingHistory(_ enabled:Bool) throws {
        if enabled {try db.execute("CREATE TEMP TRIGGER fixture_waiting_failure BEFORE INSERT ON world_history WHEN NEW.json LIKE '%task.waiting_review_created%' BEGIN SELECT RAISE(ABORT,'fixture failure'); END")}
        else {try db.execute("DROP TRIGGER fixture_waiting_failure")}
    }
}
