import Foundation
import Testing
@testable import MapleCore

private struct FixtureExtractor: FactExtractor {
    let candidates: [FactCandidate]
    func extract(_ event: Event) async throws -> FactExtractionResult {
        FactExtractionResult(candidates: candidates, provider: "fixture", model: "test")
    }
}

struct FactExtractionTests {
    func resume() -> Event {
        Event(type: "resume.imported", source: Source(connector: "resume", account: "test", externalID: "resume", revision: "1"),
              occurredAt: Date(), subjects: ["person:self"], content: "Alex Morgan worked as an engineer at Acorn from 2020 to 2024.")
    }
    func candidate() -> FactCandidate {
        FactCandidate(subject: "person:self", predicate: "employment", value: "Engineer at Acorn, 2020–2024 (past role).", sourceQuote: "engineer at Acorn from 2020 to 2024")
    }

    @Test func factExtractionIsIndependentOfActionAndIdempotent() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let event = resume()
        try await store.ingest(event)
        let lease = try #require(try await store.acquire(now: Date()))
        let assessment = Assessment(notify: 0, askUser: 0, reason: 0, summarize: 0.99, jobStage: .unchanged, stageConfidence: 1,
                                    model: "test", provider: "fixture", containsFacts: 0.99)
        let context = try await store.context(for: event.id)
        let decision = Policy.decide(context: context, assessment: assessment)
        #expect(decision.route == .retain)
        #expect(try await store.finish(lease, decision: decision, raw: Data(), now: Date()))
        #expect(try await store.workItems().map(\.kind) == ["extract_facts"])
        let engine = FactExtractionEngine(store: store, extractor: FixtureExtractor(candidates: [candidate(), candidate()]))
        #expect(try await engine.runOne())
        #expect(try await store.sourceFacts().count == 1)
        #expect(try await store.context(for: event.id).sourceFacts?.count == 1)
        #expect(try await store.state().isEmpty) // source assertions do not become verified/user claims
        try await store.recordFactCheck(eventID: event.id, probability: 1, provider: "fixture", model: "again")
        #expect(try await !engine.runOne())
        #expect(try await store.factQueue().count == 1)
    }

    @Test func invalidQuoteRollsBackAllFactsAndKeepsRetry() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let event = resume()
        try await store.ingest(event)
        try await store.recordFactCheck(eventID: event.id, probability: 1, provider: "fixture", model: "test")
        let invented = FactCandidate(subject: "person:self", predicate: "education", value: "PhD", sourceQuote: "Invented source quote")
        let engine = FactExtractionEngine(store: store, extractor: FixtureExtractor(candidates: [candidate(), invented]))
        #expect(try await !engine.runOne())
        #expect(try await store.sourceFacts().isEmpty)
        #expect(try await store.factQueue().first?.status == "pending")
        #expect(try await store.factQueue().first?.error != nil)
    }

    @Test func newFactsInvalidateAnInflightClassificationAndExplicitClaimsRemain() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let event = resume()
        try await store.ingest(event)
        try await store.correct(subject: "person:self", predicate: "employment", value: "User correction")
        let lease = try #require(try await store.acquire(now: Date()))
        let context = try await store.context(for: event.id)
        try await store.recordFactCheck(eventID: event.id, probability: 1, provider: "fixture", model: "test")
        _ = try await FactExtractionEngine(store: store, extractor: FixtureExtractor(candidates: [candidate()])).runOne()
        let assessment = Assessment(notify: 0, askUser: 0, reason: 0, summarize: 0, jobStage: .unchanged, stageConfidence: 1, model: "fixture", provider: "test")
        #expect(try await !store.finish(lease, decision: Policy.decide(context: context, assessment: assessment), raw: Data(), now: Date()))
        #expect(try await store.state().first?.value == "User correction")
    }

    @Test func chunkingKeepsEveryCharacterAndBoundsSize() throws {
        let text = String(repeating: "Résumé 工程师 👩‍💻\n", count: 700)
        let chunks = try AppleFactExtractor.chunks(text)
        #expect(chunks.joined() == text)
        #expect(chunks.allSatisfy { $0.utf8.count <= 2712 })
    }

    @Test func staleExtractionLeaseCannotCommit() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let event = resume()
        try await store.ingest(event)
        let now = Date()
        try await store.recordFactCheck(eventID: event.id, probability: 1, provider: "fixture", model: "test")
        let old = try #require(try await store.acquireFacts(now: now.addingTimeInterval(1)))
        _ = try #require(try await store.acquireFacts(now: now.addingTimeInterval(1000)))
        #expect(try await !store.finishFacts(old, result: FactExtractionResult(candidates: [candidate()], provider: "fixture", model: "test"), now: now.addingTimeInterval(1001)))
        #expect(try await store.sourceFacts().isEmpty)
    }

    @Test func lowFactScoreDoesNotScheduleExtraction() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let event = resume()
        try await store.ingest(event)
        try await store.recordFactCheck(eventID: event.id, probability: 0.1, provider: "fixture", model: "test")
        #expect(try await store.factQueue().isEmpty)
        #expect(try await store.factChecks().count == 1)
    }

    @Test func canonicalStructuredFactsBypassModelParsing() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let candidate = FactCandidate(subject: "person:self", predicate: "employment", value: "Engineer at Acorn", sourceQuote: "Acorn")
        let source = try JSONCodec.encode([candidate])
        let event = Event(type: "facts.structured", source: Source(connector: "test", account: "test", externalID: "structured", revision: "1"),
                          occurredAt: Date(), subjects: ["person:self"], content: String(decoding: source, as: UTF8.self))
        try await store.ingest(event)
        try await store.recordFactCheck(eventID: event.id, probability: 1, provider: "fixture", model: "test")
        _ = try await FactExtractionEngine(store: store, extractor: FixtureExtractor(candidates: [])).runOne()
        #expect(try await store.sourceFacts().first?.provider == "structured-source")
    }
}
