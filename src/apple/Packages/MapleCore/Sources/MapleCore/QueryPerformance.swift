import Foundation

extension SQLite {
    func migrateQueryPerformance() throws {
        try transaction {
            // The entity prefix is essential: account-only indexes make the old OR
            // anti-join scan thousands of unrelated revisions for every observation.
            try execute("CREATE INDEX IF NOT EXISTS events_entity_received ON events(connector,account,external_id,received_at DESC)")
            try execute("CREATE INDEX IF NOT EXISTS semantic_chunks_event_model ON semantic_chunks(event_id,model,dimensions)")
            try execute("CREATE INDEX IF NOT EXISTS claims_subject_priority ON claims(subject,(origin='user') DESC,observed_at DESC)")
        }
    }
}
