import Foundation
import Testing
@testable import MapleCore

struct ContextRetrievalTests {
    @Test(arguments: ["gmail", "imessage"])
    func semanticEvidenceStaysWithinMessageThread(connector: String) async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let now = Date()
        func fixture(_ id: String, thread: String, content: String, offset: TimeInterval) -> Event {
            Event(type: "message.received", source: Source(connector: connector, account: "fixture", externalID: id, revision: "1"),
                  occurredAt: now.addingTimeInterval(offset),
                  subjects: ["person:self", "person:fixture:shared", "thread:\(connector):\(thread)"], content: content)
        }
        let current = fixture("current", thread: "selected", content: "Please confirm your availability.", offset: 0)
        let related = fixture("related", thread: "selected", content: "Tuesday morning works.", offset: -10)
        let unrelated = fixture("unrelated", thread: "other", content: "Your equipment requires maintenance.", offset: -20)
        let future = fixture("future", thread: "selected", content: "Tomorrow afternoon works.", offset: 10)
        // Equal synthetic stored vectors force semantic retrieval to consider all fixtures.
        // No provider calls; the query vector is computed entirely on this Mac.
        let vector = try LocalEmbedding.vector(current.content)
        for event in [current, related, unrelated, future] {
            _ = try await store.ingest(event)
            try await store.saveVectors(eventID: event.id, vectors: [vector], model: LocalEmbedding.model)
        }
        // Verify unrelated input would rank if the common self/person scope were used.
        let broad = try await store.semanticSearch(current.content, limit: 4, before: now, subjects: current.subjects)
        #expect(broad.contains { $0.id == unrelated.id })
        let context = try await store.context(for: current.id)
        #expect(context.recentEvents.map(\.id) == [related.id])
        #expect(context.relatedEvidence.map(\.id) == [related.id])
    }

    @Test func nonMessageContextRetainsSubjectScopedSemanticRetrieval() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let now = Date()
        let current = Event(type: "note.updated", source: Source(connector: "notes", account: "fixture", externalID: "current", revision: "1"),
                            occurredAt: now, subjects: ["topic:fixture:repairs"], content: "Schedule equipment maintenance.")
        let related = Event(type: "note.updated", source: Source(connector: "notes", account: "fixture", externalID: "related", revision: "1"),
                            occurredAt: now.addingTimeInterval(-10), subjects: current.subjects, content: "Workshop contact information.")
        for event in [current, related] {
            _ = try await store.ingest(event)
            try await store.saveVectors(eventID: event.id, vectors: [LocalEmbedding.vector(current.content)], model: LocalEmbedding.model)
        }
        let context = try await store.context(for: current.id)
        #expect(context.relatedEvidence.map(\.id) == [related.id])
    }
}
