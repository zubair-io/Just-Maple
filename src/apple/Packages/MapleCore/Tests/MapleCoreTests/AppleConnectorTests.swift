import Foundation
import Testing
@testable import MapleCore

struct AppleConnectorTests {
    func contact(_ name: String, id: String = "contact-1") -> AppleSourceRecord {
        AppleSourceRecord(id: id, name: name, content: "Name: \(name)\nOrganization: Alpine")
    }
    @Test func contactsCannotAttributeFactsToSelfAndLegacyFactsAreRepaired() async throws {
        let path = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
        defer { try? FileManager.default.removeItem(atPath: path) }
        let store = try KnowledgeStore(path: path)
        _ = try await store.ingestAppleSnapshot([contact("A")], connector: "apple_contacts")
        let event = try #require(try await store.search("Alpine").first)
        let subject = "person:apple:" + AppleSourceRecord.identifier("contact-1")
        #expect(event.subjects == [subject])
        let legacy = Event(type: event.type, source: event.source, occurredAt: event.occurredAt,
                           subjects: ["person:self", subject], content: event.content)
        #expect(FactRules.subjects(for: legacy) == [subject])
        #expect(throws: MapleError.self) {
            try FactRules.validate(FactCandidate(subject: "person:self", predicate: "name", value: "A", sourceQuote: "Name: A"), event: legacy)
        }
        try FactRules.validate(FactCandidate(subject: subject, predicate: "name", value: "A", sourceQuote: "Name: A"), event: legacy)
        let wrong = SourceFact(id: "legacy-fact", subject: "person:self", predicate: "name", value: "A",
                               sourceQuote: "Name: A", eventID: event.id, provider: "test", model: "test", extractedAt: Date())
        let db = try SQLite(path: path)
        try db.execute("INSERT INTO source_facts VALUES (?,?,?,?)", [wrong.id, event.id, wrong.subject, try JSONCodec.string(wrong)])
        try db.execute("PRAGMA user_version=5")
        let reopened = try KnowledgeStore(path: path)
        #expect(try await reopened.sourceFacts(subjects: ["person:self"]).isEmpty)
        let repaired = try #require(try await reopened.sourceFacts(subjects: [subject]).first)
        #expect(repaired.id == wrong.id)
        #expect(repaired.eventID == wrong.eventID)
        #expect(repaired.sourceQuote == wrong.sourceQuote)
        let restarted = try KnowledgeStore(path: path)
        #expect(try await restarted.sourceFacts(subjects: [subject]).count == 1)
    }
    @Test func snapshotsDeduplicatePreserveCorrectionsAndCaptureReversions() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let a = contact("A"), b = contact("B")
        #expect(try await store.ingestAppleSnapshot([a], connector: "apple_contacts") == 1)
        #expect(try await store.ingestAppleSnapshot([a], connector: "apple_contacts") == 0)
        let subject = "person:apple:" + AppleSourceRecord.identifier(a.id)
        _ = try await store.correct(subject: subject, predicate: "person.name", value: "My correction")
        #expect(try await store.ingestAppleSnapshot([b], connector: "apple_contacts") == 1)
        #expect(try await store.ingestAppleSnapshot([a], connector: "apple_contacts") == 1)
        #expect(try await store.appleRecords("apple_contacts") == [a])
        #expect(try await store.state(subjects: [subject]).first?.value == "My correction")
        #expect(try await store.queue().count == 3)
        #expect(try await store.ingestAppleSnapshot([], connector: "apple_contacts") == 1)
        #expect(try await store.appleRecords("apple_contacts").isEmpty)
        #expect(try await store.ingestAppleSnapshot([], connector: "apple_contacts") == 0)
        #expect(try await store.ingestAppleSnapshot([a], connector: "apple_contacts") == 1)
        #expect(try await store.queue().count == 5)
    }
    @Test func invalidBatchRollsBackEventsQueueAndSourceState() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let invalid = AppleSourceRecord(id: "bad", name: "Bad", content: String(repeating: "x", count: 256001))
        do { _ = try await store.ingestAppleSnapshot([contact("Valid"), invalid], connector: "apple_contacts"); Issue.record("Accepted oversized source") } catch {}
        #expect(try await store.eventCount() == 0)
        #expect(try await store.queue().isEmpty)
        #expect(try await store.appleRecords("apple_contacts").isEmpty)
        do { _ = try await store.ingestAppleSnapshot([contact("One"), contact("Two")], connector: "apple_contacts"); Issue.record("Accepted duplicate identity") } catch {}
        #expect(try await store.eventCount() == 0)
    }
    @Test func calendarOccurrencesAndWindowAgingAreDistinct() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let first = AppleSourceRecord(id: "series-occurrence-1", name: "Standup", content: "First occurrence", start: Date(timeIntervalSince1970: 100), end: Date(timeIntervalSince1970: 150))
        let second = AppleSourceRecord(id: "series-occurrence-2", name: "Standup", content: "Second occurrence", start: Date(timeIntervalSince1970: 300), end: Date(timeIntervalSince1970: 350))
        #expect(try await store.ingestAppleSnapshot([first, second], connector: "apple_calendar", windowStart: Date(timeIntervalSince1970: 0), windowEnd: Date(timeIntervalSince1970: 400)) == 2)
        // First occurrence aged out. Second vanished inside the queried window: emit unavailable, not canceled.
        #expect(try await store.ingestAppleSnapshot([], connector: "apple_calendar", windowStart: Date(timeIntervalSince1970: 200), windowEnd: Date(timeIntervalSince1970: 500)) == 1)
        #expect(try await store.appleRecords("apple_calendar") == [first])
        let results = try await store.search("cancellation")
        #expect(results.count == 1)
        #expect(results.first?.type == "calendar.unavailable")
        do { _ = try await store.ingestAppleSnapshot([first], connector: "apple_calendar"); Issue.record("Accepted missing window") } catch {}
    }
    @Test func versionThreeMigrationAndRestartKeepSourceIdentity() async throws {
        let path = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
        defer { try? FileManager.default.removeItem(atPath: path) }
        do {
            let db = try SQLite(path: path)
            try db.migrate()
            try db.execute("DROP TABLE connector_source_records")
            try db.execute("PRAGMA user_version=3")
        }
        let store = try KnowledgeStore(path: path)
        #expect(try await store.ingestAppleSnapshot([contact("A")], connector: "apple_contacts") == 1)
        let reopened = try KnowledgeStore(path: path)
        #expect(try await reopened.ingestAppleSnapshot([contact("A")], connector: "apple_contacts") == 0)
        #expect(try await reopened.eventCount() == 1)
        #expect(try await reopened.queue().count == 1)
    }
}
