import Foundation
import Testing
@testable import MapleCore

struct ObligationIdentityTests {
    let now = Date()
    func event(_ revision: String, occurrence: String = "request", text: String = "Please send the form.") -> Event {
        Event(type:"message.received", source:Source(connector:"gmail",account:"fixture",externalID:occurrence,revision:revision), occurredAt:now, receivedAt:now.addingTimeInterval(Double(revision) ?? 0), subjects:["person:self","thread:gmail:fixture"], content:"Subject: Fixture\nBody:\n" + text)
    }
    func suggestion(_ event: Event, title: String = "Send the form") -> TaskSuggestion {
        var s=TaskSuggestion(); s.eventID=event.id; s.quote="Please send the form."; s.provider="fixture"; s.candidate.title=title
        return s
    }
    func extract(_ store: KnowledgeStore, _ event: Event, _ suggestions: [TaskSuggestion]) async throws {
        try await store.requestTaskExtraction(eventID:event.id,reprocess:true)
        let (_,token)=try #require(await store.acquireTaskExtraction(at:Date(),eventIDs:[event.id]))
        try await store.commitTaskExtraction(suggestions,eventID:event.id,token:token)
    }
    @Test func dismissedRevisionRetainsEvidenceAndRetryDoesNotDuplicate() async throws {
        let store=try KnowledgeStore(path:":memory:"), first=event("1"), revised=event("2",text:"Updated greeting. Please send the form.")
        try await store.ingest(first)
        let original=try await store.offerTask(suggestion(first))
        _ = try await store.reviewSuggestion(id:original.id,action:"reject",edited:nil,expectedVersion:original.version,requestID:"dismiss")
        try await store.ingest(revised)
        try await extract(store,revised,[suggestion(revised)])
        let result=try #require(await store.worldSnapshot().suggestions.first)
        #expect(result.id==original.id && result.reviewStatus=="rejected")
        #expect(Set(result.candidate.evidenceIDs)==Set([first.id,revised.id]))
        #expect(result.obligationIdentity?.version==1)
        #expect(result.obligationIdentity?.occurrenceID=="request")
        try await extract(store,revised,[suggestion(revised)])
        #expect(try await store.worldSnapshot().suggestions.count==1)
        #expect(try await store.worldSnapshot().suggestions.first?.version==result.version)
    }
    @Test func completedSourceSurvivesReprocessingAndNewOccurrenceRemainsEligible() async throws {
        let store=try KnowledgeStore(path:":memory:"), first=event("1")
        try await store.ingest(first)
        let original=try await store.offerTask(suggestion(first))
        _ = try await store.correctTaskInference(nodeID:"source:"+original.id,status:.completed,separate:false,expectedVersion:original.version,requestID:"done")
        try await extract(store,first,[suggestion(first)])
        #expect(try await store.worldSnapshot().suggestions.first?.candidate.status == .completed)
        #expect(try await store.worldSnapshot().suggestions.first?.reviewStatus=="pending")
        let next=event("2",occurrence:"new-request")
        try await store.ingest(next)
        try await extract(store,next,[suggestion(next)])
        #expect(try await store.worldSnapshot().suggestions.count==2)
        #expect(try await store.worldSnapshot().suggestions.filter{$0.candidate.status == .open}.count==1)
    }
    @Test func acceptedCompletionIsProtectedAndInvalidBatchRollsBackEvidence() async throws {
        let store=try KnowledgeStore(path:":memory:"), first=event("1"), revised=event("2",text:"Updated greeting. Please send the form.")
        try await store.ingest(first)
        let original=try await store.offerTask(suggestion(first))
        let accepted=try await store.reviewSuggestion(id:original.id,action:"accept",edited:nil,expectedVersion:original.version,requestID:"accept")
        let task=try #require(await store.tasks().first)
        _ = try await store.correctTaskInference(nodeID:"task:"+task.id,status:.completed,separate:false,expectedVersion:task.version,requestID:"done")
        try await store.ingest(revised)
        try await store.requestTaskExtraction(eventID:revised.id)
        let (_,token)=try #require(await store.acquireTaskExtraction(at:Date(),eventIDs:[revised.id]))
        await #expect(throws:Error.self) { try await store.commitTaskExtraction([suggestion(revised),suggestion(revised,title:"Respond to the email")],eventID:revised.id,token:token) }
        #expect(try await store.worldSnapshot().suggestions.first?.candidate.evidenceIDs==[first.id])
        #expect(try await store.worldSnapshot().suggestions.first?.version==accepted.version)
        let queue=try #require(await store.taskExtractionQueue().first{$0.eventID==revised.id})
        #expect(queue.status=="processing")
        // A failed transaction retains the lease; complete the same lease without the invalid candidate.
        try await store.commitTaskExtraction([suggestion(revised)],eventID:revised.id,token:token)
        #expect(try await store.worldSnapshot().suggestions.count==1)
        #expect(try await store.tasks().first?.status == .completed)
    }
    @Test func differentActionSharingQuoteIsNotSilentlySuppressed() async throws {
        let store=try KnowledgeStore(path:":memory:"), first=event("1")
        try await store.ingest(first)
        let original=try await store.offerTask(suggestion(first))
        _ = try await store.reviewSuggestion(id:original.id,action:"reject",edited:nil,expectedVersion:original.version,requestID:"dismiss")
        let different=try await store.offerTask(suggestion(first,title:"Review the form before sending"))
        #expect(different.id != original.id)
        #expect(different.reviewStatus=="pending")
    }
}
