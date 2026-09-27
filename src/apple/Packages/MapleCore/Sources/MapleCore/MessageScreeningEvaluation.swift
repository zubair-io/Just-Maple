import Foundation

/// Labeled synthetic screening smoke test, not the held-out user-obligation benchmark.
/// Separate stores keep each example isolated from production and from other examples.
public enum MessageScreeningEvaluation {
    public static func run(classifier: any Classifier, directory: URL) async throws -> [String: String] {
        guard !FileManager.default.fileExists(atPath: directory.path) else { throw MapleError.invalid("Use a new screening evaluation directory.") }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let cases: [(String, String, Bool)] = [
            ("decision", "Here is the estimate you requested for replacing the office window. Total is $740. Please let us know whether to proceed; a deposit is only required if you approve.", true),
            ("service-fault", "Your scheduled backup failed. No backup was created. Check the storage connection and retry to restore backup coverage.", true),
            ("renewal", "Your existing professional license expires in 12 days. Renew before expiry to continue practicing.", true),
            ("scheduling", "Can you send two available times for the next interview this week?", true),
            ("waiting", "I will bring the replacement cable tomorrow morning.", true),
            ("delegated", "I have taken ownership of sending the contract to the supplier. I will send it by Friday and let you know.", true),
            ("information-request", "Please send the signed access form so we can activate your badge.", true),
            ("tentative", "Maybe we could meet for a walk sometime, but I have no plans yet.", false),
            ("completed-request", "You already sent the requested document and it has been accepted. Nothing else is needed.", false),
            ("optional-review", "Would you rate your recent purchase? This is optional and no response is required.", false),
            ("survey", "Help improve our travel service by taking an optional three minute survey. We'd love to hear your feedback.", false),
            ("sale", "Offer ends tonight! Buy our newest laptop and save 20 percent.", false),
            ("autopay", "Your monthly statement is ready. AutoPay is scheduled for October 7. No action is required.", false),
            ("success", "Your scheduled backup completed successfully. All files were backed up.", false),
            ("acknowledgment", "Thanks, I received your reply and we are all set.", false)
        ]
        var report = ["mode": "live-jev-synthetic-screening", "passed": "true", "total": String(cases.count)]
        for (name, body, expected) in cases {
            let store = try KnowledgeStore(path: directory.appendingPathComponent(name + ".sqlite").path)
            let event = Event(id: "synthetic-" + name, type: "message.received", source: Source(connector: "gmail", account: "synthetic", externalID: name, revision: "1"), occurredAt: Date(), subjects: ["person:self", "person:synthetic:sender", "thread:gmail:synthetic-" + name], content: "From: Synthetic Sender\nDirection: incoming\nSubject: Synthetic evaluation\nBody:\n" + body)
            try await store.ingest(event)
            let result = try await IntelligenceEngine(store: store, classifier: classifier).run()
            let decision = try await store.decisions().first
            let reviewed = try await store.taskExtractionQueue().contains { $0.eventID == event.id }
            let passed = result.completed == 1 && reviewed == expected && (expected || decision?.route == .retain)
            report[name] = "expectedReview=\(expected); actualReview=\(reviewed); route=\(decision?.route.rawValue ?? "failed"); reviewScore=\(decision?.assessment.message?.taskReviewNeeded ?? -1); passed=\(passed)"
            if !passed { report["passed"] = "false" }
        }
        try JSONCodec.encode(report).write(to: directory.appendingPathComponent("report.json"), options: .atomic)
        return report
    }
}
