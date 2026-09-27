import Foundation

public enum MessageKind: String, Codable, CaseIterable, Sendable {
    case request, planChange = "plan_change", commitment, information, social, noise, uncertain
}

public struct MessageAssessment: Codable, Sendable {
    public let kind: MessageKind
    public let confidence: Double
    public let replyNeeded: Double
    public let actionNeeded: Double?
    public let taskReviewNeeded: Double?
    public let timeSensitive: Double
    public let commitmentChanged: Double
    public let contextConflict: Double
    public let meaningfulUpdate: Double
    public let needsReasoning: Double
    public let questionVersion: String

    public init(kind: MessageKind, confidence: Double, replyNeeded: Double, timeSensitive: Double,
                commitmentChanged: Double, contextConflict: Double, meaningfulUpdate: Double, needsReasoning: Double, actionNeeded: Double? = nil, taskReviewNeeded: Double? = nil) {
        self.actionNeeded=actionNeeded; self.taskReviewNeeded=taskReviewNeeded
        self.kind = kind; self.confidence = confidence; self.replyNeeded = replyNeeded
        self.timeSensitive = timeSensitive; self.commitmentChanged = commitmentChanged
        self.contextConflict = contextConflict; self.meaningfulUpdate = meaningfulUpdate
        self.needsReasoning = needsReasoning; questionVersion = "message-actions-v3"
    }

    func validate() throws {
        guard [taskReviewNeeded ?? 0, actionNeeded ?? 0, confidence, replyNeeded, timeSensitive, commitmentChanged, contextConflict, meaningfulUpdate, needsReasoning]
            .allSatisfy({ $0.isFinite && (0...1).contains($0) }) else {
            throw MapleError.provider("Jev returned an invalid message assessment.")
        }
    }
}

extension Decision {
    public var userPrompt: String {
        guard let message = assessment.message else { return "What would you like Maple to know or do about this?" }
        if message.contextConflict >= 0.85 { return "This may conflict with the context Maple has. Which plan or information should Maple use?" }
        if (message.actionNeeded ?? 0) >= 0.85 && message.replyNeeded < 0.85 {return "This message appears to need an action. Review the suggested next step."}
        return "This message appears to need your reply. What would you like to tell Maple about how you’ll handle it?"
    }
}

extension Policy {
    static func messageDecision(context: Context, assessment: Assessment, signals: MessageAssessment, now: Date) -> Decision {
        let historical = context.event.type == "message.history" || now.timeIntervalSince(context.event.occurredAt) > 86_400
        let inbound = context.event.type == "message.received"
        let route: Route
        let reason: String
        if historical {
            route = signals.meaningfulUpdate >= 0.8 ? .summarize : .retain
            reason = "Historical import: retain useful context without prompting or interrupting."
        } else if inbound && signals.contextConflict >= 0.85 {
            route = .askUser; reason = "Context conflict met 0.85; ask the user to resolve it."
        } else if inbound && signals.replyNeeded >= 0.85 && (signals.actionNeeded ?? 0) >= 0.5 {
            route = .askUser; reason = "Reply needed met 0.85 and action needed met 0.50; offer a local response prompt."
        } else if inbound && signals.timeSensitive >= 0.9 && signals.meaningfulUpdate >= 0.8 {
            route = .notify; reason = "Time sensitivity met 0.90 with meaningful update at least 0.80."
        } else if signals.needsReasoning >= 0.85 && signals.meaningfulUpdate >= 0.8 {
            route = .reason; reason = "Reasoning needed met 0.85; create a proposal for deeper analysis."
        } else if signals.meaningfulUpdate >= 0.8 || signals.commitmentChanged >= 0.85 {
            route = .summarize; reason = "New information or a changed commitment should update a summary proposal."
        } else {
            route = .retain; reason = "No interruption or summary threshold met. Retain the observation."
        }
        let trace = ["Message kind: \(signals.kind.rawValue), confidence \(signals.confidence).",
                     "Questions: \(signals.questionVersion). Task review \(signals.taskReviewNeeded ?? 0); reply \(signals.replyNeeded); action \(signals.actionNeeded ?? 0); time-sensitive \(signals.timeSensitive); commitment \(signals.commitmentChanged); conflict \(signals.contextConflict); new information \(signals.meaningfulUpdate); reasoning \(signals.needsReasoning).",
                     "Thread context: \(context.recentEvents.count) recent observations, \(context.relatedEvidence.count) evidence records.",
                     "Classifier: \(assessment.provider)/\(assessment.model).",
                     signals.warrantsTaskReview ? "Task screening: deeper review requested; this is not yet a task." : "Task screening: no deeper task review requested.", reason]
        return Decision(eventID: context.event.id, route: route, assessment: assessment, context: context,
                        explanation: trace, policyVersion: "message-routing-v2", createdAt: now)
    }
}

// Screening authorizes deeper local review, never a task, interruption or external action.
extension MessageAssessment {
    public var warrantsTaskReview: Bool {
        (taskReviewNeeded ?? 0) >= 0.5 || (actionNeeded ?? 0) >= 0.5 || commitmentChanged >= 0.5
    }
}
