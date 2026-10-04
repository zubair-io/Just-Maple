import Foundation
import CryptoKit

extension KnowledgeStore {
    /// File content hashes identify bytes, not observations: A→B→A is a real
    /// revision, while reopening unchanged A must be idempotent. Chain each new
    /// observation to its predecessor atomically without rewriting old evidence.
    @discardableResult
    public func ingestNotebookObservation(_ observation: Event) throws -> String {
        try observation.validate()
        guard observation.source.connector == "notes", observation.type == "note.updated" else {
            throw MapleError.invalid("Notebook observation ingress only accepts note.updated sources.")
        }
        return try db.transaction {
            let source = observation.source
            let row = try db.rows("""
                SELECT json FROM events WHERE connector='notes' AND account=? AND external_id=?
                AND json_extract(json,'$.type')='note.updated' ORDER BY received_at DESC,rowid DESC LIMIT 1
                """, [source.account, source.externalID]).first
            let previous = try row.map { try JSONCodec.decode(Event.self, from: Data($0["json"]!.utf8)) }
            if let previous, previous.content == observation.content, previous.subjects == observation.subjects {
                return previous.id
            }
            let revisionInput = try JSONCodec.encode([source.revision, previous?.id ?? "initial"])
            let revision = SHA256.hash(data: revisionInput).map { String(format: "%02x", $0) }.joined()
            let event = Event(id: observation.id, type: observation.type,
                              source: Source(connector: source.connector, account: source.account, externalID: source.externalID,
                                             revision: revision, timeZone: source.timeZone),
                              occurredAt: observation.occurredAt,
                              receivedAt: max(observation.receivedAt, previous?.receivedAt ?? observation.receivedAt),
                              subjects: observation.subjects, content: observation.content)
            let id = try insert(event, enqueue: true)
            try debounceNoteClassification(event)
            return id
        }
    }

    /// Called only for newly inserted events, inside the ingestion transaction.
    /// Local evidence/indexing is immediate; autosaved prose gets a quiet window
    /// before paid classification. Duplicate delivery never extends that window.
    func debounceNoteClassification(_ event: Event) throws {
        guard event.source.connector == "notes", event.type == "note.updated" else { return }
        try db.execute("UPDATE processing_jobs SET next_attempt_at=? WHERE event_id=?",
                       [String(event.receivedAt.addingTimeInterval(120).timeIntervalSince1970), event.id])
        try db.execute("""
            UPDATE source_transitions SET reason='note_autosave_quiet_window'
            WHERE sequence=(SELECT MAX(sequence) FROM source_transitions WHERE event_id=? AND stage='classification')
            """, [event.id])
        let priorIDs = try db.rows("""
            SELECT p.event_id FROM processing_jobs p JOIN events e ON e.id=p.event_id
            WHERE e.connector='notes' AND e.account=? AND e.external_id=? AND e.id<>?
              AND json_extract(e.json,'$.type')='note.updated' AND e.received_at<=?
              AND p.status='pending' AND p.attempts=0 AND p.error IS NULL AND p.lease_token IS NULL
            """, [event.source.account, event.source.externalID, event.id, String(event.receivedAt.timeIntervalSince1970)])
            .compactMap { $0["event_id"] }
        for priorID in priorIDs {
            try db.execute("""
                UPDATE processing_jobs SET status='coalesced',error=?,lease_token=NULL,lease_until=NULL WHERE event_id=?
                """, ["Indexed locally; note autosave superseded by revision " + event.id, priorID])
            // The generic queue trigger records the transition; attach explicit
            // provenance without depending on parsing its human-readable error.
            try db.execute("""
                UPDATE source_transitions SET reason='note_autosave_superseded',related_event_id=?
                WHERE sequence=(SELECT MAX(sequence) FROM source_transitions WHERE event_id=? AND stage='classification')
                """, [event.id, priorID])
        }
    }
}
