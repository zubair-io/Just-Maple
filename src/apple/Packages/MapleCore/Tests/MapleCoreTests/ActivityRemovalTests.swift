import Foundation
import Testing
@testable import MapleCore
struct ActivityRemovalTests {
    @Test func removalPreservesTasksAndEvidenceAndIsIdempotent()async throws {
        let store=try KnowledgeStore(path:":memory:")
        var activity=LifeActivity();activity.name="Fixture activity"
        activity=try await store.saveActivity(activity,expectedVersion:0,requestID:"create")
        let e=Event(type:"message.received",source:Source(connector:"gmail",account:"fixture",externalID:"one",revision:"1"),occurredAt:Date(),subjects:["person:self"],content:"Please send the form.")
        try await store.ingest(e)
        var suggestion=TaskSuggestion();suggestion.eventID=e.id;suggestion.provider="fixture";suggestion.quote=e.content;suggestion.candidate.title="Send the form";suggestion.candidate.activityIDs=[activity.id]
        let s=try await store.offerTask(suggestion)
        _ = try await store.reviewSuggestion(id:s.id,action:"accept",edited:nil,expectedVersion:s.version,requestID:"accept")
        _ = try await store.removeActivity(id:activity.id,expectedVersion:activity.version,requestID:"remove")
        _ = try await store.removeActivity(id:activity.id,expectedVersion:activity.version,requestID:"remove")
        #expect(try await store.activities().isEmpty)
        #expect(try await store.tasks().first?.title == "Send the form")
        #expect(try await store.tasks().first?.activityIDs.isEmpty == true)
        #expect(try await store.worldSnapshot().suggestions.first?.candidate.activityIDs.isEmpty == true)
        #expect(try await store.worldSnapshot().suggestions.first?.reviewStatus == "accepted")
        #expect(try await store.event(e.id) != nil)
    }
}
