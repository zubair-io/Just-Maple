import Foundation
import Testing
@testable import MapleCore

struct GmailOwnershipTests {
    let senderID = "person:email:" + ConnectorSourceRecord.identifier("alex@example.test")
    func source(outgoing: Bool = false) -> Event {
        Event(type: outgoing ? "message.sent" : "message.received", source: Source(connector: "gmail", account: "owner@example.test", externalID: "fixture", revision: "1"), occurredAt: Date(),
              subjects: ["person:self", senderID, "person:email:mentioned", "thread:gmail:fixture"],
              content: "Gmail message\nDirection: \(outgoing ? "outgoing" : "incoming")\nSender: Alex <alex@example.test>\nBody:\nI will send the estimate. Please confirm the delivery address.")
    }
    func output(obligation: String?, actor: String?) throws -> String {
        var task: [String: Any] = ["title": obligation == "user_action" ? "Confirm the delivery address" : "Send the delivery estimate", "quote": obligation == "user_action" ? "Please confirm the delivery address." : "I will send the estimate.", "deadline": "", "activityIDs": []]
        if let obligation { task["obligation"] = obligation }
        if let actor { task["actorID"] = actor }
        return String(decoding: try JSONSerialization.data(withJSONObject: ["tasks": [task]]), as: UTF8.self)
    }
    @Test func senderCommitmentStaysWaitingThroughCommitAndAcceptance() async throws {
        let store = try KnowledgeStore(path: ":memory:"), event = source()
        let suggestions = try ACPExtractor.tasks(output(obligation: "waiting_on_other", actor: senderID), event: event, activities: [], provider: "fixture")
        #expect(suggestions.first?.candidate.status == .waiting)
        #expect(suggestions.first?.candidate.assignee == "Alex <alex@example.test>")
        try await store.ingest(event)
        try await store.requestTaskExtraction(eventID: event.id)
        let (_, token) = try #require(await store.acquireTaskExtraction(at: Date()))
        try await store.commitTaskExtraction(suggestions, eventID: event.id, token: token)
        let pending = try #require(await store.worldSnapshot().suggestions.first)
        #expect(pending.candidate.status == .waiting)
        _ = try await store.reviewSuggestion(id: pending.id, action: "accept", edited: nil, expectedVersion: pending.version, requestID: "accept-fixture")
        #expect(try await store.tasks().first?.status == .waiting)
        #expect(try await store.attention(at: Date()).isEmpty)
    }
    @Test func userRequestsAndTentativePlansHaveDistinctOwnership() throws {
        let user = try ACPExtractor.tasks(output(obligation: "user_action", actor: "person:self"), event: source(), activities: [], provider: "fixture")
        #expect(user.first?.candidate.status == .open)
        #expect(user.first?.candidate.assignee == "You")
        #expect(try ACPExtractor.tasks(output(obligation: "tentative_plan", actor: senderID), event: source(), activities: [], provider: "fixture").isEmpty)
    }
    @Test func missingInventedOrMentionedActorAndOutgoingMailAreRejected() throws {
        for (obligation, actor) in [(nil, nil), ("waiting_on_other", "person:self"), ("waiting_on_other", "person:invented"), ("waiting_on_other", "person:email:mentioned"), ("user_action", senderID)] as [(String?, String?)] {
            #expect(throws: Error.self) { try ACPExtractor.tasks(output(obligation: obligation, actor: actor), event: source(), activities: [], provider: "fixture") }
        }
        #expect(throws: Error.self) { try ACPExtractor.tasks(output(obligation: "user_action", actor: "person:self"), event: source(outgoing: true), activities: [], provider: "fixture") }
    }
    @Test func storeRejectsProviderBypassWithoutOwnership() async throws {
        let store = try KnowledgeStore(path: ":memory:"), event = source()
        try await store.ingest(event); try await store.requestTaskExtraction(eventID: event.id)
        let (_, token) = try #require(await store.acquireTaskExtraction(at: Date()))
        var invalid = TaskSuggestion(); invalid.eventID = event.id; invalid.quote = "I will send the estimate."; invalid.candidate.title = "Send the delivery estimate"; invalid.provider = "fixture"
        await #expect(throws: Error.self) { try await store.commitTaskExtraction([invalid], eventID: event.id, token: token) }
        #expect(try await store.worldSnapshot().suggestions.isEmpty)
        var waiting = invalid; waiting.obligation = "waiting_on_other"; waiting.actorID = senderID
        // Same valid lease survives the rejected atomic write.
        try await store.commitTaskExtraction([waiting], eventID: event.id, token: token)
        #expect(try await store.worldSnapshot().suggestions.first?.candidate.status == .waiting)
    }
}
