import Foundation

public enum DemoScenario {
    public static let job = "job:job-search"
    public static func events(now: Date = Date()) -> [Event] {
        let epoch = Date(timeIntervalSince1970: 1_789_992_000)
        return [
            Event(id: "demo-offer-note", type: "note.updated", source: Source(connector: "notes", account: "demo", externalID: "offer-note", revision: "1"),
                  occurredAt: epoch, receivedAt: now.addingTimeInterval(-3), subjects: [job],
                  content: "I accepted the Staff Engineer offer at Acorn today. I plan to close out my other interviews."),
            Event(id: "demo-recruiter-email", type: "email.received", source: Source(connector: "gmail", account: "demo", externalID: "recruiter-invite", revision: "1"),
                  occurredAt: epoch.addingTimeInterval(3600), receivedAt: now.addingTimeInterval(-2), subjects: [job],
                  content: "Hi, can you choose a time for your next interview with Birch next week? We would like to continue your application."),
            Event(id: "demo-newsletter", type: "email.received", source: Source(connector: "gmail", account: "demo", externalID: "newsletter", revision: "1"),
                  occurredAt: epoch.addingTimeInterval(7200), receivedAt: now.addingTimeInterval(-1), subjects: [job],
                  content: "Weekly careers newsletter: five tips for updating your resume. No reply needed."),
        ]
    }
}

/// A transport/persistence demonstration, explicitly NOT evidence of model intelligence.
/// Rejects unknown events so replay cannot silently act as a live classifier.
public struct DemoReplayClassifier: Classifier {
    public init() {}
    public func classify(_ context: Context) async throws -> ClassifierResult {
        let assessment: Assessment
        switch context.event.id {
        case "demo-offer-note":
            assessment = Assessment(notify: 0.1, askUser: 0.05, reason: 0.1, summarize: 0.95,
                                    jobStage: .offerAccepted, stageConfidence: 0.98, model: "synthetic-fixture-v1", provider: "fixture-replay")
        case "demo-recruiter-email":
            let accepted = context.currentState.contains { $0.subject == DemoScenario.job && $0.predicate == "job.status" && $0.value == "offer_accepted" }
            assessment = Assessment(notify: accepted ? 0.98 : 0.5, askUser: accepted ? 0.97 : 0.1, reason: 0.2, summarize: 0.9,
                                    jobStage: .unchanged, stageConfidence: 0.99, model: "synthetic-fixture-v1", provider: "fixture-replay")
        case "demo-newsletter":
            assessment = Assessment(notify: 0.01, askUser: 0.01, reason: 0.01, summarize: 0.05,
                                    jobStage: .unchanged, stageConfidence: 0.99, model: "synthetic-fixture-v1", provider: "fixture-replay")
        default: throw MapleError.invalid("Fixture replay accepts only the built-in synthetic demo events. Use --live for other inputs.")
        }
        return ClassifierResult(assessment: assessment, rawResponse: try JSONCodec.encode(assessment))
    }
}
