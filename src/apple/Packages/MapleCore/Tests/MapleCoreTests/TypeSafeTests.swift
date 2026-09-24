import Foundation
import Testing
@testable import MapleCore

actor CapturingTransport: HTTPTransport {
    let data: Data
    let status: Int
    var request: URLRequest?
    init(data: Data, status: Int = 200) { self.data = data; self.status = status }
    func send(_ request: URLRequest) async throws -> (Data, Int) {
        self.request = request; return (data, status)
    }
}

struct TypeSafeTests {
    func payload(probability: Double = 0.95) throws -> Data {
        var distribution = Dictionary(uniqueKeysWithValues: JobStage.allCases.map { ($0.rawValue, 0.0) })
        distribution["offer_accepted"] = 1
        return try JSONSerialization.data(withJSONObject: [
            "model": "jev-test-version", "answers": [
                "notify": ["type": "noul", "noul": probability],
                "ask_user": ["type": "noul", "noul": 0.1],
                "reason": ["type": "noul", "noul": 0.1],
                "summarize": ["type": "noul", "noul": 0.9],
                "contains_facts": ["type": "noul", "noul": 0.95],
                "job_stage": ["type": "choice", "choice": "offer_accepted", "confidence": 0.99, "probabilities": distribution],
            ],
        ])
    }
    func context() async throws -> Context {
        let store = try KnowledgeStore(path: ":memory:")
        try await store.ingest(DemoScenario.events()[0])
        return try await store.context(for: "demo-offer-note")
    }

    @Test func requestAndResponseFollowTypedContract() async throws {
        let transport = CapturingTransport(data: try payload())
        let classifier = try TypeSafeClassifier(apiKey: "test-only-key", model: "pinned-test-model", transport: transport)
        let result = try await classifier.classify(context())
        #expect(result.assessment.jobStage == .offerAccepted)
        #expect(result.assessment.model == "jev-test-version")
        let request = try #require(await transport.request)
        #expect(request.url?.absoluteString == "https://api.typesafe.ai/v1/systemone")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer test-only-key")
        let body = try #require(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any])
        #expect(body["model"] as? String == "pinned-test-model")
        #expect(body["state"] is [String: Any])
        let questions = try #require(body["questions"] as? [String: [String: Any]])
        #expect(questions["ask_user"]?["type"] as? String == "noul")
        #expect(questions["job_stage"]?["type"] as? String == "choice")
    }

    @Test func invalidProbabilitiesAndMissingAnswersFailClosed() async throws {
        let context = try await context()
        for data in [try payload(probability: 1.5), Data("{\"model\":\"test\",\"answers\":{}}".utf8), Data("not json".utf8)] {
            let classifier = try TypeSafeClassifier(apiKey: "test-only-key", transport: CapturingTransport(data: data))
            await #expect(throws: MapleError.self) { try await classifier.classify(context) }
        }
    }

    @Test func authenticationErrorsDoNotStoreResponseBody() async throws {
        let classifier = try TypeSafeClassifier(apiKey: "test-only-key", transport: CapturingTransport(data: Data("private error body".utf8), status: 401))
        do {
            _ = try await classifier.classify(context())
            Issue.record("Expected HTTP failure")
        } catch {
            #expect(error.localizedDescription.contains("401"))
            #expect(!error.localizedDescription.contains("private error body"))
        }
    }
}
