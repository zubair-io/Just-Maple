import Foundation
import Testing
@testable import MapleCore

struct ObligationAggregationTests {
    let now=Date(timeIntervalSince1970:1_800_000_000)
    let context=ObligationAggregationContext(intentID:"fixture:review",actorID:"person:me",targetID:"fixture:forms",connector:"gmail",account:"fixture",sourceScopeID:"thread:fixture")
    func seed(_ store:KnowledgeStore,_ index:Int,offset:TimeInterval=0,context:ObligationAggregationContext?=nil) async throws -> LifeTask {
        let event=Event(type:"message.received",source:Source(connector:"gmail",account:"fixture",externalID:"fixture-\(index)",revision:"1"),occurredAt:now.addingTimeInterval(offset),subjects:["thread:fixture"],content:"Synthetic obligation \(index)")
        try await store.ingest(event)
        var input=LifeTask();input.title="Fixture review \(index)";input.evidenceIDs=[event.id]
        let task=try await store.saveTask(input,expectedVersion:0,requestID:"seed-\(index)",at:now)
        try await store.validateObligationAggregation(nodeID:"task:"+task.id,expectedVersion:task.version,context:context ?? self.context,
            validation:ObligationAggregationValidation(authority:.userReview,provenanceID:"fixture-review-\(index)",evidenceIDs:[event.id]),requestID:"validate-\(index)",at:now)
        return task
    }
    @Test func explicitSemanticsAndAnchoredWindowOnly() async throws {
        let store=try KnowledgeStore(path:":memory:")
        var task=LifeTask();task.title="Fixture review";_ = try await store.saveTask(task,expectedVersion:0,requestID:"ungrouped")
        #expect(try await store.obligationGroups(maximumSpan:60).isEmpty)
        _ = try await seed(store,1);_ = try await seed(store,2,offset:50);_ = try await seed(store,3,offset:100)
        var other=context;other.actorID="person:other"
        _ = try await seed(store,4,context:other)
        let groups=try await store.obligationGroups(maximumSpan:60)
        #expect(groups.count==1 && groups[0].unresolvedCount==2)
        #expect(try await store.obligationGroups(maximumSpan:100)[0].unresolvedCount==3)
        await #expect(throws:Error.self) {try await store.obligationGroups(maximumSpan:0)}
        await #expect(throws:Error.self) {try await store.obligationGroups(maximumSpan:.infinity)}
    }
    @Test func reviewedMembershipReplayRestartAndUndo() async throws {
        let path=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
        defer {for suffix in ["","-wal","-shm"] {try? FileManager.default.removeItem(atPath:path+suffix)}}
        let store=try KnowledgeStore(path:path)
        _ = try await seed(store,1);_ = try await seed(store,2)
        let group=try #require(await store.obligationGroups(maximumSpan:60).first)
        let arrival=try await seed(store,3)
        let change=TaskActionChange(kind:"done",issuedAt:now)
        let result=try await store.applyObligationGroupAction(review:group,change:change,requestID:"batch",scope:"desktop",at:now)
        let reopened=try KnowledgeStore(path:path)
        let retry=try await reopened.applyObligationGroupAction(review:group,change:change,requestID:"batch",scope:"desktop",at:now)
        #expect(retry.children.map(\.version)==result.children.map(\.version))
        let tasks=try await reopened.tasks()
        #expect(tasks.filter{$0.status == .completed}.count==2)
        #expect(tasks.first{$0.id==arrival.id}?.status == .open)
        #expect(tasks.allSatisfy{$0.evidenceIDs.count==1})
        await #expect(throws:Error.self) {try await reopened.undoObligationGroupAction(targetMutationID:"batch",requestID:"undo",scope:"phone",issuedAt:now)}
        _ = try await reopened.undoObligationGroupAction(targetMutationID:"batch",requestID:"undo",scope:"desktop",issuedAt:now)
        _ = try await reopened.undoObligationGroupAction(targetMutationID:"batch",requestID:"undo",scope:"desktop",issuedAt:now)
        #expect(try await reopened.tasks().allSatisfy{$0.status == .open})
    }
    @Test func conflictsRollbackEveryChildAndUndoRespectsInterveningEdits() async throws {
        let store=try KnowledgeStore(path:":memory:")
        _ = try await seed(store,1);_ = try await seed(store,2)
        let group=try #require(await store.obligationGroups(maximumSpan:60).first)
        // Stale membership conflicts before application; the undo case below also proves rollback after writes.
        _ = try await store.applyTaskAction(nodeID:group.children[1].nodeID,change:TaskActionChange(kind:"done",issuedAt:now),expectedVersion:1,requestID:"individual",scope:"desktop")
        await #expect(throws:Error.self) {try await store.applyObligationGroupAction(review:group,change:TaskActionChange(kind:"done",issuedAt:now),requestID:"batch",scope:"desktop")}
        #expect(try await store.tasks().filter{$0.status == .completed}.count==1)
        let fresh=try KnowledgeStore(path:":memory:")
        _ = try await seed(fresh,1);_ = try await seed(fresh,2)
        let review=try #require(await fresh.obligationGroups(maximumSpan:60).first)
        let result=try await fresh.applyObligationGroupAction(review:review,change:TaskActionChange(kind:"done",issuedAt:now),requestID:"batch",scope:"desktop")
        var edited=try #require(await fresh.tasks().first{$0.id==String(result.children[1].nodeID.dropFirst(5))})
        edited.title="Fixture intervening edit"
        _ = try await fresh.saveTask(edited,expectedVersion:edited.version,requestID:"edit")
        await #expect(throws:Error.self) {try await fresh.undoObligationGroupAction(targetMutationID:"batch",requestID:"undo",scope:"desktop",issuedAt:now)}
        #expect(try await fresh.tasks().allSatisfy{$0.status == .completed})
        #expect(try await fresh.tasks().contains{$0.title=="Fixture intervening edit"})
    }
    @Test func sourceScopeAndEvidenceMustActuallyMatch() async throws {
        let store=try KnowledgeStore(path:":memory:")
        let task=try await seed(store,1)
        var bad=context;bad.account="other-account"
        await #expect(throws:Error.self) {try await store.validateObligationAggregation(nodeID:"task:"+task.id,expectedVersion:1,context:bad,validation:ObligationAggregationValidation(authority:.userReview,provenanceID:"fixture",evidenceIDs:task.evidenceIDs),requestID:"bad")}
        bad=context;bad.sourceScopeID="thread:unrelated"
        await #expect(throws:Error.self) {try await store.validateObligationAggregation(nodeID:"task:"+task.id,expectedVersion:1,context:bad,validation:ObligationAggregationValidation(authority:.userReview,provenanceID:"fixture",evidenceIDs:task.evidenceIDs),requestID:"bad2")}
    }
    @Test func userReviewDerivesScopePersistsMembershipAndRejectsUnrelatedSources() async throws {
        let store=try KnowledgeStore(path:":memory:")
        let a=try await seed(store,1),b=try await seed(store,2)
        let children=[a,b].map{ObligationGroupChild(nodeID:"task:"+$0.id,expectedVersion:$0.version)}
        let review=try await store.createReviewedObligationGroup(children:children,intent:"Review forms",actor:"Me",target:"Forms",maximumSpan:60,requestID:"review")
        #expect(review.context.sourceScopeID=="thread:fixture")
        _ = try await seed(store,3)
        #expect(try await store.reviewedObligationGroups().first?.children==children)
        _ = try await store.applyObligationGroupAction(review:review,change:TaskActionChange(kind:"notNeeded",issuedAt:now),requestID:"batch",scope:"desktop")
        #expect(try await store.reviewedObligationGroups().isEmpty)
        _ = try await store.undoObligationGroupAction(targetMutationID:"batch",requestID:"undo",scope:"desktop",issuedAt:now)
        #expect(try await store.reviewedObligationGroups().isEmpty) // explicit fresh review required
        var manual=LifeTask();manual.title="Fixture manual task"
        let saved=try await store.saveTask(manual,expectedVersion:0,requestID:"manual")
        await #expect(throws:Error.self) {try await store.createReviewedObligationGroup(children:[ObligationGroupChild(nodeID:"task:"+a.id,expectedVersion:3),ObligationGroupChild(nodeID:"task:"+saved.id,expectedVersion:1)],intent:"Review",actor:"Me",target:"Forms",maximumSpan:60,requestID:"invalid")}
        #expect(try await store.reviewedObligationGroups().isEmpty)
    }
    @Test func consolidationAfterReviewConflictsWithoutMutatingChildren() async throws {
        let store=try KnowledgeStore(path:":memory:"),helper=ObligationIdentityTests()
        let first=helper.event("1",occurrence:"first"),second=helper.event("1",occurrence:"second")
        try await store.ingest(first);try await store.ingest(second)
        let a=try await store.offerTask(helper.suggestion(first)),b=try await store.offerTask(helper.suggestion(second,title:"Send another form"))
        let children=[a,b].map{ObligationGroupChild(nodeID:"source:"+$0.id,expectedVersion:$0.version)}
        let review=try await store.createReviewedObligationGroup(children:children,intent:"Send",actor:"Me",target:"Forms",maximumSpan:60,requestID:"review")
        try await store.installFixtureAggregationRelation(duplicate:children[1].nodeID,primary:children[0].nodeID)
        #expect(try await store.reviewedObligationGroups().isEmpty)
        await #expect(throws:Error.self) {try await store.applyObligationGroupAction(review:review,change:TaskActionChange(kind:"done",issuedAt:now),requestID:"done",scope:"desktop")}
        #expect(try await store.worldSnapshot().suggestions.allSatisfy{$0.candidate.status == .open})
    }

}

private extension KnowledgeStore {
    func installFixtureAggregationRelation(duplicate:String,primary:String) throws {
        let relation=TaskRelation(duplicateID:duplicate,primaryID:primary,reason:"Synthetic test reconciliation",evidenceIDs:[])
        try db.execute("INSERT INTO task_relations VALUES (?,?)",[duplicate,try JSONCodec.string(relation)])
    }
}
