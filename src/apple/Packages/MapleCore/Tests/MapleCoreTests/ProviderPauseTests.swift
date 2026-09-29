import Foundation
import Testing
@testable import MapleCore

private actor PausedTransport: HTTPTransport {
    var calls = 0
    let status: Int
    init(_ status: Int) { self.status = status }
    func send(_ request: URLRequest) async throws -> (Data, Int) {
        calls += 1
        await Task.yield()
        return (Data("private server diagnostic".utf8), status)
    }
}

struct ProviderPauseTests {
    private func seed(_ store: KnowledgeStore, count: Int = 12) async throws -> [String] {
        var ids = [String]()
        for i in 0..<count {
            ids.append(try await store.ingest(Event(type: "fixture.created", source: .init(connector: "fixture", account: "synthetic", externalID: String(i), revision: "1"), occurredAt: Date(), subjects: ["person:self"], content: "Synthetic provider-pause test source")))
        }
        return ids
    }
    @Test func accountErrorStopsOtherEventsAndManualChecksAcrossRestart() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let path = directory.appendingPathComponent("fixture.sqlite").path
        let store = try KnowledgeStore(path: path), transport = PausedTransport(402)
        let ids = try await seed(store)
        let classifier = try TypeSafeClassifier(apiKey: "synthetic", transport: transport)
        let engine = IntelligenceEngine(store: store, classifier: classifier)
        #expect(try await engine.run().deferred == 1)
        #expect(await transport.calls == 1)
        let pause = try #require(await store.providerPause("typesafe"))
        #expect(pause.retryAt == nil)
        #expect(pause.reason.contains("402"))
        await #expect(throws: Error.self) { try await store.checkSourceFacts(eventID: ids[0], classifier: classifier) }
        #expect(await transport.calls == 1)
        let reopened = try KnowledgeStore(path: path)
        #expect(try await reopened.providerPause("typesafe") != nil)
        #expect(try await IntelligenceEngine(store: reopened, classifier: classifier).run().completed == 0)
        #expect(await transport.calls == 1)
        try await reopened.retryFailures()
        #expect(try await reopened.providerPause("typesafe") != nil)
        try await reopened.clearProviderPause("typesafe")
        #expect(try await reopened.providerPause("typesafe") == nil)
        #expect(try await IntelligenceEngine(store: reopened, classifier: classifier).run().deferred == 1)
        #expect(await transport.calls == 2)
        let attempts = try await reopened.queue().filter { $0.attempts > 0 }
        #expect(attempts.count <= 2)
        for entry in attempts {
            let detail = try await reopened.sourceDetail(eventID: entry.eventID)
            for artifact in detail.artifacts where artifact.kind == "transport_status" {
                let data = try await reopened.sourceArtifact(eventID: entry.eventID, artifactID: artifact.id)
                #expect(data.content == #"{"http_status":402}"#)
            }
        }
    }
    @Test func concurrentWorkersHaveOnlyAlreadyInFlightCallsThenStop() async throws {
        let store = try KnowledgeStore(path: ":memory:"), transport = PausedTransport(429)
        _ = try await seed(store, count: 100)
        let engine = IntelligenceEngine(store: store, classifier: try TypeSafeClassifier(apiKey: "synthetic", transport: transport))
        async let a = engine.run(limit: 100)
        async let b = engine.run(limit: 100)
        _ = try await [a, b]
        #expect(await transport.calls <= 2)
        #expect(try await store.queue().filter { $0.attempts > 0 }.count <= 2)
        #expect(try await store.providerPause("typesafe")?.retryAt != nil)
    }
    @Test func cooldownBackoffHonorsRetryAfterAndCannotDowngradeAccountHold() async throws {
        let store = try KnowledgeStore(path: ":memory:"), now = Date(timeIntervalSince1970: 1_800_000_000)
        #expect(JevProviderError.retryDelay("300", now: now) == 300)
        #expect(JevProviderError.retryDelay("garbage", now: now) == nil)
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(secondsFromGMT: 0); formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
        #expect(JevProviderError.retryDelay(formatter.string(from: now.addingTimeInterval(600)), now: now) == 600)
        try await store.pauseJev(after: JevProviderError(status: 429, retryAfter: 300), now: now)
        #expect(try await store.providerPause("typesafe", now: now)?.retryAt == now.addingTimeInterval(300))
        #expect(try await store.providerPause("typesafe", now: now.addingTimeInterval(300)) == nil)
        try await store.pauseJev(after: JevProviderError(status: 503), now: now.addingTimeInterval(301))
        #expect(try await store.providerPause("typesafe", now: now.addingTimeInterval(301))?.retryAt == now.addingTimeInterval(361))
        try await store.pauseJev(after: JevProviderError(status: 401), now: now.addingTimeInterval(302))
        try await store.pauseJev(after: JevProviderError(status: 503), now: now.addingTimeInterval(303))
        #expect(try await store.providerPause("typesafe", now: now.addingTimeInterval(10_000))?.retryAt == nil)
        #expect(try await store.providerPause("typesafe", now: now)?.reason.contains("401") == true)
    }
    @Test func knownLegacyQuotaFailureMigratesOnceWithoutDiscardingQueue() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let path = directory.appendingPathComponent("fixture.sqlite").path
        let store = try KnowledgeStore(path: path)
        let id = try #require(await seed(store, count: 1).first)
        try await store.seedLegacyQuotaPause(id)
        let reopened = try KnowledgeStore(path: path)
        #expect(try await reopened.providerPause("typesafe") != nil)
        #expect(try await reopened.queue().count == 1)
        try await reopened.clearProviderPause("typesafe")
        let again = try KnowledgeStore(path: path)
        #expect(try await again.providerPause("typesafe") == nil)
    }
    @Test func malformedSuccessIsBlockedWithoutFiveRepeatedPaidRequests() async throws {
        let store = try KnowledgeStore(path: ":memory:"), transport = PausedTransport(200)
        _ = try await seed(store, count: 1)
        let engine = IntelligenceEngine(store: store, classifier: try TypeSafeClassifier(apiKey: "synthetic", transport: transport))
        #expect(try await engine.run().deferred == 1)
        #expect(try await store.queue().first?.status == "blocked")
        #expect(try await engine.run().deferred == 0)
        #expect(await transport.calls == 1)
    }
}
private extension KnowledgeStore {
    func seedLegacyQuotaPause(_ id: String) throws {
        try db.execute("DELETE FROM source_audit_metadata WHERE key='provider_pause_v1'")
        try db.execute("UPDATE processing_jobs SET error='TypeSafe HTTP 402. Classification remains queued; check authentication, quota or service availability.' WHERE event_id=?", [id])
    }
}

private actor OversizeThenHealthyTransport: HTTPTransport {
    var calls = 0
    func send(_ request: URLRequest) async throws -> (Data, Int) {
        calls += 1
        if calls == 1 {
            return (Data(#"{"detail":{"error_type":"max_tokens_exceeded","private":"must never be retained"}}"#.utf8), 400)
        }
        return (Data(#"{"model":"fixture","answers":{"notify":{"type":"noul","noul":0},"ask_user":{"type":"noul","noul":0},"reason":{"type":"noul","noul":0},"summarize":{"type":"noul","noul":0}}}"#.utf8), 200)
    }
}

extension ProviderPauseTests {
    @Test func oversizedInputBlocksOnlyItsSourceAndKeepsOtherWorkMoving() async throws {
        let store = try KnowledgeStore(path: ":memory:"), transport = OversizeThenHealthyTransport()
        for i in 0..<2 {
            _ = try await store.ingestSourceSnapshot([ConnectorSourceRecord(id: "sensor.fixture", name: "Synthetic sensor", content: "State: \(i)")], connector: "home_assistant")
        }
        let classifier = try TypeSafeClassifier(apiKey: "fixture", transport: transport)
        let engine = IntelligenceEngine(store: store, classifier: classifier)
        let report = try await engine.run()
        #expect(report.deferred == 1)
        #expect(report.completed == 1)
        #expect(await transport.calls == 2)
        #expect(try await store.providerPause("typesafe") == nil)
        #expect(try await store.queue().filter { $0.status == "blocked" }.count == 1)
        #expect(try await engine.run().deferred == 0)
        #expect(await transport.calls == 2)
        let id = try #require(await store.queue().first { $0.status == "blocked" }?.eventID)
        let detail = try await store.sourceDetail(eventID: id)
        let artifact = try #require(detail.artifacts.first { $0.kind == "transport_status" })
        let saved = try await store.sourceArtifact(eventID: id, artifactID: artifact.id)
        #expect(saved.content == #"{"http_status":400,"error_type":"max_tokens_exceeded"}"#)
        #expect(JevInputTooLarge.matches(status: 400, data: Data(#"{"detail":{"error_type":"max_tokens_exceeded"}}"#.utf8)))
        #expect(!JevInputTooLarge.matches(status: 402, data: Data(#"{"detail":{"error_type":"max_tokens_exceeded"}}"#.utf8)))
        #expect(!JevInputTooLarge.matches(status: 400, data: Data(#"{"detail":{"error_type":"unknown"}}"#.utf8)))
    }
}
