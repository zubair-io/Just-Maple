import Foundation
import Testing
@testable import MapleCore

struct ClassificationRetryBoundsTests {
    private func seed(_ store: KnowledgeStore, at: Date) async throws -> Event {
        let event = Event(type: "note.created", source: .init(connector: "notes", account: "fixture", externalID: "retry-fixture", revision: "1"),
                          occurredAt: at, receivedAt: at, subjects: ["person:fixture"], content: "Synthetic retry-bound fixture.")
        try await store.ingest(event)
        return event
    }

    private func decision(_ store: KnowledgeStore, event: Event, at: Date) async throws -> Decision {
        let context = try await store.modelContext(for: event.id, at: at)
        return Policy.decide(context: context, assessment: .init(notify: 0, askUser: 0, reason: 0, summarize: 0,
            jobStage: .unchanged, stageConfidence: 1, model: "synthetic", provider: "fixture"), now: at)
    }

    @Test func repeatedContextChangesBackOffAndBlockWhileKeepingEveryResponse() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        var now = Date()
        let event = try await seed(store, at: now)
        for attempt in 1...5 {
            let lease = try #require(await store.acquire(now: now))
            let result = try await decision(store, event: event, at: now)
            try await store.correct(subject: "person:fixture", predicate: "preference", value: "Synthetic value \(attempt)", at: now)
            let raw = Data("{\"synthetic_attempt\":\(attempt)}".utf8)
            #expect(try await !store.finish(lease, decision: result, raw: raw, now: now))
            let item = try #require(await store.queue().first)
            #expect(item.attempts == attempt)
            #expect(item.error?.contains("context changed") == true)
            #expect(item.status == (attempt == 5 ? "blocked" : "pending"))
            #expect(try await store.acquire(now: now) == nil)
            #expect(abs(item.nextAttemptAt.timeIntervalSince(now) - 5 * pow(2, Double(attempt - 1))) < 0.000_001)
            now = item.nextAttemptAt
        }
        #expect(try await store.acquire(now: now.addingTimeInterval(3600)) == nil)
        #expect(try await store.decisions().isEmpty)
        #expect(try await store.workItems().isEmpty)
        let artifacts = try await store.sourceDetail(eventID: event.id).artifacts
        #expect(artifacts.filter { $0.kind == "response" }.count == 5)
        #expect(artifacts.filter { $0.kind == "decision_context" }.count == 5)
        for artifact in artifacts.filter({ $0.kind == "response" }) {
            #expect(try await store.sourceArtifact(eventID: event.id, artifactID: artifact.id).content.contains("synthetic_attempt"))
        }
        try await store.retryFailures(now: now)
        let retry = try #require(await store.acquire(now: now))
        #expect(try await store.queue().first?.attempts == 1)
        let current = try await decision(store, event: event, at: now)
        #expect(try await store.finish(retry, decision: current, raw: Data("{}".utf8), now: now))
    }

    @Test func repeatedExpiredLeasesStopAfterFiveEvenAcrossReopen() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let path = root.appendingPathComponent("retry-fixture.sqlite").path
        var now = Date()
        do {
            let store = try KnowledgeStore(path: path)
            _ = try await seed(store, at: now)
            for attempt in 1...5 {
                #expect(try await store.acquire(now: now, duration: 1) != nil)
                #expect(try await store.queue().first?.attempts == attempt)
                now = now.addingTimeInterval(2)
            }
        }
        let reopened = try KnowledgeStore(path: path)
        #expect(try await reopened.acquire(now: now) == nil)
        #expect(try await reopened.queue().first?.status == "blocked")
        #expect(try await reopened.queue().first?.attempts == 5)
        #expect(try await reopened.decisions().isEmpty)
        try await reopened.retryFailures(now: now)
        #expect(try await reopened.acquire(now: now) != nil)
        #expect(try await reopened.queue().first?.attempts == 1)
    }

    @Test func activeFifthAttemptStillCommitsWhileOtherWorkerChecksQueue() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        var now = Date()
        let event = try await seed(store, at: now)
        for _ in 1...4 {
            _ = try #require(await store.acquire(now: now, duration: 1))
            now = now.addingTimeInterval(2)
        }
        let fifth = try #require(await store.acquire(now: now, duration: 90))
        #expect(try await store.acquire(now: now.addingTimeInterval(1)) == nil)
        #expect(try await store.queue().first?.status == "leased")
        let result = try await decision(store, event: event, at: now)
        #expect(try await store.finish(fifth, decision: result, raw: Data("{}".utf8), now: now.addingTimeInterval(2)))
        #expect(try await store.queue().first?.status == "succeeded")
    }

    @Test func legacyExhaustedPendingJobIsBlockedWithoutRequest() async throws {
        let store = try KnowledgeStore(path: ":memory:"), now = Date()
        let event = try await seed(store, at: now)
        try await store.seedExhaustedClassificationFixture(eventID: event.id)
        #expect(try await store.acquire(now: now) == nil)
        #expect(try await store.queue().first?.status == "blocked")
        #expect(try await store.queue().first?.attempts == 12)
        #expect(try await store.sourceDetail(eventID: event.id).attempts.isEmpty)
    }
}

private extension KnowledgeStore {
    func seedExhaustedClassificationFixture(eventID: String) throws {
        try db.execute("UPDATE processing_jobs SET attempts=12 WHERE event_id=?", [eventID])
    }
}
