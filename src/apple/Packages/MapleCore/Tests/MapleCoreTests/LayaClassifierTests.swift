import Foundation
import Testing
@testable import MapleCore

private actor LayaAuditRecorder {
    var values: [ProviderAuditEvent] = []
    var predictions = 0
    func record(_ value: ProviderAuditEvent) { values.append(value) }
    func predicted() { predictions += 1 }
}
struct LayaClassifierTests {
    private func context(text: String = "Please confirm our appointment.") -> Context {
        let event = Event(type: "message.received", source: Source(connector: "gmail", account: "synthetic", externalID: "laya-contract", revision: "1"), occurredAt: Date(), subjects: ["person:self"], content: "Direction: incoming\n" + text)
        return Context(event: event, currentState: [], recentEvents: [], relatedEvidence: [], version: "synthetic")
    }
    private func answer(_ question: LayaQuestion) -> LayaAnswer {
        let count = question.options.count
        let probabilities = count == 2 ? [0.1, 0.9] : [0.9] + Array(repeating: 0.1 / Double(count-1), count: count-1)
        return LayaAnswer(distribution: probabilities, options: question.options.map(\.label), tokenCount: 120, latency: 0.02)
    }
    @Test func localAssessmentPreservesContractAndAuditsExactInputs() async throws {
        let recorder = LayaAuditRecorder()
        let classifier = LayaClassifier { _, question in answer(question) }
        var input = context()
        input = Context(event: input.event, currentState: [Claim(id: "correction", subject: "person:self", predicate: "appointment.status", value: "already confirmed", evidenceEventID: "user-evidence", observedAt: Date(), confidence: 1, origin: "user")], recentEvents: [], relatedEvidence: [], version: "synthetic")
        let result = try await classifier.classifyAudited(input) { await recorder.record($0) }
        #expect(result.assessment.provider == "laya-coreml")
        #expect(result.assessment.message?.kind == .request)
        #expect(result.assessment.containsFacts == 0.9)
        #expect(result.inputContext?.currentState == input.currentState)
        let audits = await recorder.values
        #expect(audits.filter { $0.kind == "context" }.count == 10)
        #expect(audits.filter { $0.kind == "response" }.count == 10)
        let dispatches=audits.filter{$0.kind=="dispatch"}
        #expect(dispatches.count==10 && Set(dispatches.map(\.invocationID)).count==10)
        for dispatch in dispatches {
            let index=try #require(audits.firstIndex{$0.kind=="dispatch" && $0.invocationID==dispatch.invocationID})
            #expect(audits[index-1].kind=="context" && audits[index-1].invocationID==dispatch.invocationID)
            #expect(dispatch.dispatch?.evidence.contains{$0.eventID==input.event.id} == true)
            #expect(dispatch.dispatch?.evidence.first{$0.eventID=="user-evidence"}?.occurredAt == nil)
        }
        #expect(audits.contains { $0.payload.contains("already confirmed") })
        #expect(!String(decoding: result.rawResponse, as: UTF8.self).contains("typesafe"))
    }
    @Test func overflowPreflightRunsBeforeAnyPredictionAndCannotBecomeRetain() async throws {
        let recorder = LayaAuditRecorder(), input = context(text: String(repeating: "Long source. ", count: 500))
        let classifier = LayaClassifier(predict: { _, question in await recorder.predicted(); return answer(question) }, preflight: { _, _ in throw LayaError.capacity("Synthetic overflow") })
        let store = try KnowledgeStore(path: ":memory:")
        _ = try await store.ingest(input.event)
        let report = try await IntelligenceEngine(store: store, classifier: classifier).run(limit: 1)
        #expect(report.completed == 0 && report.deferred == 1)
        #expect(await recorder.predictions == 0)
        #expect(try await store.decisions().isEmpty)
        #expect(try await store.workItems().isEmpty)
    }
    @Test func partialInferenceFailureAndInvalidDistributionCommitNothing() async throws {
        for invalid in [false, true] {
            let classifier = LayaClassifier { _, question in
                if question.instructions.hasPrefix("Does the user still owe") {
                    if invalid { return LayaAnswer(distribution: [0.4, 0.9], options: ["A", "B"], tokenCount: 100, latency: 0) }
                    throw LayaError.inference("Synthetic model failure")
                }
                return answer(question)
            }
            let store = try KnowledgeStore(path: ":memory:")
            _ = try await store.ingest(context().event)
            let report = try await IntelligenceEngine(store: store, classifier: classifier).run(limit: 1)
            #expect(report.completed == 0 && report.deferred == 1)
            #expect(try await store.decisions().isEmpty)
        }
    }
    @Test func renderingKeepsTailResolutionAndCorrectionRatherThanTruncating() throws {
        var input = context(text: String(repeating: "Please reply. ", count: 600) + "CANCELLED: already resolved, no action needed.")
        input = Context(event: input.event, currentState: [Claim(id: "explicit", subject: "person:self", predicate: "test.status", value: "closed", evidenceEventID: "correction", observedAt: Date(), confidence: 1, origin: "user")], recentEvents: [], relatedEvidence: [], version: "synthetic")
        let rendered = try LayaClassifier.render(input)
        #expect(rendered.contains("CANCELLED: already resolved, no action needed."))
        #expect(rendered.contains("closed") && rendered.contains("user"))
    }
    @Test func manualFactCheckUsesActualProviderProvenance() async throws {
        let classifier = LayaClassifier { _, question in answer(question) }
        let store = try KnowledgeStore(path: ":memory:"), input = context()
        _ = try await store.ingest(input.event)
        let checked = try await store.checkSourceFacts(eventID: input.event.id, classifier: classifier)
        #expect(checked.probability == 0.9)
        let checks = try await store.factChecks()
        #expect(checks.first?.provider == "laya-coreml")
    }
}
