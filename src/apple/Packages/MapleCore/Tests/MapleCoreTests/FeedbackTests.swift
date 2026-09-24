import Foundation
import Testing
@testable import MapleCore

struct FeedbackTests {
    @Test func responseClosesPromptAndReentersQueueOnce() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        for event in DemoScenario.events() { try await store.ingest(event) }
        _ = try await IntelligenceEngine(store: store, classifier: DemoReplayClassifier()).run()
        let item = try #require(try await store.workItems().first { $0.kind == "ask_user" })
        let before = try await store.eventCount()
        let id = try await store.respond(to: item.id, text: "I want to keep interviewing.")
        #expect(try await store.workItems().first { $0.id == item.id }?.status == "answered")
        #expect(try await store.queue().first { $0.eventID == id }?.status == "pending")
        #expect(try await store.event(id)?.subjects == store.event(item.eventID)?.subjects)
        let repeated = try await store.respond(to: item.id, text: "I want to keep interviewing.")
        #expect(repeated == id)
        #expect(try await store.eventCount() == before + 1)
        await #expect(throws: MapleError.self) { try await store.respond(to: item.id, text: "A conflicting second submission") }
        #expect(try await store.eventCount() == before + 1)
    }

    @Test func invalidResponseCannotCreateEvents() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        await #expect(throws: MapleError.self) { try await store.respond(to: "missing", text: "A response") }
        await #expect(throws: MapleError.self) { try await store.respond(to: "missing", text: "  ") }
        #expect(try await store.eventCount() == 0)
    }
}
