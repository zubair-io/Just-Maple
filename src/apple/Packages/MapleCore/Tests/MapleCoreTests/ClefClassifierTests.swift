import Foundation
import Testing
@testable import MapleCore

private actor ClefFixtureTransport: HTTPTransport {
    let status: Int
    let data: Data
    var requests: [URLRequest] = []
    init(_ status: Int = 200, data: Data) { self.status = status; self.data = data }
    func send(_ request: URLRequest) async throws -> (Data, Int) {
        requests.append(request)
        return (data, status)
    }
}
private actor ClefFixtureAudit {
    var events: [ProviderAuditEvent] = []
    func append(_ event: ProviderAuditEvent) { events.append(event) }
}
private actor ClefSetupFixture: HTTPTransport {
    var requests: [URLRequest] = []
    let missing: Bool
    let context: Int
    init(missing: Bool, context: Int = 65536) { self.missing = missing; self.context = context }
    func send(_ request: URLRequest) async throws -> (Data, Int) {
        requests.append(request)
        if missing && requests.count == 1 { return (Data(), 404) }
        if request.url?.path == "/api/create" { return (Data(#"{"status":"success"}"#.utf8), 200) }
        return (try JSONSerialization.data(withJSONObject: ["capabilities": ["decision"], "parameters": "num_ctx \(context)\n"]), 200)
    }
}

struct ClefClassifierTests {
    private func event() -> Event {
        Event(id: "synthetic-clef", type: "message.received", source: .init(connector: "imessage", account: "fixture", externalID: "fixture", revision: "1"), occurredAt: Date(), subjects: ["person:self"], content: "Synthetic transport fixture: I will send the estimate tomorrow.")
    }
    private func response() throws -> Data {
        var answers: [String: [String: Any]] = [:]
        for key in TypeSafeClassifier.messageQuestions.keys where key != "message_kind" { answers[key] = ["type": "noul", "noul": 0.1] }
        answers["task_review_needed"] = ["type": "noul", "noul": 0.9]
        answers["contains_facts"] = ["type": "noul", "noul": 0.1]
        answers["message_kind"] = ["type": "choice", "choice": "commitment", "confidence": 1.0,
            "probabilities": Dictionary(uniqueKeysWithValues: MessageKind.allCases.map { ($0.rawValue, $0 == .commitment ? 1.0 : 0.0) })]
        return try JSONSerialization.data(withJSONObject: ["model": "synthetic-clef-model", "answers": answers])
    }
    @Test func localContractKeepsEvidenceAuditAndJevQuestionsSeparate() async throws {
        let raw = try response(), transport = ClefFixtureTransport(data: raw), audit = ClefFixtureAudit()
        let context = Context(event: event(), currentState: [], recentEvents: [], relatedEvidence: [], version: "synthetic")
        let result = try await ClefClassifier(transport: transport).classifyAudited(context) { await audit.append($0) }
        let requests = await transport.requests
        #expect(requests.count == 1)
        let request = try #require(requests.first)
        #expect(request.url?.absoluteString == "http://127.0.0.1:11434/v1/systemone")
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        #expect(result.assessment.provider == "ollama-clef")
        #expect(result.assessment.message?.taskReviewNeeded == 0.9)
        #expect(result.assessment.message?.questionVersion == "clef-message-obligations-v1")
        #expect(result.rawResponse == raw)
        #expect(result.inputContext?.event.id == context.event.id)
        let events = await audit.events
        #expect(events.map(\.kind) == ["context", "dispatch", "response"])
        #expect(events.allSatisfy { $0.provider == "ollama-clef" })
        let body = try #require(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any])
        #expect(body["model"] as? String == ClefClassifier.model)
        let questions = try #require(body["questions"] as? [String: [String: Any]])
        #expect((questions["task_review_needed"]?["criteria"] as? [String: String])?.count == 2)
        #expect(TypeSafeClassifier.messageQuestions["task_review_needed"]?.criteria == nil)
        // Explicit opt-in export for isolated live quality evaluation; never performs inference.
        if let path = ProcessInfo.processInfo.environment["MAPLE_CLEF_REQUEST_EXPORT"] {
            try request.httpBody!.write(to: URL(fileURLWithPath: path), options: .atomic)
        }
    }
    @Test func unavailableLocalModelLeavesWorkPendingWithoutPausingJevOrSavingErrorBody() async throws {
        let store = try KnowledgeStore(path: ":memory:"), transport = ClefFixtureTransport(503, data: Data("private error body".utf8))
        _ = try await store.ingest(event())
        let report = try await IntelligenceEngine(store: store, classifier: ClefClassifier(transport: transport)).run(limit: 1)
        #expect(report.completed == 0); #expect(report.deferred == 1)
        #expect(try await store.eventCount() == 1)
        #expect(try await store.providerPause("typesafe") == nil)
        let queue = try await store.queue()
        #expect(queue.count == 1)
        #expect(!queue.description.contains("private error body"))
        #expect(await transport.requests.count == 1)
    }
    @Test func invalidOrOversizedInputIsBlockedWithoutRepeatingOrRepairing() async throws {
        for status in [200, 400, 413] {
            let store = try KnowledgeStore(path: ":memory:"), transport = ClefFixtureTransport(status, data: Data("private diagnostic".utf8))
            _ = try await store.ingest(event())
            let engine = IntelligenceEngine(store: store, classifier: ClefClassifier(transport: transport))
            #expect(try await engine.run(limit: 1).deferred == 1)
            #expect(try await engine.run(limit: 1).completed == 0)
            #expect(await transport.requests.count == 1)
            #expect(try await store.providerPause("typesafe") == nil)
        }
    }
    @Test func setupReusesInstalledWeightsAndDoesNotOverwriteWrongExistingConfiguration() async throws {
        let fresh = ClefSetupFixture(missing: true)
        _ = try await ClefClassifier.load(transport: fresh)
        let requests = await fresh.requests
        #expect(requests.map { $0.url?.path } == ["/api/show", "/api/show", "/api/create", "/api/show"])
        let body = try #require(JSONSerialization.jsonObject(with: requests[2].httpBody!) as? [String: Any])
        #expect(body["from"] as? String == "clef:latest")
        #expect((body["parameters"] as? [String: Int])?["num_ctx"] == 65536)
        let existing = ClefSetupFixture(missing: false, context: 16384)
        await #expect(throws: MapleError.self) { try await ClefClassifier.load(transport: existing) }
        #expect(await existing.requests.count == 1)
    }
    @Test func localTransportRefusesRemoteEndpointsBeforeSending() async {
        await #expect(throws: MapleError.self) {
            try await ClefHTTPTransport().send(URLRequest(url: URL(string: "https://example.com/v1/systemone")!))
        }
    }
}
