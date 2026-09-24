import Foundation

public enum MessageEvaluation {
    /// Synthetic message content through the real provider; never reads the user's Messages database.
    public static func run(classifier: any Classifier, directory: URL) async throws -> EvaluationReport {
        guard !FileManager.default.fileExists(atPath: directory.path) else { throw MapleError.invalid("Use a new message evaluation directory.") }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let cases: [(String, String, String)] = [
            ("reply", "message.received", "Thread: Alex\nSender: Alex\nDirection: incoming\n\nCan you confirm whether you can join dinner tonight at 7? Please let me know."),
            ("noise", "message.received", "Thread: Alex\nSender: Alex\nDirection: incoming\n\nThanks! 👍"),
            ("history", "message.history", "Thread: Alex\nSender: Alex\nDirection: incoming\n\nCan you confirm whether you can join dinner tonight at 7? Please let me know."),
            ("outgoing", "message.sent", "Thread: Alex\nSender: Me\nDirection: outgoing\n\nCan you confirm whether you can join dinner tonight at 7? Please let me know."),
            ("update", "message.received", "Thread: Alex\nSender: Alex\nDirection: incoming\n\nDinner has moved from 7 to 8 tonight at Elm Cafe. No reply needed; just making sure you have the new time.")
        ]
        var decisions: [Decision] = []
        var completed = 0
        var requestStore: KnowledgeStore?
        for (id, type, text) in cases {
            let store = try KnowledgeStore(path: directory.appendingPathComponent(id + ".sqlite").path)
            let event = Event(id: "synthetic-message-" + id, type: type,
                              source: Source(connector: "imessage", account: "synthetic-evaluation", externalID: id, revision: "1"),
                              occurredAt: Date(), subjects: ["person:self", "thread:imessage:synthetic-alex"], content: text)
            try await store.ingest(event)
            completed += try await IntelligenceEngine(store: store, classifier: classifier).run().completed
            decisions += try await store.decisions()
            if id == "reply" { requestStore = store }
        }
        var feedbackDecision: Decision?
        var replayCompleted = -1
        var answered = false
        if let store = requestStore, let prompt = try await store.workItems().first(where: { $0.kind == "ask_user" }) {
            let id = try await store.respond(to: prompt.id, text: "I will attend dinner at 7. I have already replied to Alex confirming. This request is resolved.")
            completed += try await IntelligenceEngine(store: store, classifier: classifier).run().completed
            feedbackDecision = try await store.decisions().first { $0.eventID == id }
            if let feedbackDecision { decisions.append(feedbackDecision) }
            answered = try await store.workItems().first { $0.id == prompt.id }?.status == "answered"
            replayCompleted = try await IntelligenceEngine(store: store, classifier: classifier).run().completed
        }
        func route(_ id: String) -> Route? { decisions.first { $0.eventID == "synthetic-message-" + id }?.route }
        let checks = [
            EvaluationCheck(name: "All six live classifications completed", passed: completed == 6, detail: "Completed \(completed)/6; failed requests remain in per-case databases."),
            EvaluationCheck(name: "Incoming request prompts user", passed: route("reply") == .askUser, detail: route("reply")?.rawValue ?? "missing"),
            EvaluationCheck(name: "Acknowledgment stays quiet", passed: route("noise") == .retain, detail: route("noise")?.rawValue ?? "missing"),
            EvaluationCheck(name: "History never interrupts", passed: route("history") != nil && ![Route.askUser, .notify].contains(route("history")!), detail: route("history")?.rawValue ?? "missing"),
            EvaluationCheck(name: "Outgoing request does not ask user to reply", passed: route("outgoing") != nil && ![Route.askUser, .notify].contains(route("outgoing")!), detail: route("outgoing")?.rawValue ?? "missing"),
            EvaluationCheck(name: "Plan update is retained as useful work", passed: [.notify, .summarize, .reason].contains(route("update") ?? .retain), detail: route("update")?.rawValue ?? "missing"),
            EvaluationCheck(name: "User response closes loop without another reply prompt", passed: answered && feedbackDecision != nil && feedbackDecision?.route != .askUser && replayCompleted == 0, detail: "answered=\(answered); feedback=\(feedbackDecision?.route.rawValue ?? "missing"); replay=\(replayCompleted)")
        ]
        let report = EvaluationReport(mode: "live-typesafe-synthetic-imessage", checks: checks, decisions: decisions)
        try JSONCodec.encode(report).write(to: directory.appendingPathComponent("evaluation.json"), options: .atomic)
        return report
    }
}
