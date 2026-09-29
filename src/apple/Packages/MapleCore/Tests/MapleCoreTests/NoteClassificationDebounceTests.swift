import Foundation
import Testing
@testable import MapleCore

struct NoteClassificationDebounceTests {
    let now = Date(timeIntervalSince1970: floor(Date().timeIntervalSince1970))
    func note(_ revision: String, account: String = "fixture", path: String = "note.md", type: String = "note.updated", connector: String = "notes", offset: TimeInterval = 0) -> Event {
        Event(id: revision, type: type, source: Source(connector: connector, account: account, externalID: path, revision: revision),
              occurredAt: now.addingTimeInterval(offset), receivedAt: now.addingTimeInterval(offset), subjects: ["person:self"], content: "Synthetic note \(revision)")
    }
    @Test func rapidRevisionsDelayLatestAndPreserveAllEvidenceWithInspectibleLinks() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        for index in 0..<3 { _ = try await store.ingestNotebookObservation(note("revision-\(index)", offset: Double(index))) }
        let queue = try await store.queue()
        #expect(queue.map(\.status) == ["coalesced", "coalesced", "pending"])
        #expect(queue.last?.nextAttemptAt == now.addingTimeInterval(122))
        #expect(try await store.acquire(now: now.addingTimeInterval(121.9)) == nil)
        #expect(try await store.acquire(now: now.addingTimeInterval(122))?.eventID == "revision-2")
        #expect(try await store.noteDebounceCounts() == [3, 3, 3, 0])
        #expect(try await store.noteDebounceLink("revision-0") == ["note_autosave_superseded", "revision-1"])
        #expect(try await store.noteDebounceLink("revision-1") == ["note_autosave_superseded", "revision-2"])
    }
    @Test func duplicateDeliveryDoesNotExtendQuietWindowOrAddTransitions() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let first = note("same")
        _ = try await store.ingestNotebookObservation(first)
        let transitions = try await store.noteDebounceTransitionCount()
        let duplicate = Event(id: "duplicate", type: first.type, source: first.source, occurredAt: first.occurredAt,
                              receivedAt: now.addingTimeInterval(90), subjects: first.subjects, content: first.content)
        #expect(try await store.ingestNotebookObservation(duplicate) == first.id)
        #expect(try await store.queue().first?.nextAttemptAt == now.addingTimeInterval(120))
        #expect(try await store.noteDebounceTransitionCount() == transitions)
        #expect(try await store.eventCount() == 1)
    }
    @Test func unrelatedEntitiesAndCaptureImportKindsAreNeverCoalesced() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        for event in [note("baseline"), note("other-account", account: "other"), note("other-file", path: "other.md"),
                      note("capture", type: "note.created"), note("import", type: "note.imported"), note("other-connector", connector: "resume")] {
            if event.source.connector == "notes", event.type == "note.updated" {
                _ = try await store.ingestNotebookObservation(event)
            } else { _ = try await store.ingest(event) }
        }
        #expect(try await store.queue().allSatisfy { $0.status == "pending" })
        for id in ["capture", "import", "other-connector"] {
            #expect(try await store.acquire(now: now, eventIDs: [id])?.eventID == id)
        }
    }
    @Test func activeLeasesAndPreviouslyAttemptedOrFailedWorkSurvive() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        _ = try await store.ingestNotebookObservation(note("leased"))
        let lease = try #require(await store.acquire(now: now.addingTimeInterval(120), eventIDs: ["leased"]))
        _ = try await store.ingestNotebookObservation(note("next", offset: 121))
        #expect(try await store.queue().first?.status == "leased")
        try await store.fail(lease, error: "Synthetic failure", now: now.addingTimeInterval(122))
        _ = try await store.ingestNotebookObservation(note("latest", offset: 123))
        let prior = try #require(await store.queue().first)
        #expect(prior.status == "pending")
        #expect(prior.attempts == 1)
        #expect(prior.error == "Synthetic failure")
        #expect(try await store.queue().first { $0.eventID == "next" }?.status == "coalesced")
    }
    @Test func failedTransactionLeavesOriginalQueueAndEvidenceIntact() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        _ = try await store.ingestNotebookObservation(note("original"))
        await #expect(throws: MapleError.self) { try await store.insertNoteThenRollback(note("rolled-back", offset: 1)) }
        #expect(try await store.queue().map(\.status) == ["pending"])
        #expect(try await store.noteDebounceCounts() == [1, 1, 1, 0])
        #expect(try await store.noteDebounceLink("original") == ["note_autosave_quiet_window", ""])
    }
    @Test func notebookReversionIsANewObservationAndUnchangedReopenIsIdempotent() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let first = note("A")
        let firstID = try await store.ingestNotebookObservation(first)
        _ = try await store.ingestNotebookObservation(note("B", offset: 1))
        let reverted = Event(id: "reverted-A", type: first.type, source: first.source, occurredAt: now.addingTimeInterval(2),
                             receivedAt: now.addingTimeInterval(2), subjects: first.subjects, content: first.content)
        let revertedID = try await store.ingestNotebookObservation(reverted)
        #expect(revertedID != firstID)
        #expect(try await store.event(firstID)?.content == first.content)
        #expect(try await store.event(revertedID)?.content == first.content)
        #expect(try await store.event(firstID)?.source.revision != store.event(revertedID)?.source.revision)
        #expect(try await store.queue().map(\.status) == ["coalesced", "coalesced", "pending"])
        let reopen = Event(id: "reopened-A", type: first.type, source: first.source, occurredAt: now.addingTimeInterval(90),
                           receivedAt: now.addingTimeInterval(90), subjects: first.subjects, content: first.content)
        #expect(try await store.ingestNotebookObservation(reopen) == revertedID)
        #expect(try await store.queue().last?.nextAttemptAt == now.addingTimeInterval(122))
        #expect(try await store.eventCount() == 3)
    }
    @Test func concurrentUnchangedNotebookReadsCreateOnlyOneObservation() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let first = note("same")
        let duplicate = Event(id: "concurrent", type: first.type, source: first.source, occurredAt: first.occurredAt,
                              receivedAt: first.receivedAt, subjects: first.subjects, content: first.content)
        async let left = store.ingestNotebookObservation(first)
        async let right = store.ingestNotebookObservation(duplicate)
        let ids = try await [left, right]
        #expect(Set(ids).count == 1)
        #expect(try await store.eventCount() == 1)
    }
    @Test func notebookObservationsKeepMonotonicReceiptOrderAndGenericIngestionStaysImmediate() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        _ = try await store.ingestNotebookObservation(note("first"))
        let second = note("second", offset: -30)
        _ = try await store.ingestNotebookObservation(second)
        #expect(try await store.event(second.id)?.receivedAt == now)
        #expect(try await store.queue().map(\.status) == ["coalesced", "pending"])
        let reread = Event(id: "reread", type: second.type, source: second.source, occurredAt: now,
                           receivedAt: now.addingTimeInterval(60), subjects: second.subjects, content: second.content)
        #expect(try await store.ingestNotebookObservation(reread) == second.id)
        let explicit = note("explicit", path: "explicit.md")
        _ = try await store.ingest(explicit)
        #expect(try await store.acquire(now: now, eventIDs: [explicit.id])?.eventID == explicit.id)
    }
}

private extension KnowledgeStore {
    func noteDebounceCounts() throws -> [Int] {
        try ["events", "events_fts", "embedding_jobs", "decisions"].map {
            Int(try db.rows("SELECT COUNT(*) AS n FROM \($0)").first!["n"]!)!
        }
    }
    func noteDebounceLink(_ id: String) throws -> [String] {
        let row = try db.rows("SELECT reason,related_event_id FROM source_transitions WHERE event_id=? AND stage='classification' ORDER BY sequence DESC LIMIT 1", [id]).first!
        return [row["reason"] ?? "", row["related_event_id"] ?? ""]
    }
    func noteDebounceTransitionCount() throws -> Int {
        Int(try db.rows("SELECT COUNT(*) AS n FROM source_transitions").first!["n"]!)!
    }
    func insertNoteThenRollback(_ event: Event) throws {
        try db.transaction {
            _ = try insert(event, enqueue: true)
            try debounceNoteClassification(event)
            throw MapleError.invalid("Synthetic rollback")
        }
    }
}
