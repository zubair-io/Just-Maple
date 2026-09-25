import Foundation
import Testing
@testable import MapleCore

private struct CommitmentFixtureClassifier: Classifier {
    func classify(_ context:Context) async throws -> ClassifierResult {
        let signals=MessageAssessment(kind:.commitment,confidence:1,replyNeeded:0,timeSensitive:0,commitmentChanged:1,contextConflict:0,meaningfulUpdate:0,needsReasoning:0)
        return ClassifierResult(assessment:.init(notify:0,askUser:0,reason:0,summarize:0,jobStage:.unchanged,stageConfidence:1,model:"synthetic",provider:"fixture",message:signals),rawResponse:Data("synthetic fixture".utf8))
    }
}
private actor ContextFixtureExtractor: TaskCandidateExtractor {
    var seen:Context?
    func extract(_ context:Context,activities:[LifeActivity]) async throws -> [TaskSuggestion] {
        seen=context
        var suggestion=TaskSuggestion();suggestion.eventID=context.event.id;suggestion.quote="I will deliver the replacement tomorrow.";suggestion.provider="fixture"
        suggestion.candidate.title="Receive the replacement from Fixture Taylor"
        _ = try TaskEvidenceRules.configureOwnership(&suggestion,obligation:"waiting_on_other",actorID:"person:imessage:fixture",event:context.event)
        return [suggestion]
    }
}
struct IMessageTaskTests {
    func message(_ body:String,offset:Double=0,thread:String="fixture",outgoing:Bool=false)->Event {
        Event(type:outgoing ? "message.sent":"message.received",source:.init(connector:"imessage",account:"fixture",externalID:UUID().uuidString,revision:"1",timeZone:"America/New_York"),occurredAt:Date().addingTimeInterval(offset),subjects:["person:self","person:imessage:fixture","thread:imessage:"+thread],content:"Thread: Fixture thread\nSender: \(outgoing ? "Me":"Fixture Taylor")\nDirection: \(outgoing ? "outgoing":"incoming")\n\n\(body)")
    }
    @Test func classificationQueuesMessageAndExtractorReceivesFreshSameThreadReviewContext() async throws {
        let store=try KnowledgeStore(path:":memory:")
        let earlier=message("Which replacement are we discussing?",offset:-60)
        let unrelated=message("Unrelated fixture conversation",offset:-50,thread:"other")
        let event=message("I will deliver the replacement tomorrow.",offset:-1)
        for e in [earlier,unrelated,event] {try await store.ingest(e)}
        let report=try await IntelligenceEngine(store:store,classifier:CommitmentFixtureClassifier()).run(limit:1,eventIDs:[event.id])
        #expect(report.completed==1)
        #expect(try await store.taskExtractionQueue().count==1)
        let later=message("Thanks for clarifying the replacement.",offset:0,outgoing:true)
        try await store.ingest(later)
        let extractor=ContextFixtureExtractor()
        #expect(try await TaskExtractionEngine(store:store,extractor:extractor).runOne(eventIDs:[event.id]))
        let seen=try #require(await extractor.seen)
        #expect(seen.recentEvents.map(\.id)==[later.id,earlier.id])
        let decision=try #require(await store.decisions().first)
        #expect(!decision.context.recentEvents.contains {$0.id==later.id})
        #expect(seen.event.id==event.id && seen.event.source==event.source)
        #expect(abs(seen.event.occurredAt.timeIntervalSince(event.occurredAt))<0.001)
        #expect(seen.relatedEvidence.isEmpty)
        #expect(!seen.recentEvents.contains {$0.id==unrelated.id})
        #expect((seen.world?.asOf.timeIntervalSince(decision.createdAt) ?? -1) >= 0)
        let suggestion=try #require(await store.worldSnapshot().suggestions.first)
        #expect(suggestion.candidate.status == .waiting)
        #expect(suggestion.actorID=="person:imessage:fixture")
        #expect(suggestion.candidate.assignee=="Fixture Taylor")
        let accepted=try await store.reviewSuggestion(id:suggestion.id,action:"accept",edited:nil,expectedVersion:suggestion.version,requestID:"fixture-accept")
        #expect(try await store.tasks().first?.status == .waiting)
        #expect(accepted.reviewStatus=="accepted")
        try await store.requestTaskExtraction(eventID:event.id,reprocess:true)
        _ = try await TaskExtractionEngine(store:store,extractor:extractor).runOne(eventIDs:[event.id])
        #expect(try await store.tasks().count==1)
    }
    @Test func noMetadataCannotBypassMessageOwnershipAtCommitAndExpiredSourceNeverExtracts() async throws {
        let store=try KnowledgeStore(path:":memory:"),event=message("Please return the fixture book.")
        try await store.ingest(event);try await store.requestTaskExtraction(eventID:event.id)
        let (_,token)=try #require(await store.acquireTaskExtraction(at:Date()))
        var suggestion=TaskSuggestion();suggestion.eventID=event.id;suggestion.quote="Please return the fixture book.";suggestion.provider="fixture";suggestion.candidate.title="Return the fixture book"
        await #expect(throws:(any Error).self){try await store.commitTaskExtraction([suggestion],eventID:event.id,token:token)}
        #expect(try await store.worldSnapshot().suggestions.isEmpty)
        let old=message("Old fixture request",offset:-31*86400)
        try await store.ingest(old);try await store.requestTaskExtraction(eventID:old.id)
        #expect(try await store.acquireTaskExtraction(at:Date(),eventIDs:[old.id])==nil)
    }
    @Test func upgradeBackfillsOnlyEligibleRecentDecisionsAndIsIdempotent() async throws {
        let store=try KnowledgeStore(path:":memory:"),event=message("I will deliver the replacement tomorrow.")
        try await store.ingest(event)
        _ = try await IntelligenceEngine(store:store,classifier:CommitmentFixtureClassifier()).run(limit:1,eventIDs:[event.id])
        try await store.removeFixtureExtractionJob(event.id)
        try await store.prepareIMessageTaskJobs();try await store.prepareIMessageTaskJobs()
        #expect(try await store.taskExtractionQueue().count==1)
        try await store.removeFixtureExtractionJob(event.id)
        try await store.prepareIMessageTaskJobs(at:Date().addingTimeInterval(31*86400))
        #expect(try await store.taskExtractionQueue().isEmpty)
    }
}
private extension KnowledgeStore {
    func removeFixtureExtractionJob(_ id:String)throws {try db.execute("DELETE FROM task_extraction_jobs WHERE event_id=?",[id])}
}
