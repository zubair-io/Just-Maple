import Foundation

public struct EvaluationCheck: Codable, Sendable {
    public let name: String
    public let passed: Bool
    public let detail: String
}

public struct EvaluationReport: Codable, Sendable {
    public let mode: String
    public let checks: [EvaluationCheck]
    public let decisions: [Decision]
    public let passed: Bool

    init(mode: String, checks: [EvaluationCheck], decisions: [Decision]) {
        self.mode = mode; self.checks = checks; self.decisions = decisions
        self.passed = checks.allSatisfy(\.passed)
    }
}

public enum CoreEvaluation {
    /// Stores each condition in its own fresh database so no fixture results can contaminate a live run.
    public static func run(classifier: any Classifier, directory: URL, mode: String) async throws -> EvaluationReport {
        let acceptedPath = directory.appendingPathComponent("accepted.sqlite").path
        let searchingPath = directory.appendingPathComponent("searching.sqlite").path
        guard !FileManager.default.fileExists(atPath: acceptedPath), !FileManager.default.fileExists(atPath: searchingPath) else {
            throw MapleError.invalid("Evaluation requires a fresh output directory; existing evidence is never overwritten.")
        }
        let accepted = try KnowledgeStore(path: acceptedPath)
        for event in DemoScenario.events() { try await accepted.ingest(event) }
        let acceptedRun = try await IntelligenceEngine(store: accepted, classifier: classifier).run()
        let decisions = try await accepted.decisions()
        let state = try await accepted.state()
        let invite = decisions.first { $0.eventID == "demo-recruiter-email" }
        let news = decisions.first { $0.eventID == "demo-newsletter" }

        let searching = try KnowledgeStore(path: searchingPath)
        try await searching.correct(subject: DemoScenario.job, predicate: "job.status", value: "searching")
        try await searching.ingest(DemoScenario.events()[1])
        let searchingRun = try await IntelligenceEngine(store: searching, classifier: classifier).run()
        let control = try await searching.decisions().first
        let replayRun = try await IntelligenceEngine(store: accepted, classifier: classifier).run()
        let inbox = try await accepted.workItems().filter { $0.kind == "ask_user" }

        let checks = [
            EvaluationCheck(name: "All events classified", passed: acceptedRun.completed == 3 && searchingRun.completed == 1,
                            detail: "accepted: \(acceptedRun.completed)/3; searching: \(searchingRun.completed)/1; provider failures remain in each database queue"),
            EvaluationCheck(name: "Offer learned from note", passed: state.contains { $0.value == "offer_accepted" && $0.evidenceEventID == "demo-offer-note" && $0.origin == "inference" },
                            detail: "Requires classifier-derived state citing the note, not a pre-seeded accepted-offer fact."),
            EvaluationCheck(name: "Relevant evidence retrieved", passed: invite?.context.relatedEvidence.contains { $0.id == "demo-offer-note" } == true,
                            detail: "Recruiter context must contain the note evidence supporting acceptance."),
            EvaluationCheck(name: "Conflict prompts user", passed: invite?.route == .askUser,
                            detail: "Accepted-offer condition route: \(invite?.route.rawValue ?? "missing")"),
            EvaluationCheck(name: "Same email behaves differently without acceptance", passed: control != nil && control?.route != .askUser,
                            detail: "Searching condition route: \(control?.route.rawValue ?? "missing"); direct user-choice conflict should not be invented."),
            EvaluationCheck(name: "Newsletter stays quiet", passed: news?.route == .retain,
                            detail: "Newsletter route: \(news?.route.rawValue ?? "missing")"),
            EvaluationCheck(name: "Replay has no duplicate effects", passed: replayRun.completed == 0 && inbox.count == 1,
                            detail: "Second pass completed \(replayRun.completed) jobs; \(inbox.count) conflict inbox items."),
        ]
        let report = EvaluationReport(mode: mode, checks: checks, decisions: decisions + (control.map { [$0] } ?? []))
        try JSONCodec.encode(report).write(to: directory.appendingPathComponent("evaluation.json"), options: .atomic)
        return report
    }
}
