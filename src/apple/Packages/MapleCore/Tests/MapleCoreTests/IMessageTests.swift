import Foundation
import Testing
@testable import MapleCore

struct IMessageTests {
    let sample = """
    Jul 21, 2026  9:10:11 PM (Read by you after 2 seconds)
    +15185550100
    first line
    second line

    Jul 21, 2026  9:11:12 PM
    Me
    reply

    Jul 21, 2026  9:12:12 PM
    Loved by Person
    reaction
    """

    func parsed(thread: String = "test-thread", activation: Date = .distantPast) throws -> [Event] {
        try IMessageTextParser.parse(sample, thread: thread, activatedAt: activation, timeZone: TimeZone(secondsFromGMT: 0)!)
    }

    @Test func parserPreservesDirectionAndStableIdentity() throws {
        let first = try parsed()
        #expect(first.count == 2)
        #expect(first[0].type == "message.received")
        #expect(first[1].type == "message.sent")
        #expect(first[0].content.contains("first line\nsecond line"))
        #expect(first[0].subjects.contains("person:self"))
        let noRead = sample.replacingOccurrences(of: " (Read by you after 2 seconds)", with: "")
        let replay = try IMessageTextParser.parse(noRead, thread: "test-thread", activatedAt: .distantPast, timeZone: TimeZone(secondsFromGMT: 0)!)
        #expect(replay[0].source == first[0].source)
        #expect(try parsed(thread: "other")[0].source != first[0].source)
        #expect(try parsed(activation: .distantFuture).allSatisfy { $0.type == "message.history" })
        #expect(throws: MapleError.self) { try IMessageTextParser.parse("unsupported format", thread: "x", activatedAt: Date()) }
    }

    @Test func checkpointAndEventsCommitTogetherAndReplayIsSafe() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        _ = try await store.beginIMessage(now: start)
        let events = try parsed()
        #expect(try await store.ingestIMessageBatch(events, scannedAt: start.addingTimeInterval(60)) == 2)
        #expect(try await store.ingestIMessageBatch(events, scannedAt: start.addingTimeInterval(70)) == 0)
        let invalid = Event(type: "bad", source: events[0].source, occurredAt: Date(), subjects: [], content: "")
        await #expect(throws: MapleError.self) {
            try await store.ingestIMessageBatch(self.parsed(thread: "other") + [invalid], scannedAt: start.addingTimeInterval(100))
        }
        #expect(try await store.eventCount() == 2)
        #expect(try await store.queue().count == 2)
        #expect(try await store.beginIMessage().scannedAt == start.addingTimeInterval(70))
    }

    @Test func threadContextDoesNotIncludeUnrelatedSelfMessages() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        _ = try await store.beginIMessage()
        let own = try parsed()
        let other = try parsed(thread: "unrelated")
        _ = try await store.ingestIMessageBatch(own + other, scannedAt: Date())
        let context = try await store.context(for: own[1].id)
        #expect(context.recentEvents.count == 1)
        #expect(context.recentEvents[0].id == own[0].id)
        #expect(!context.relatedEvidence.contains { other.map(\.id).contains($0.id) })
    }

    @Test func historicalOutgoingAndFeedbackCannotPromptFromReplySignal() throws {
        let signals = MessageAssessment(kind: .request, confidence: 0.9, replyNeeded: 1, timeSensitive: 1,
                                        commitmentChanged: 0, contextConflict: 1, meaningfulUpdate: 0.9, needsReasoning: 0)
        let assessment = Assessment(notify: 1, askUser: 1, reason: 0, summarize: 0.9, jobStage: .unchanged,
                                    stageConfidence: 1, model: "test", provider: "fixture", message: signals)
        for type in ["message.history", "message.sent", "feedback.received", "message.received"] {
            let event = Event(type: type, source: Source(connector: "imessage", account: "test", externalID: type, revision: "1"),
                              occurredAt: Date(), subjects: ["thread:imessage:test"], content: "Can you confirm?")
            let context = Context(event: event, currentState: [], recentEvents: [], relatedEvidence: [], version: "test")
            let decision = Policy.decide(context: context, assessment: assessment)
            #expect(decision.route == (type == "message.received" ? .askUser : .summarize))
        }
    }

    @Test(arguments: ["imessage", "gmail"]) func messageResponseContractAndMissingAnswers(connector: String) async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let original = try parsed()[0]
        let event = Event(type: original.type, source: Source(connector: connector, account: original.source.account, externalID: original.source.externalID, revision: original.source.revision), occurredAt: Date().addingTimeInterval(-3600), subjects: original.subjects, content: original.content)
        try await store.ingest(event)
        let context = try await store.context(for: event.id)
        var distribution = Dictionary(uniqueKeysWithValues: MessageKind.allCases.map { ($0.rawValue, 0.0) })
        distribution["request"] = 1
        var answers: [String: Any] = ["message_kind": ["type": "choice", "choice": "request", "confidence": 0.95, "probabilities": distribution]]
        for key in ["task_review_needed", "action_needed", "reply_needed", "time_sensitive", "commitment_changed", "context_conflict", "meaningful_update", "needs_reasoning", "contains_facts"] {
            answers[key] = ["type": "noul", "noul": 0.9]
        }
        let transport = CapturingTransport(data: try JSONSerialization.data(withJSONObject: ["model": "test-jev", "answers": answers]))
        let result = try await TypeSafeClassifier(apiKey: "test", transport: transport).classify(context)
        #expect(result.assessment.message?.kind == .request)
        #expect(result.inputContext?.version == "message-screening-v1")
        let request = try #require(await transport.request)
        let json = try #require(JSONSerialization.jsonObject(with: request.httpBody!) as? [String: Any])
        let questions = try #require(json["questions"] as? [String: Any])
        #expect(questions.count == 10)
        #expect(questions["job_stage"] == nil)
        answers.removeValue(forKey: "task_review_needed")
        let broken = CapturingTransport(data: try JSONSerialization.data(withJSONObject: ["model": "test-jev", "answers": answers]))
        await #expect(throws: MapleError.self) { try await TypeSafeClassifier(apiKey: "test", transport: broken).classify(context) }
        for invalid in [["type": "noul", "noul": 1.1], ["type": "choice", "choice": "yes"]] as [[String: Any]] {
            answers["task_review_needed"] = invalid
            let invalidTransport = CapturingTransport(data: try JSONSerialization.data(withJSONObject: ["model": "test-jev", "answers": answers]))
            await #expect(throws: MapleError.self) { try await TypeSafeClassifier(apiKey: "test", transport: invalidTransport).classify(context) }
        }
    }

    @Test func existingV1DatabaseMigratesWithoutLosingEvents() async throws {
        let path = FileManager.default.temporaryDirectory.appendingPathComponent("maple-migration-\(UUID()).sqlite").path
        defer { for suffix in ["", "-wal", "-shm"] { try? FileManager.default.removeItem(atPath: path + suffix) } }
        let seed = try parsed()[0]
        var persisted: Event?
        do {
            let store = try KnowledgeStore(path: path)
            try await store.ingest(seed)
            persisted = try await store.event(seed.id)
        }
        do {
            let db = try SQLite(path: path)
            try db.migrate()
            try db.execute("DROP TABLE connector_source_records")
            try db.execute("DROP TABLE connector_checkpoints")
            try db.execute("DROP TABLE fact_checks")
            try db.execute("DROP TABLE source_facts")
            try db.execute("DROP TABLE fact_jobs")
            try db.execute("PRAGMA user_version=1")
        }
        let migrated = try KnowledgeStore(path: path)
        #expect(try await migrated.event(seed.id) == persisted)
        _ = try await migrated.beginIMessage()
        #expect(try await migrated.ingestIMessageBatch(parsed(), scannedAt: Date()) == 1)
    }

    @Test func exporterProcessImportsAndFailureDoesNotAdvanceCursor() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("maple-exporter-test-\(UUID())")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let executable = directory.appendingPathComponent("fixture-exporter")
        let date = DateFormatter()
        date.locale = Locale(identifier: "en_US_POSIX")
        date.timeZone = .current
        date.dateFormat = "MMM d, yyyy h:mm:ss a"
        let script = """
        #!/bin/sh
        cat > "$6/Test.txt" <<'FIXTURE'
        \(date.string(from: Date().addingTimeInterval(-60)))
        Me
        Synthetic exporter test message.
        FIXTURE
        """
        try script.write(to: executable, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)
        let store = try KnowledgeStore(path: ":memory:")
        #expect(try await IMessageConnector.poll(store: store, executable: executable) == 1)
        #expect(try await IMessageConnector.poll(store: store, executable: executable) == 0)
        let checkpoint = try await store.beginIMessage()
        try "#!/bin/sh\nexit 1\n".write(to: executable, atomically: false, encoding: .utf8)
        await #expect(throws: MapleError.self) { try await IMessageConnector.poll(store: store, executable: executable) }
        #expect(try await store.beginIMessage().scannedAt == checkpoint.scannedAt)
        #expect(try await store.eventCount() == 1)
    }
}
