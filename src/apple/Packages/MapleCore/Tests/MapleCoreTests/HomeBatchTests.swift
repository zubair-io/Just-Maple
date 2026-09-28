import Foundation
import Testing
@testable import MapleCore

private actor BatchTransport: HTTPTransport {
    var requests = [URLRequest]()
    var status: Int
    let correctionStore: KnowledgeStore?
    let correctionSubject: String?
    init(status: Int = 200, correctionStore: KnowledgeStore? = nil, correctionSubject: String? = nil) {
        self.status = status; self.correctionStore = correctionStore; self.correctionSubject = correctionSubject
    }
    func setStatus(_ value: Int) { status = value }
    func send(_ request: URLRequest) async throws -> (Data, Int) {
        requests.append(request)
        await Task.yield()
        if let correctionStore, let correctionSubject {
            _ = try await correctionStore.correct(subject: correctionSubject, predicate: "name", value: "Synthetic corrected room")
        }
        return (Data(#"{"model":"synthetic-jev","answers":{"notify":{"type":"noul","noul":0.1},"ask_user":{"type":"noul","noul":0.1},"reason":{"type":"noul","noul":0.1},"summarize":{"type":"noul","noul":0.1}}}"#.utf8), status)
    }
    func contexts() throws -> [Context] {
        try requests.map { request in
            let object = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: Any]
            return try JSONCodec.decode(Context.self, from: JSONSerialization.data(withJSONObject: object["state"]!))
        }
    }
}

struct HomeBatchTests {
    private func records(_ states: [String]) throws -> [ConnectorSourceRecord] {
        let objects = states.enumerated().map { index, state in
            ["entity_id": "light.fixture_\(index)", "state": state, "attributes": ["friendly_name": "Synthetic room \(index)"]] as [String: Any]
        }
        return try HomeAssistantClient.records(data: JSONSerialization.data(withJSONObject: objects), server: "https://fixture.invalid")
    }
    private func engine(_ store: KnowledgeStore, _ transport: BatchTransport) throws -> IntelligenceEngine {
        IntelligenceEngine(store: store, classifier: try TypeSafeClassifier(apiKey: "synthetic-test-key", transport: transport))
    }
    @Test func oneRequestForWholeSnapshotEvenWithConcurrentWorkersAndDuplicateDelivery() async throws {
        let store = try KnowledgeStore(path: ":memory:"), transport = BatchTransport()
        let snapshot = try records(["on", "off", "on"])
        #expect(try await store.ingestSourceSnapshot(snapshot, connector: "home_assistant") == 3)
        #expect(try await store.ingestSourceSnapshot(snapshot, connector: "home_assistant") == 0)
        let engine = try engine(store, transport)
        async let a = engine.run(limit: 4)
        async let b = engine.run(limit: 4)
        let reports = try await [a, b]
        #expect(reports.map(\.completed).reduce(0, +) == 1)
        #expect(await transport.requests.count == 1)
        let context = try #require(await transport.contexts().first)
        #expect(context.event.type == "home.batch")
        #expect(context.relatedEvidence.count == 3)
        #expect(context.recentEvents.isEmpty)
        #expect(context.world == nil)
        #expect(context.sourceFacts == [])
        #expect(try await store.eventCount() == 4)
        #expect(try await store.queue().filter { $0.status == "batched" }.count == 3)
        #expect(try await store.queue().filter { $0.status == "succeeded" }.count == 1)
        #expect(try await store.decisions().count == 1)
        for member in context.relatedEvidence {
            #expect(try await store.decision(eventID: member.id) == nil)
            let detail = try await store.sourceDetail(eventID: member.id)
            #expect(detail.stages.first { $0.stage == "classification" }?.relatedEventID == context.event.id)
        }
        let detail = try await store.sourceDetail(eventID: context.event.id)
        #expect(detail.artifacts.contains { $0.kind == "response" && $0.provider == "typesafe" })
    }
    @Test func nextBatchContainsOnlyChangesAndTheirPreviousStates() async throws {
        let store = try KnowledgeStore(path: ":memory:"), transport = BatchTransport()
        _ = try await store.correct(subject: "person:self", predicate: "job", value: "Unrelated private job context")
        _ = try await store.ingestSourceSnapshot(records(["on", "off"]), connector: "home_assistant")
        _ = try await engine(store, transport).run()
        _ = try await store.ingestSourceSnapshot(records(["off", "off"]), connector: "home_assistant")
        _ = try await engine(store, transport).run()
        let contexts = try await transport.contexts()
        #expect(contexts.count == 2)
        #expect(contexts[1].relatedEvidence.count == 1)
        #expect(contexts[1].relatedEvidence[0].content.contains("State: off"))
        #expect(contexts[1].recentEvents.count == 1)
        #expect(contexts[1].recentEvents[0].content.contains("State: on"))
        #expect(!String(decoding: await transport.requests[1].httpBody!, as: UTF8.self).contains("Unrelated private job context"))
    }
    @Test func failuresRetryTheSameBatchWithoutPerEntityFallback() async throws {
        let store = try KnowledgeStore(path: ":memory:"), transport = BatchTransport(status: 503)
        _ = try await store.ingestSourceSnapshot(records(["on", "off"]), connector: "home_assistant")
        let engine = try engine(store, transport)
        #expect(try await engine.run(limit: 1).deferred == 1)
        #expect(try await store.decisions().isEmpty)
        #expect(try await engine.run().completed == 0)
        #expect(await transport.requests.count == 1)
        #expect(try await store.queue().filter { $0.status == "batched" }.count == 2)
        try await store.retryFailures()
        try await store.clearProviderPause("typesafe")
        await transport.setStatus(200)
        #expect(try await engine.run().completed == 1)
        #expect(await transport.requests.count == 2)
        let contexts = try await transport.contexts()
        #expect(contexts[0].event.id == contexts[1].event.id)
        #expect(contexts[0].relatedEvidence == contexts[1].relatedEvidence)
    }
    @Test func invalidSnapshotRollsBackEvidenceMembershipAndQueue() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        var invalid = try records(["on"])
        invalid.append(ConnectorSourceRecord(id: "invalid", name: "", content: "Synthetic invalid source"))
        await #expect(throws: Error.self) { try await store.ingestSourceSnapshot(invalid, connector: "home_assistant") }
        #expect(try await store.eventCount() == 0)
        #expect(try await store.queue().isEmpty)
        #expect(try await store.sourceRecords("home_assistant").isEmpty)
    }
    @Test func savedBatchSurvivesReopenAndOversizeBatchNeverPartiallySends() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let path = root.appendingPathComponent("fixture.sqlite").path
        let snapshot = try records(["on", "off"])
        do {
            let store = try KnowledgeStore(path: path)
            _ = try await store.ingestSourceSnapshot(snapshot, connector: "home_assistant")
        }
        let reopened = try KnowledgeStore(path: path), transport = BatchTransport()
        #expect(try await reopened.ingestSourceSnapshot(snapshot, connector: "home_assistant") == 0)
        #expect(try await engine(reopened, transport).run().completed == 1)
        #expect(await transport.requests.count == 1)
        let large = try KnowledgeStore(path: ":memory:"), untouched = BatchTransport()
        let records = (0..<5).map { ConnectorSourceRecord(id: "fixture:\($0)", name: "Synthetic large source", content: String(repeating: "x", count: 60_000)) }
        _ = try await large.ingestSourceSnapshot(records, connector: "home_assistant")
        #expect(try await engine(large, untouched).run(limit: 1).deferred == 1)
        #expect(await untouched.requests.isEmpty)
        #expect(try await large.eventCount() == 6)
        #expect(try await large.decisions().isEmpty)
    }
    @Test func unattemptedLegacyBacklogGroupsByWindowAndAccount() async throws {
        let store = try KnowledgeStore(path: ":memory:"), transport = BatchTransport()
        let now = Date(), old = now.addingTimeInterval(-1200)
        _ = try await store.ingestSourceSnapshot(records(["on", "off"]), connector: "home_assistant", now: old, batchHomeClassification: false)
        _ = try await store.ingestSourceSnapshot(records(["off", "on"]), connector: "home_assistant", now: now, account: "other", batchHomeClassification: false)
        #expect(try await engine(store, transport).run().completed == 2)
        let contexts = try await transport.contexts()
        #expect(contexts.count == 2)
        #expect(contexts.allSatisfy { $0.relatedEvidence.count == 2 })
        #expect(contexts.allSatisfy { Set($0.relatedEvidence.map { $0.source.account }).count == 1 })
    }
    @Test func dueLegacyRetriesJoinBatchAndKeepEarlierAttemptsInspectable() async throws {
        let store = try KnowledgeStore(path: ":memory:"), transport = BatchTransport()
        let baseline = Date(timeIntervalSince1970: floor(Date().timeIntervalSince1970 / 600) * 600 - 590)
        _ = try await store.ingestSourceSnapshot(records(["on", "off"]), connector: "home_assistant", now: baseline, batchHomeClassification: false)
        let id = try #require(await store.queue().first?.eventID)
        let lease = try #require(await store.acquire(now: baseline.addingTimeInterval(10), eventIDs: [id]))
        try await store.fail(lease, error: "Synthetic temporary provider failure", now: baseline.addingTimeInterval(11))
        #expect(try await engine(store, transport).run().completed == 1)
        #expect(await transport.requests.count == 1)
        #expect(try await transport.contexts().first?.relatedEvidence.count == 2)
        let member = try #require(await store.queue().first { $0.eventID == id })
        #expect(member.status == "batched" && member.attempts == 1)
        let detail = try await store.sourceDetail(eventID: id)
        #expect(detail.attempts.contains { $0.commitOutcome == "failed" })
        #expect(detail.stages.first { $0.stage == "classification" }?.relatedEventID != nil)
    }

    @Test func userCorrectionDuringRequestDiscardsBatchDecision() async throws {
        let store = try KnowledgeStore(path: ":memory:"), snapshot = try records(["on", "off"])
        _ = try await store.ingestSourceSnapshot(snapshot, connector: "home_assistant")
        let subject = "home:" + ConnectorSourceRecord.identifier(snapshot[0].id)
        let transport = BatchTransport(correctionStore: store, correctionSubject: subject)
        #expect(try await engine(store, transport).run(limit: 1).stale == 1)
        #expect(await transport.requests.count == 1)
        #expect(try await store.decisions().isEmpty)
        #expect(try await store.queue().filter { $0.status == "pending" }.count == 1)
    }
}
