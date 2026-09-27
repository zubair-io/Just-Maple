import Foundation
import Testing
@testable import MapleCore

@Test func messageEvaluationUsesRequestedExtractorAndReportsFailureWithoutFallback() async throws {
    let report = try await MessageTaskEvaluation.run(extractor:EmptyEvaluationExtractor(),provider:"synthetic-test")
    #expect(report["mode"] == "live-synthetic-test-synthetic-message-tasks")
    #expect(report["passed"] == "false")
    #expect(report["direct-request-passed"] == "false")
    #expect(report["tentative-plan-passed"] == "true")
}
private struct EmptyEvaluationExtractor:TaskCandidateExtractor {
    func extract(_ context:Context,activities:[LifeActivity]) async throws -> [TaskSuggestion] {
        #expect(context.event.source.account == "synthetic-evaluation")
        #expect(context.recentEvents.allSatisfy{$0.source.account == "synthetic-evaluation"})
        return []
    }
}
