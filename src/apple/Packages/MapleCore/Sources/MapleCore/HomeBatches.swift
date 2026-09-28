import Foundation

extension SQLite {
    func migrateHomeBatches() throws {
        try execute("CREATE TABLE IF NOT EXISTS home_batch_members(event_id TEXT PRIMARY KEY REFERENCES events(id),batch_id TEXT NOT NULL REFERENCES events(id),previous_event_id TEXT REFERENCES events(id))")
        try execute("CREATE INDEX IF NOT EXISTS home_batch_members_batch ON home_batch_members(batch_id,event_id)")
    }
}

extension KnowledgeStore {
    /// Runs in the ingestion/acquisition transaction. The batch owns the only model job;
    /// its members remain immutable, individually searchable source observations.
    @discardableResult
    func createHomeBatch(_ members: [(id: String, previousID: String?)]) throws -> String? {
        guard !members.isEmpty else { return nil }
        let events = try members.map { member -> Event in
            guard let event = try event(member.id), event.source.connector == "home_assistant",
                  event.type != "home.batch" else { throw MapleError.invalid("Invalid home batch member.") }
            return event
        }
        guard Set(events.map { $0.source.account }).count == 1 else { throw MapleError.invalid("Home batches cannot mix accounts.") }
        let key = ConnectorSourceRecord.identifier(members.map(\.id).sorted().joined(separator: "\n"))
        let batch = Event(type: "home.batch", source: Source(connector: "home_assistant", account: events[0].source.account,
                          externalID: "home-batch:" + key, revision: "1"),
                          occurredAt: events.map(\.occurredAt).max()!, receivedAt: events.map(\.receivedAt).max()!,
                          subjects: ["home:self"],
                          content: "Title: Home update · \(Set(events.map { $0.source.externalID }).count) changed entities\nA Home Assistant observation batch. Individual observations and their previous states are linked as evidence; classification applies to the batch as a whole.")
        try batch.validate()
        let batchID = try insert(batch, enqueue: true)
        for member in members {
            try db.execute("INSERT INTO home_batch_members(event_id,batch_id,previous_event_id) VALUES (?,?,?)", [member.id, batchID, member.previousID])
            try db.execute("UPDATE processing_jobs SET status='batched',lease_token=NULL,lease_until=NULL WHERE event_id=?", [member.id])
            try db.execute("UPDATE source_transitions SET reason='Classified together in one Home Assistant batch.',related_event_id=? WHERE sequence=(SELECT MAX(sequence) FROM source_transitions WHERE event_id=? AND stage='classification')", [batchID, member.id])
        }
        return batchID
    }

    /// Group eligible pending work from older builds into its ten-minute window.
    /// Prior attempts remain inspectable; blocked and in-flight work is untouched.
    func batchLegacyHomeWork(startingAt id: String, now: Date) throws -> String? {
        guard let seed = try event(id), seed.source.connector == "home_assistant", seed.type != "home.batch",
              try db.rows("SELECT event_id FROM processing_jobs WHERE event_id=? AND status='pending' AND attempts<5 AND next_attempt_at<=?", [id, String(now.timeIntervalSince1970)]).count == 1 else { return nil }
        let start = floor(seed.receivedAt.timeIntervalSince1970 / 600) * 600
        let rows = try db.rows("""
            SELECT e.id FROM events e JOIN processing_jobs p ON p.event_id=e.id
            WHERE e.connector='home_assistant' AND e.account=? AND e.received_at>=? AND e.received_at<?
              AND e.occurred_at>=? AND json_extract(e.json,'$.type')<>'home.batch'
              AND p.status='pending' AND p.attempts<5 AND p.next_attempt_at<=?
              AND NOT EXISTS(SELECT 1 FROM home_batch_members m WHERE m.event_id=e.id)
            ORDER BY e.received_at,e.id
            """, [seed.source.account, String(start), String(start + 600), String(now.addingTimeInterval(-AIProcessingWindow.duration).timeIntervalSince1970), String(now.timeIntervalSince1970)])
        return try createHomeBatch(rows.map { ($0["id"]!, nil) })
    }

    func homeBatchSubjects(_ id: String) throws -> [String] {
        try db.rows("""
            SELECT DISTINCT s.subject FROM home_batch_members m JOIN event_subjects s ON s.event_id=m.event_id
            WHERE m.batch_id=? AND s.subject LIKE 'home:%'
            UNION SELECT 'home:self' ORDER BY subject
            """, [id]).compactMap { $0["subject"] }
    }

    func homeBatchContext(_ batch: Event, at: Date = Date()) throws -> Context {
        let rows = try db.rows("SELECT event_id,previous_event_id FROM home_batch_members WHERE batch_id=? ORDER BY event_id", [batch.id])
        guard !rows.isEmpty else { throw MapleError.invalid("Home batch has no linked observations.") }
        var current = [Event](), previous = [Event](), seen = Set<String>()
        for row in rows {
            guard let observation = try event(row["event_id"]!) else { throw MapleError.invalid("Home batch evidence is missing.") }
            // Never silently truncate a batch or classify only some of its members.
            try AIProcessingWindow.require(observation, at: at)
            current.append(observation)
            if let id = row["previous_event_id"], seen.insert(id).inserted, let prior = try event(id),
               prior.source.account == batch.source.account, AIProcessingWindow.includes(prior.occurredAt, at: at) { previous.append(prior) }
        }
        let snapshot = try classificationValidationSnapshot(for: batch.id, at: at)
        let context = Context(event: batch, currentState: snapshot.currentState, recentEvents: previous,
                              relatedEvidence: current, version: "home-batch-v1", sourceFacts: [])
        guard try JSONCodec.encode(context).count <= 256_000 else {
            throw MapleError.invalid("Home batch exceeds the classification size limit. Evidence is retained; no partial request was sent.")
        }
        return context
    }
}
