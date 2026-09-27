import Foundation
import Testing
@testable import MapleCore

struct MessageScreeningTests {
    struct Fixture: Classifier {
        let action: Double
        let review: Double
        let reply: Double
        var update: Double = 0
        func classify(_ context: Context) async throws -> ClassifierResult {
            let signals = MessageAssessment(kind: .information, confidence: 0.9, replyNeeded: reply,
                timeSensitive: 0, commitmentChanged: 0, contextConflict: 0, meaningfulUpdate: update,
                needsReasoning: 0, actionNeeded: action, taskReviewNeeded: review)
            return ClassifierResult(assessment: Assessment(notify: 0, askUser: 0, reason: 0, summarize: 0,
                jobStage: .unchanged, stageConfidence: 1, model: "synthetic-screening", provider: "fixture", message: signals), rawResponse: Data("{}".utf8))
        }
    }
    @Test(arguments: ["gmail", "imessage"]) func reviewIsIndependentOfInterruptionAndIdempotent(connector: String) async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let event = Event(type: "message.received", source: Source(connector: connector, account: "synthetic", externalID: "review", revision: "1"), occurredAt: Date().addingTimeInterval(-172800), subjects: ["person:self", "thread:\(connector):synthetic"], content: "Direction: incoming\nBody: Please review the requested estimate before deciding.")
        try await store.ingest(event)
        _ = try await IntelligenceEngine(store: store, classifier: Fixture(action: 0.6, review: 0.8, reply: 0.2)).run()
        try await store.prepareIMessageTaskJobs()
        try await store.prepareIMessageTaskJobs()
        #expect(try await store.taskExtractionQueue().count == 1)
        #expect(try await store.decisions().first?.route == .retain)
        #expect(try await store.tasks().isEmpty == true)
        #expect(try await store.workItems().isEmpty == true)
    }
    @Test func optionalReplyDoesNotCreateAnInterruptionOrTaskReview() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let event = Event(type: "message.received", source: Source(connector: "gmail", account: "synthetic", externalID: "optional", revision: "1"), occurredAt: Date(), subjects: ["person:self"], content: "Optional feedback invitation.")
        try await store.ingest(event)
        _ = try await IntelligenceEngine(store: store, classifier: Fixture(action: 0.1, review: 0.1, reply: 0.95)).run()
        #expect(try await store.decisions().first?.route == .retain)
        #expect(try await store.taskExtractionQueue().isEmpty == true)
    }
    @Test func summaryAloneDoesNotEnqueueTaskReview() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let event = Event(type: "message.received", source: Source(connector: "gmail", account: "synthetic", externalID: "fyi", revision: "1"), occurredAt: Date(), subjects: ["person:self"], content: "The repair was completed successfully. No action required.")
        try await store.ingest(event)
        _ = try await IntelligenceEngine(store: store, classifier: Fixture(action: 0, review: 0, reply: 0, update: 0.95)).run()
        #expect(try await store.decisions().first?.route == .summarize)
        #expect(try await store.taskExtractionQueue().isEmpty == true)
    }
    @Test(arguments: [0.49, 0.5, 0.51]) func reviewBoundary(value: Double) {
        let signal = MessageAssessment(kind: .information, confidence: 0.9, replyNeeded: 0, timeSensitive: 0, commitmentChanged: 0, contextConflict: 0, meaningfulUpdate: 0, needsReasoning: 0, taskReviewNeeded: value)
        #expect(signal.warrantsTaskReview == (value >= 0.5))
    }
    @Test func invalidReviewProbabilityFailsValidation() throws {
        let signal = MessageAssessment(kind: .request, confidence: 1, replyNeeded: 0, timeSensitive: 0,
            commitmentChanged: 0, contextConflict: 0, meaningfulUpdate: 0, needsReasoning: 0,
            taskReviewNeeded: .nan)
        #expect(throws: MapleError.self) { try signal.validate() }
    }
    @Test func multibyteSourceExcerptRespectsProviderByteLimit() {
        let source = String(repeating:"Résumé 日本語 🪴 ",count:1500)
        let excerpt = KnowledgeStore.utf8Excerpt(source,limit:12000)
        #expect(excerpt.utf8.count <= 12000)
        #expect(source.hasPrefix(excerpt))
        #expect(!excerpt.contains("�"))
    }
    @Test func legacyStoredAssessmentStillDecodes() throws {
        let data = Data(#"{"kind":"information","confidence":0.9,"replyNeeded":0,"timeSensitive":0,"commitmentChanged":0,"contextConflict":0,"meaningfulUpdate":0,"needsReasoning":0,"questionVersion":"message-actions-v2"}"#.utf8)
        let signal = try JSONCodec.decode(MessageAssessment.self, from: data)
        #expect(signal.taskReviewNeeded == nil)
        #expect(!signal.warrantsTaskReview)
    }
}
