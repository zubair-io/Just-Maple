import Foundation

public struct RunReport: Codable, Sendable {
    public var completed = 0
    public var deferred = 0
    public var stale = 0
}

public struct IntelligenceEngine: Sendable {
    public let store: KnowledgeStore
    private let classifier: any Classifier

    public init(store: KnowledgeStore, classifier: any Classifier) {
        self.store = store; self.classifier = classifier
    }

    public func run(limit: Int = 100, eventIDs:[String]? = nil) async throws -> RunReport {
        var report = RunReport()
        for _ in 0..<max(0, min(limit, 1000)) {
            guard let lease = try await store.acquire(now: Date(), eventIDs:eventIDs) else { break }
            do {
                let context = try await store.modelContext(for: lease.eventID)
                let result = try await classifier.classify(context)
                try result.assessment.validate()
                let decision = Policy.decide(context: result.inputContext ?? context, assessment: result.assessment)
                if try await store.finish(lease, decision: decision, raw: result.rawResponse, now: Date()) {
                    report.completed += 1
                } else { report.stale += 1 }
            } catch {
                // Never persist request/response bodies or credentials in queue errors.
                let message = (error as? MapleError)?.errorDescription ?? "Classification failed; retry required."
                try await store.fail(lease, error: message, now: Date())
                report.deferred += 1
            }
        }
        return report
    }
}

public enum Policy {
    public static func decide(context: Context, assessment: Assessment, now: Date = Date()) -> Decision {
        if let message = assessment.message {
            return messageDecision(context: context, assessment: assessment, signals: message, now: now)
        }
        let route: Route
        let reason: String
        // Initial policy: explicit user choice takes precedence over costly reasoning.
        if assessment.askUser >= 0.85 {
            route = .askUser; reason = "User-input probability \(assessment.askUser) met the 0.85 prompt threshold."
        } else if assessment.reason >= 0.85 {
            route = .reason; reason = "Reasoning probability \(assessment.reason) met the 0.85 proposal threshold."
        } else if assessment.notify >= 0.9 {
            route = .notify; reason = "Notification probability \(assessment.notify) met the 0.90 threshold."
        } else if assessment.summarize >= 0.8 && !(context.event.source.connector == "resume" && (assessment.containsFacts ?? 0) >= 0.85) {
            route = .summarize; reason = "Summary relevance \(assessment.summarize) met the 0.80 proposal threshold."
        } else {
            route = .retain; reason = "No response threshold was met; retained the event without a downstream action."
        }
        var trace = ["Observed \(context.event.type) from \(context.event.source.connector): \(context.event.id)."]
        trace += context.currentState.map { "Context: \($0.subject) \($0.predicate)=\($0.value), supported by \($0.evidenceEventID) (\($0.origin))." }
        trace.append("Classifier: \(assessment.provider)/\(assessment.model).")
        trace.append(reason)
        if let facts = assessment.containsFacts {
            trace.append("Fact relevance: \(facts). Extraction is an independent outcome (threshold 0.85); a résumé does not need a summary proposal merely to learn its facts.")
        }
        return Decision(eventID: context.event.id, route: route, assessment: assessment, context: context,
                        explanation: trace, policyVersion: assessment.containsFacts == nil ? "routing-v1" : "routing-v2-facts", createdAt: now)
    }
}
