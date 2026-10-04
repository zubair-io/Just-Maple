import Foundation
import Testing
@testable import MapleCore

/// Synthetic routing/storage contracts. These fixtures do not measure live model quality.
struct ConversationAttentionTests {
    let start = Date(timeIntervalSince1970: 1_790_000_000)
    func message(_ key: String, after seconds: Double = 0, account: String = "fixture", thread: String = "service", outgoing: Bool = false) -> Event {
        let date = start.addingTimeInterval(seconds)
        return Event(type: outgoing ? "message.sent" : "message.received",
                     source: Source(connector: "imessage", account: account, externalID: key, revision: "1"),
                     occurredAt: date, receivedAt: date, subjects: ["thread:imessage:" + thread],
                     content: "Explicit synthetic fixture: " + key)
    }
    func commit(_ store: KnowledgeStore, source: Event, route: Route, at: Date) async throws {
        let lease = try #require(await store.acquire(now: at, eventIDs: [source.id]))
        let context = try await store.modelContext(for: source.id, at: at)
        let assessment = Assessment(notify: 0, askUser: 0, reason: 0, summarize: 0,
                                    jobStage: .unchanged, stageConfidence: 1, model: "synthetic", provider: "fixture")
        let decision = Decision(eventID: source.id, route: route, assessment: assessment, context: context,
                                explanation: ["Synthetic fixture; not a live inference."], policyVersion: "fixture", createdAt: at)
        #expect(try await store.finish(lease, decision: decision, raw: Data("{}".utf8), now: at))
    }
    @Test func laterRepliesCoalesceAndSuccessfulReviewRetiresOnlyOldAttention() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let original = message("Please provide the reference")
        try await store.ingest(original)
        try await commit(store, source: original, route: .askUser, at: start)
        let answer = message("Reference provided", after: 10, outgoing: true)
        try await store.ingest(answer)
        let first = try #require(await store.queue().first { $0.eventID == original.id })
        #expect(first.status == "pending" && first.attempts == 0)
        #expect(first.nextAttemptAt == start.addingTimeInterval(40))
        #expect(try await store.workItems().first?.status == "unread")
        try await store.ingest(answer)
        #expect(try await store.queue().first { $0.eventID == original.id }?.nextAttemptAt == first.nextAttemptAt)
        let resolution = message("Issue settled", after: 15)
        try await store.ingest(resolution)
        #expect(try await store.queue().first { $0.eventID == original.id }?.nextAttemptAt == start.addingTimeInterval(45))
        try await commit(store, source: original, route: .retain, at: start.addingTimeInterval(46))
        #expect(try await store.workItems().filter { $0.eventID == original.id }.map(\.status) == ["superseded"])
        #expect(try await store.decisions().filter { $0.eventID == original.id }.count == 1)
        #expect(try await store.decision(eventID: original.id)?.route == .retain)
        #expect(try await store.requestConversationAttentionReview(eventID: resolution.id, at: start.addingTimeInterval(47)).isEmpty)
        #expect(try await store.tasks().isEmpty)
        #expect(try await store.attentionFixtureArtifactCount(original.id) == 4)
    }
    @Test func otherAccountsAndThreadsCannotInvalidateOrResolveAttention() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let original = message("Question")
        try await store.ingest(original)
        try await commit(store, source: original, route: .askUser, at: start)
        try await store.ingest(message("Other account response", after: 1, account: "other"))
        try await store.ingest(message("Other thread response", after: 2, thread: "other"))
        #expect(try await store.queue().first { $0.eventID == original.id }?.status == "succeeded")
        #expect(try await store.workItems().first?.status == "unread")
    }
    @Test func failureDoesNotResolveAndNewIndependentRequestKeepsItsAttention() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let original = message("Original request")
        try await store.ingest(original)
        try await commit(store, source: original, route: .askUser, at: start)
        let later = message("Different responsibility", after: 10)
        try await store.ingest(later)
        try await commit(store, source: later, route: .askUser, at: start.addingTimeInterval(11))
        let failedLease = try #require(await store.acquire(now: start.addingTimeInterval(41), eventIDs: [original.id]))
        try await store.fail(failedLease, error: "Synthetic provider unavailable", now: start.addingTimeInterval(41))
        #expect(try await store.workItems().allSatisfy { $0.status == "unread" })
        try await commit(store, source: original, route: .retain, at: start.addingTimeInterval(50))
        let items = try await store.workItems()
        #expect(items.first { $0.eventID == original.id }?.status == "superseded")
        #expect(items.first { $0.eventID == later.id }?.status == "unread")
    }
    @Test func dismissalIsNotRevivedByConversationChanges() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let source = message("User dismissed request")
        try await store.ingest(source)
        try await commit(store, source: source, route: .askUser, at: start)
        let work = try #require(await store.workItems().first)
        try await store.dismiss(work.id)
        try await store.ingest(message("Follow-up", after: 10))
        #expect(try await store.queue().first { $0.eventID == source.id }?.status == "succeeded")
        #expect(try await store.workItems().first?.status == "dismissed")
    }
    @Test func quietSourceWithPendingProposalGetsFreshReviewWithoutCompletingTask() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let source = message("Send the equipment certificate")
        try await store.ingest(source)
        try await commit(store, source: source, route: .retain, at: start)
        var suggestion = TaskSuggestion()
        suggestion.eventID = source.id; suggestion.quote = source.content; suggestion.provider = "synthetic-fixture"
        suggestion.candidate.title = "Send the equipment certificate"
        _ = try await store.offerTask(suggestion, at: start)
        try await store.ingest(message("Certificate received", after: 10))
        #expect(try await store.queue().first { $0.eventID == source.id }?.status == "pending")
        try await commit(store, source: source, route: .retain, at: start.addingTimeInterval(41))
        #expect(try await store.taskExtractionQueue().first { $0.eventID == source.id }?.status == "pending")
        #expect(try await store.worldSnapshot().suggestions.first?.reviewStatus == "pending")
        #expect(try await store.tasks().isEmpty)
    }
}

extension KnowledgeStore {
    func attentionFixtureArtifactCount(_ eventID: String) throws -> Int {
        Int(try db.rows("SELECT COUNT(*) AS n FROM source_artifacts WHERE event_id=?", [eventID]).first?["n"] ?? "0") ?? 0
    }
}
