import Foundation
import Testing
@testable import MapleCore

struct SelectionAndPeopleTests {
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    func message(sender: String, daysAgo: Double, id: String) -> Event {
        Event(type: "message.received", source: Source(connector: "imessage", account: "local", externalID: id, revision: "1"), occurredAt: now.addingTimeInterval(-daysAgo * 86400), subjects: ["person:self", "person:imessage:" + ConnectorSourceRecord.identifier(sender)], content: "Thread: test\nSender: \(sender)\nDirection: incoming\n\nHello")
    }
    @Test func pinsBeatFrequencyAndQuietContactsStayHidden() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let records = [AppleSourceRecord(id: "alex", name: "Alex", content: "Name: Alex\nEmail: alex@example.com\nPhone: +1 (555) 123-4567"), AppleSourceRecord(id: "quiet", name: "Quiet", content: "Name: Quiet\nEmail: quiet@example.com")]
        _ = try await store.ingestAppleSnapshot(records, connector: "apple_contacts")
        try await store.ingest(message(sender: "+15551234567", daysAgo: 1, id: "one"))
        try await store.ingest(message(sender: "alex@example.com", daysAgo: 2, id: "two"))
        let ranked = try await store.people(now: now)
        #expect(ranked.count == 1)
        #expect(ranked.first?.name == "Alex")
        #expect(ranked.first?.interactions == 2)
        #expect(try await store.people(search: "quiet", now: now).count == 1)
        let quietID = "person:apple:" + ConnectorSourceRecord.identifier("quiet")
        try await store.pinPerson(quietID, pinned: true)
        #expect(try await store.people(now: now).first?.name == "Quiet")
        try await store.pinPerson(quietID, pinned: false)
        #expect(try await store.people(now: now).count == 1)
    }
    @Test func recentInteractionsOutrankOldAndAmbiguousHandlesDontMerge() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        _ = try await store.ingestAppleSnapshot([AppleSourceRecord(id: "a", name: "A", content: "Email: shared@example.com"), AppleSourceRecord(id: "b", name: "B", content: "Email: shared@example.com")], connector: "apple_contacts")
        try await store.ingest(message(sender: "shared@example.com", daysAgo: 0, id: "recent"))
        try await store.ingest(message(sender: "old@example.com", daysAgo: 20, id: "old"))
        try await store.ingest(message(sender: "expired@example.com", daysAgo: 40, id: "expired"))
        try await store.ingest(message(sender: "738245", daysAgo: 0, id: "shortcode"))
        let ranked = try await store.people(now: now)
        #expect(try await store.people(search: "738245", now: now).count == 1)
        #expect(ranked.count == 2)
        #expect(ranked.first?.name == "shared@example.com")
        #expect(ranked.first?.source == "Messages")
        #expect(!ranked.contains { $0.name == "A" || $0.name == "B" })
    }
    @Test func calendarSelectionNeverDeletesUnselectedSnapshots() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let a = AppleSourceRecord(id: "a", name: "Work", content: "Work plan", start: now, end: now.addingTimeInterval(3600), scopeID: "work")
        let b = AppleSourceRecord(id: "b", name: "Personal", content: "Personal plan", start: now, end: now.addingTimeInterval(3600), scopeID: "personal")
        let start = now.addingTimeInterval(-86400), end = now.addingTimeInterval(86400)
        _ = try await store.ingestAppleSnapshot([a,b], connector: "apple_calendar", windowStart: start, windowEnd: end)
        #expect(try await store.ingestAppleSnapshot([a], connector: "apple_calendar", windowStart: start, windowEnd: end, scopeIDs: ["work"]) == 0)
        #expect(try await store.appleRecords("apple_calendar").count == 2)
        #expect(try await store.ingestAppleSnapshot([], connector: "apple_calendar", windowStart: start, windowEnd: end, scopeIDs: []) == 0)
        do { _ = try await store.ingestAppleSnapshot([b], connector: "apple_calendar", windowStart: start, windowEnd: end, scopeIDs: ["work"]); Issue.record("Out-of-scope record accepted") } catch {}
        #expect(try await store.queue().count == 2)
    }
    @Test func versionFourMigrationKeepsExistingSourceHistory() async throws {
        let path = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
        defer { for suffix in ["", "-wal", "-shm"] { try? FileManager.default.removeItem(atPath: path + suffix) } }
        let store = try KnowledgeStore(path: path)
        let record = AppleSourceRecord(id: "a", name: "A", content: "Name: A")
        _ = try await store.ingestAppleSnapshot([record], connector: "apple_contacts")
        do { let db = try SQLite(path: path); try db.execute("ALTER TABLE connector_source_records RENAME TO apple_source_records"); try db.execute("PRAGMA user_version=4") }
        let migrated = try KnowledgeStore(path: path)
        #expect(try await migrated.appleRecords("apple_contacts") == [record])
        #expect(try await migrated.ingestAppleSnapshot([record], connector: "apple_contacts") == 0)
        #expect(try await migrated.eventCount() == 1)
    }
}
