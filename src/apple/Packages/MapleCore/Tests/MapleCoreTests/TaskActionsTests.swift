import Foundation
import Testing
@testable import MapleCore

struct TaskActionsTests {
    let now=Date(timeIntervalSince1970:floor(Date().timeIntervalSince1970))
    func seed(_ store:KnowledgeStore)async throws->LifeTask {
        var task=LifeTask();task.title="Fixture: return the form";task.priority=3
        var due=DueSpec();due.date="2026-01-01";task.due=due
        return try await store.saveTask(task,expectedVersion:0,requestID:UUID().uuidString)
    }
    @Test func laterPreservesDeadlineAndResurfacesWithoutWrites()async throws {
        let store=try KnowledgeStore(path:":memory:")
        let original=try await seed(store),date=now.addingTimeInterval(3600)
        let change=TaskActionChange(kind:"later",issuedAt:now,resurfaceAt:date)
        let applied=try await store.applyTaskAction(nodeID:"task:"+original.id,change:change,expectedVersion:original.version,requestID:"later",scope:"desktop",at:now)
        let after=try #require(await store.tasks().first)
        #expect(after.due==original.due && after.status == .open)
        #expect(after.actionState?.lastMutationScope=="desktop")
        #expect(try await store.attention(at:now).isEmpty)
        #expect(try await store.attention(at:date).count==1)
        let retry=try await store.applyTaskAction(nodeID:"task:"+original.id,change:change,expectedVersion:original.version,requestID:"later",scope:"desktop",at:date)
        #expect(retry.version==applied.version)
        #expect(try await store.tasks().first?.version==applied.version)
        await #expect(throws:Error.self) {try await store.applyTaskAction(nodeID:"task:"+original.id,change:TaskActionChange(kind:"done",issuedAt:now),expectedVersion:original.version,requestID:"later",scope:"desktop")}
    }
    @Test func offlineLaterCanArriveAfterItsTimeAndWaitingNeverBecomesActionable()async throws {
        let store=try KnowledgeStore(path:":memory:")
        let original=try await seed(store),date=now.addingTimeInterval(60)
        let result=try await store.applyTaskAction(nodeID:"task:"+original.id,change:TaskActionChange(kind:"later",issuedAt:now,resurfaceAt:date),expectedVersion:original.version,requestID:"offline",scope:"phone",at:date.addingTimeInterval(60))
        #expect(try await store.attention(at:date.addingTimeInterval(60)).count==1)
        _ = try await store.applyTaskAction(nodeID:"task:"+original.id,change:TaskActionChange(kind:"waiting",issuedAt:now,reviewAt:date,waitingOn:"Fixture other actor"),expectedVersion:result.version,requestID:"waiting",scope:"phone",at:now)
        let task=try #require(await store.tasks().first)
        #expect(task.status == .waiting && task.due==original.due)
        #expect(task.actionState?.reviewAt==date)
        #expect(try await store.attention(at:date.addingTimeInterval(86400)).isEmpty)
    }
    @Test func scopedUndoIsIdempotentAndRestoresOnlyWithoutNewerEdits()async throws {
        let store=try KnowledgeStore(path:":memory:")
        let original=try await seed(store)
        let result=try await store.applyTaskAction(nodeID:"task:"+original.id,change:TaskActionChange(kind:"notNeeded",issuedAt:now),expectedVersion:original.version,requestID:"dismiss",scope:"desktop",at:now)
        #expect(try await store.tasks().first?.status == .cancelled)
        let change=TaskActionChange(kind:"undo",issuedAt:now,targetMutationID:"dismiss")
        await #expect(throws:Error.self) {try await store.applyTaskAction(nodeID:"task:"+original.id,change:change,expectedVersion:result.version,requestID:"undo",scope:"phone")}
        let undone=try await store.applyTaskAction(nodeID:"task:"+original.id,change:change,expectedVersion:result.version,requestID:"undo",scope:"desktop",at:now)
        #expect(try await store.tasks().first?.status == .open)
        #expect(try await store.applyTaskAction(nodeID:"task:"+original.id,change:change,expectedVersion:result.version,requestID:"undo",scope:"desktop").version==undone.version)
        await #expect(throws:Error.self) {try await store.applyTaskAction(nodeID:"task:"+original.id,change:change,expectedVersion:undone.version,requestID:"undo-again",scope:"desktop")}
        let done=try await store.applyTaskAction(nodeID:"task:"+original.id,change:TaskActionChange(kind:"done",issuedAt:now),expectedVersion:undone.version,requestID:"done",scope:"desktop")
        var edit=try #require(await store.tasks().first);edit.title="Fixture: updated description"
        let saved=try await store.saveTask(edit,expectedVersion:done.version,requestID:"edit")
        await #expect(throws:Error.self) {try await store.applyTaskAction(nodeID:"task:"+original.id,change:TaskActionChange(kind:"undo",issuedAt:now,targetMutationID:"done"),expectedVersion:saved.version,requestID:"undo-edit",scope:"desktop")}
        #expect(try await store.tasks().first?.title==edit.title)
    }
    @Test func sourceLaterSurvivesExtractionAndInferenceCannotOverrideCorrection()async throws {
        let store=try KnowledgeStore(path:":memory:")
        let helper=ObligationIdentityTests(),event=helper.event("1")
        try await store.ingest(event)
        let source=try await store.offerTask(helper.suggestion(event))
        let result=try await store.applyTaskAction(nodeID:"source:"+source.id,change:TaskActionChange(kind:"later",issuedAt:now,resurfaceAt:now.addingTimeInterval(3600)),expectedVersion:source.version,requestID:"later",scope:"desktop")
        try await helper.extract(store,event,[helper.suggestion(event)])
        let after=try #require(await store.worldSnapshot().suggestions.first)
        #expect(after.version==result.version && after.candidate.actionState?.lastAction=="later")
        let reply=Event(type:"message.received",source:Source(connector:"gmail",account:"fixture",externalID:"reply",revision:"1"),occurredAt:now.addingTimeInterval(30),subjects:event.subjects,content:"The form was submitted.")
        try await store.ingest(reply)
        let job=try #require(await store.acquireTaskReconciliation(at:now.addingTimeInterval(60)))
        #expect(job.input.nodes.first?.userStatus==true)
        let output=ReconciliationOutput(duplicates:[],progress:[ProgressDecision(nodeID:"source:"+source.id,status:.completed,eventID:reply.id,quote:reply.content,reason:"Fixture",confidence:0.99)])
        await #expect(throws:Error.self) {try await store.finishTaskReconciliation(job,response:JSONCodec.string(output),at:now.addingTimeInterval(60))}
        #expect(try await store.worldSnapshot().suggestions.first?.candidate.status == .open)
    }
    @Test func legacyNonterminalCorrectionAlsoSurvivesExtraction()async throws {
        let store=try KnowledgeStore(path:":memory:"),helper=ObligationIdentityTests(),event=ObligationIdentityTests().event("1")
        try await store.ingest(event)
        let source=try await store.offerTask(helper.suggestion(event))
        _ = try await store.correctTaskInference(nodeID:"source:"+source.id,status:.waiting,separate:false,expectedVersion:source.version,requestID:"legacy-waiting")
        try await helper.extract(store,event,[helper.suggestion(event)])
        #expect(try await store.worldSnapshot().suggestions.first?.candidate.status == .waiting)
    }

}
