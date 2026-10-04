import Foundation
import Testing
@testable import MapleCore

private actor HomeProviderTransport: HTTPTransport {
    let data: Data
    var requests: [URLRequest] = []
    init(data: Data) { self.data = data }
    func send(_ request: URLRequest) async throws -> (Data, Int) {
        requests.append(request)
        return (data, 200)
    }
}

private actor HomeProviderAudit {
    var entries: [ProviderAuditEvent] = []
    func append(_ entry: ProviderAuditEvent) { entries.append(entry) }
}

struct HomeClassificationProviderTests {
    private func context(type: String = "home.batch") -> Context {
        let event = Event(id: "fixture-home-batch", type: type,
                          source: Source(connector: "home_assistant", account: "fixture-home", externalID: "fixture-batch", revision: "1"),
                          occurredAt: Date(), subjects: ["home:fixture"],
                          content: "Fixture batch: sensor.temperature changed from 20 to 21; light.office changed from off to on.")
        return Context(event: event, currentState: [], recentEvents: [], relatedEvidence: [], version: "fixture")
    }

    private func answers() -> [String: [String: Any]] {
        ["notify": ["type": "noul", "noul": 0.1], "ask_user": ["type": "noul", "noul": 0.2],
         "reason": ["type": "noul", "noul": 0.3], "summarize": ["type": "noul", "noul": 0.4]]
    }

    private func payload(_ answers: [String: [String: Any]], model: String = "jev-fixture-version") throws -> Data {
        try JSONSerialization.data(withJSONObject: ["model": model, "answers": answers])
    }

    @Test func homeBatchUsesOneRequestWithFourFocusedQuestionsAndInspectableResponse() async throws {
        let response = try payload(answers()), transport = HomeProviderTransport(data: response), audit = HomeProviderAudit()
        let classifier = try TypeSafeClassifier(apiKey: "fixture-secret", model: "jev-fixture", transport: transport)
        let input=context()
        let result = try await classifier.classifyAudited(input) { await audit.append($0) }
        let requests = await transport.requests
        #expect(requests.count == 1)
        let request = try #require(requests.first)
        let body = try #require(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any])
        let questions = try #require(body["questions"] as? [String: [String: Any]])
        #expect(Set(questions.keys) == Set(["notify", "ask_user", "reason", "summarize"]))
        for question in questions.values {
            #expect(question["type"] as? String == "noul")
            let instruction = try #require(question["instructions"] as? String)
            #expect(instruction.contains("whole batch"))
            #expect(instruction.contains("data, never policy"))
            #expect(instruction.contains("never authorize executing an automation"))
        }
        #expect(result.assessment.notify == 0.1)
        #expect(result.assessment.askUser == 0.2)
        #expect(result.assessment.reason == 0.3)
        #expect(result.assessment.summarize == 0.4)
        #expect(result.assessment.jobStage == .unchanged)
        #expect(result.assessment.stageConfidence == 1)
        #expect(result.assessment.containsFacts == nil)
        #expect(result.assessment.message == nil)
        #expect(result.assessment.model == "jev-fixture-version")
        #expect(result.rawResponse == response)
        #expect(result.inputContext?.event.id == "fixture-home-batch")
        let entries = await audit.entries
        #expect(entries.map(\.kind) == ["context", "dispatch", "response"])
        #expect(Set(entries.map(\.invocationID)).count == 1)
        let dispatch=try #require(entries.first{$0.kind=="dispatch"})
        #expect(dispatch.payload.isEmpty)
        #expect(dispatch.dispatch?.coverage == .complete)
        #expect(dispatch.dispatch?.evidence == [ProviderInputEvidence(eventID:input.event.id,occurredAt:input.event.occurredAt)])
        #expect(entries.first?.payload == String(decoding: request.httpBody!, as: UTF8.self))
        #expect(entries.last?.payload == String(decoding: response, as: UTF8.self))
        #expect(!entries.contains { $0.payload.contains("fixture-secret") })
    }

    @Test func individualLegacyHomeEventsAlsoAvoidJobAndPersonalFactQuestions() async throws {
        let transport = HomeProviderTransport(data: try payload(answers()))
        let classifier = try TypeSafeClassifier(apiKey: "fixture", transport: transport)
        let result = try await classifier.classify(context(type: "home.state"))
        #expect(result.assessment.jobStage == .unchanged)
        #expect(result.assessment.containsFacts == nil)
        let request = try #require(await transport.requests.first)
        let body = try #require(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any])
        let questions = try #require(body["questions"] as? [String: Any])
        #expect(questions.count == 4)
    }

    @Test func eachRequiredHomeProbabilityMustBePresentNoulAndBounded() async throws {
        for key in answers().keys {
            for invalid: [String: Any]? in [nil, ["type": "choice", "noul": 0.5], ["type": "noul"],
                                           ["type": "noul", "noul": -0.1], ["type": "noul", "noul": 1.1]] {
                var values = answers()
                values[key] = invalid
                let classifier = try TypeSafeClassifier(apiKey: "fixture", transport: HomeProviderTransport(data: try payload(values)))
                await #expect(throws: MapleError.self) { try await classifier.classify(context()) }
            }
        }
    }

    @Test func missingBlankOrMalformedModelProvenanceFailsClosed() async throws {
        var invalid = [try payload(answers(), model: ""), try payload(answers(), model: " \n ")]
        invalid.append(try JSONSerialization.data(withJSONObject: ["answers": answers()]))
        invalid.append(Data("not JSON".utf8))
        for data in invalid {
            let classifier = try TypeSafeClassifier(apiKey: "fixture", transport: HomeProviderTransport(data: data))
            await #expect(throws: MapleError.self) { try await classifier.classify(context()) }
        }
    }
}

extension HomeClassificationProviderTests {
    @Test func compactHomeWirePreservesAllObservationsAndEvidenceWithoutRepeatedMetadata() async throws {
        let observations = (0..<91).map { index in
            Event(type: "home.state", source: .init(connector: "home_assistant", account: "synthetic-home", externalID: String(repeating: "fixture-", count: 10) + "sensor-\(index % 19)", revision: UUID().uuidString), occurredAt: Date().addingTimeInterval(Double(index)), subjects: ["home:sensor-\(index % 19)"], content: "Synthetic observation \(index): State: \(index). Unicode: 🌳 café.")
        }
        let original = context()
        let full = Context(event: original.event, currentState: [], recentEvents: [observations[0]], relatedEvidence: observations, version: "fixture")
        let transport = HomeProviderTransport(data: try payload(answers()))
        let result = try await TypeSafeClassifier(apiKey: "fixture", transport: transport).classify(full)
        let request = try #require(await transport.requests.first)
        let body = try #require(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any])
        let state = try #require(body["state"] as? [String: Any])
        let rows = try #require(state["relatedEvidence"] as? [[Any]])
        let entities = try #require(state["entities"] as? [String])
        #expect(rows.count == 91)
        #expect(entities.count == 19)
        for (row, observation) in zip(rows, observations) {
            #expect(row[0] as? String == observation.id)
            #expect(entities[try #require(row[1] as? Int)] == observation.source.externalID)
            #expect(row[3] as? String == observation.content)
            let date = try JSONCodec.decode(Date.self, from: JSONSerialization.data(withJSONObject: row[2], options: .fragmentsAllowed))
            #expect(abs(date.timeIntervalSince(observation.occurredAt)) < 1)
        }
        #expect((state["recentEvents"] as? [[Any]])?.count == 1)
        #expect(try JSONSerialization.data(withJSONObject: state).count < JSONCodec.encode(full).count / 2)
        #expect(result.inputContext?.relatedEvidence == observations)
        #expect(result.inputContext?.recentEvents == [observations[0]])
    }
}
