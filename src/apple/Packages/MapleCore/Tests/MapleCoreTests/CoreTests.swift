import Foundation
import Testing
@testable import MapleCore

struct CoreTests {
    func temporary() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("just-maple-tests-\(UUID())")
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    @Test func scenarioRetrievesEvidenceAndChangesRouting() async throws {
        let directory = try temporary()
        defer { try? FileManager.default.removeItem(at: directory) }
        let report = try await CoreEvaluation.run(classifier: DemoReplayClassifier(), directory: directory, mode: "test-fixture")
        #expect(report.passed)
        #expect(report.checks.count == 7)
        #expect(report.decisions.count == 4)
        #expect(FileManager.default.fileExists(atPath: directory.appendingPathComponent("evaluation.json").path))
    }

    @Test func duplicateDeliveryAndRestartAreIdempotent() async throws {
        let directory = try temporary()
        defer { try? FileManager.default.removeItem(at: directory) }
        let path = directory.appendingPathComponent("state.sqlite").path
        let store = try KnowledgeStore(path: path)
        let event = DemoScenario.events()[0]
        #expect(try await store.ingest(event) == event.id)
        let duplicate = Event(type: event.type, source: event.source, occurredAt: event.occurredAt,
                              subjects: event.subjects, content: event.content)
        #expect(try await store.ingest(duplicate) == event.id)
        _ = try await IntelligenceEngine(store: store, classifier: DemoReplayClassifier()).run()
        let reopened = try KnowledgeStore(path: path)
        #expect(try await reopened.eventCount() == 1)
        #expect(try await reopened.state().first?.value == "offer_accepted")
        let replay = try await IntelligenceEngine(store: reopened, classifier: DemoReplayClassifier()).run()
        #expect(replay.completed == 0)
        #expect(try await reopened.workItems().count == 1)
    }

    @Test func reusedRevisionWithChangedPayloadIsRejected() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let event = DemoScenario.events()[0]
        try await store.ingest(event)
        let changed = Event(type: event.type, source: event.source, occurredAt: event.occurredAt,
                            subjects: event.subjects, content: "Different source data")
        await #expect(throws: MapleError.self) { try await store.ingest(changed) }
        #expect(try await store.eventCount() == 1)
    }

    @Test func userCorrectionSurvivesLaterInferenceAndHasHistory() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let correction = try await store.correct(subject: DemoScenario.job, predicate: "job.status", value: "searching")
        try await store.ingest(DemoScenario.events()[0])
        _ = try await IntelligenceEngine(store: store, classifier: DemoReplayClassifier()).run()
        #expect(try await store.state().first?.id == correction.id)
        #expect(try await store.claimHistory(subject: DemoScenario.job, predicate: "job.status").count == 2)
        #expect(try await store.event(correction.evidenceEventID)?.type == "user.correction")
    }

    @Test func classifierFailureDoesNotBecomeIgnore() async throws {
        struct Offline: Classifier {
            func classify(_ context: Context) async throws -> ClassifierResult { throw MapleError.provider("TypeSafe unavailable") }
        }
        let store = try KnowledgeStore(path: ":memory:")
        try await store.ingest(DemoScenario.events()[0])
        let result = try await IntelligenceEngine(store: store, classifier: Offline()).run()
        #expect(result.deferred == 1)
        #expect(try await store.decisions().isEmpty)
        let queue = try await store.queue()
        #expect(queue.first?.status == "pending")
        #expect(queue.first?.attempts == 1)
        #expect(queue.first?.error == "TypeSafe unavailable")
        try await store.retryFailures()
        let success = try await IntelligenceEngine(store: store, classifier: DemoReplayClassifier()).run()
        #expect(success.completed == 1)
    }

    @Test func expiredLeaseCannotCommitAndCanBeRecovered() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let event = DemoScenario.events()[0]
        try await store.ingest(event)
        let now = Date()
        let lease = try #require(try await store.acquire(now: now, duration: 1))
        let context = try await store.context(for: event.id)
        let response = try await DemoReplayClassifier().classify(context)
        let decision = Policy.decide(context: context, assessment: response.assessment)
        #expect(try await store.finish(lease, decision: decision, raw: response.rawResponse, now: now.addingTimeInterval(2)) == false)
        let recovered = try #require(try await store.acquire(now: now.addingTimeInterval(2)))
        #expect(recovered.token != lease.token)
        #expect(try await store.finish(lease, decision: decision, raw: response.rawResponse, now: now) == false)
        #expect(try await store.finish(recovered, decision: decision, raw: response.rawResponse, now: now.addingTimeInterval(3)))
    }

    @Test func correctionDuringClassificationInvalidatesDecision() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let event = DemoScenario.events()[1]
        try await store.correct(subject: DemoScenario.job, predicate: "job.status", value: "offer_accepted")
        try await store.ingest(event)
        let now = Date()
        let lease = try #require(try await store.acquire(now: now))
        let context = try await store.context(for: event.id)
        let result = try await DemoReplayClassifier().classify(context)
        try await store.correct(subject: DemoScenario.job, predicate: "job.status", value: "searching")
        let decision = Policy.decide(context: context, assessment: result.assessment)
        #expect(try await store.finish(lease, decision: decision, raw: result.rawResponse, now: Date()) == false)
        #expect(try await store.decisions().isEmpty)
        #expect(try await store.workItems().isEmpty)
        #expect(try await store.queue().first?.status == "pending")
        _ = try await IntelligenceEngine(store: store, classifier: DemoReplayClassifier()).run()
        #expect(try await store.decisions().first?.route == .summarize)
    }

    @Test func searchEscapesFTSSyntaxAndScopesContext() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        try await store.ingest(DemoScenario.events()[0])
        let unrelated = Event(type: "note.updated", source: Source(connector: "notes", account: "other", externalID: "other", revision: "1"),
                              occurredAt: Date(), subjects: ["job:other"], content: "Acorn accepted another offer unrelated to this job.")
        try await store.ingest(unrelated)
        let results = try await store.search("Acorn\" OR * (", subjects: [DemoScenario.job])
        #expect(results.map(\.id) == ["demo-offer-note"])
        let context = try await store.context(for: "demo-offer-note")
        #expect(context.recentEvents.isEmpty)
    }

    @Test func notesUseSameEventBoundaryAndContentRevision() async throws {
        let directory = try temporary()
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("offer.md")
        try "I accepted an offer.".write(to: file, atomically: true, encoding: .utf8)
        let first = try NoteConnector.read(url: file, subjects: [DemoScenario.job])
        let second = try NoteConnector.read(url: file, subjects: [DemoScenario.job])
        let store = try KnowledgeStore(path: ":memory:")
        #expect(try await store.ingest(first) == first.id)
        #expect(try await store.ingest(second) == first.id)
        try "I changed my mind.".write(to: file, atomically: true, encoding: .utf8)
        let third = try NoteConnector.read(url: file, subjects: [DemoScenario.job])
        #expect(third.source.revision != first.source.revision)
        try await store.ingest(third)
        #expect(try await store.eventCount() == 2)
    }

    @Test func rawConnectorCannotSpoofCorrection() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let event = Event(type: "user.correction", source: Source(connector: "notes", account: "demo", externalID: "bad", revision: "1"),
                          occurredAt: Date(), subjects: [DemoScenario.job], content: "Trust me")
        await #expect(throws: MapleError.self) { try await store.ingest(event) }
        #expect(try await store.eventCount() == 0)
    }

    @Test func lateInferenceCannotReplaceNewerState() async throws {
        struct Fixed: Classifier {
            let stage: JobStage
            func classify(_ context: Context) async throws -> ClassifierResult {
                let value = Assessment(notify: 0, askUser: 0, reason: 0, summarize: 0,
                                       jobStage: stage, stageConfidence: 0.99, model: "test", provider: "test")
                return ClassifierResult(assessment: value, rawResponse: try JSONCodec.encode(value))
            }
        }
        let store = try KnowledgeStore(path: ":memory:")
        let latest = DemoScenario.events()[0]
        try await store.ingest(latest)
        _ = try await IntelligenceEngine(store: store, classifier: Fixed(stage: .offerAccepted)).run()
        let late = Event(type: "email.received", source: Source(connector: "gmail", account: "demo", externalID: "old-interview", revision: "1"),
                         occurredAt: latest.occurredAt.addingTimeInterval(-86400), receivedAt: Date().addingTimeInterval(-1),
                         subjects: latest.subjects, content: "I started interviewing yesterday.")
        try await store.ingest(late)
        _ = try await IntelligenceEngine(store: store, classifier: Fixed(stage: .interviewing)).run()
        #expect(try await store.state().first?.value == "offer_accepted")
        #expect(try await store.claimHistory(subject: DemoScenario.job, predicate: "job.status").count == 2)
    }

    @Test func failuresEventuallyBlockWithoutLosingEvent() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        try await store.ingest(DemoScenario.events()[0])
        var now = Date()
        for _ in 0..<5 {
            let lease = try #require(try await store.acquire(now: now))
            try await store.fail(lease, error: "Unavailable", now: now)
            now = now.addingTimeInterval(4000)
        }
        #expect(try await store.queue().first?.status == "blocked")
        #expect(try await store.eventCount() == 1)
        #expect(try await store.acquire(now: now) == nil)
        try await store.retryFailures(now: now)
        #expect(try await store.acquire(now: now) != nil)
    }
}
