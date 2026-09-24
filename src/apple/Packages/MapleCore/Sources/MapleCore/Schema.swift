import Foundation

extension SQLite {
    func migrate() throws {
        let version = try rows("PRAGMA user_version").first?["user_version"] ?? "0"
        guard ["0", "1", "2", "3", "4", "5", "6", "7", "8"].contains(version) else { throw MapleError.database("Database schema is newer than this build.") }
        guard version != "6" && version != "7" && version != "8" else { return }
        try transaction {
            if version == "5" {
                try repairContactFactSubjects()
                try execute("PRAGMA user_version = 6")
                return
            }
            if version == "4" {
                try execute("ALTER TABLE apple_source_records RENAME TO connector_source_records")
                try repairContactFactSubjects()
                try execute("PRAGMA user_version = 6")
                return
            }
            if version == "0" { for statement in Self.schema { try execute(statement) } }
            if version == "0" || version == "1" {
                try execute("CREATE TABLE connector_checkpoints (id TEXT PRIMARY KEY, activated_at REAL NOT NULL, scanned_at REAL NOT NULL)")
            }
            if version != "3" {
                try execute("CREATE TABLE fact_checks (id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id), json TEXT NOT NULL)")
                try execute("CREATE TABLE source_facts (id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id), subject TEXT NOT NULL, json TEXT NOT NULL)")
                try execute("CREATE INDEX source_facts_subject ON source_facts(subject)")
                try execute("CREATE TABLE fact_jobs (event_id TEXT PRIMARY KEY REFERENCES events(id), status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at REAL NOT NULL, lease_token TEXT, lease_until REAL, error TEXT)")
            }
            try execute("CREATE TABLE connector_source_records (connector TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, event_id TEXT NOT NULL REFERENCES events(id), active INTEGER NOT NULL, PRIMARY KEY(connector,id))")
            try repairContactFactSubjects()
            try execute("PRAGMA user_version = 6")
        }
    }

    /// Preserve fact IDs and evidence so existing corrections/source links remain valid.
    private func repairContactFactSubjects() throws {
        for row in try rows("SELECT f.json AS fact_json,e.json AS event_json FROM source_facts f JOIN events e ON e.id=f.event_id WHERE e.connector='apple_contacts' AND f.subject='person:self'") {
            let fact = try JSONCodec.decode(SourceFact.self, from: Data(row["fact_json"]!.utf8))
            let event = try JSONCodec.decode(Event.self, from: Data(row["event_json"]!.utf8))
            let subject = FactRules.subjects(for: event)[0]
            let repaired = SourceFact(id: fact.id, subject: subject, predicate: fact.predicate, value: fact.value,
                sourceQuote: fact.sourceQuote, eventID: fact.eventID, provider: fact.provider, model: fact.model, extractedAt: fact.extractedAt)
            try execute("UPDATE source_facts SET subject=?,json=? WHERE id=?", [subject, try JSONCodec.string(repaired), fact.id])
        }
    }

    private static let schema = [
        """
        CREATE TABLE events (
            id TEXT PRIMARY KEY, connector TEXT NOT NULL, account TEXT NOT NULL,
            external_id TEXT NOT NULL, revision TEXT NOT NULL, occurred_at REAL NOT NULL,
            received_at REAL NOT NULL, json TEXT NOT NULL,
            UNIQUE(connector, account, external_id, revision)
        )
        """,
        "CREATE TABLE event_subjects (event_id TEXT NOT NULL REFERENCES events(id), subject TEXT NOT NULL, PRIMARY KEY(event_id,subject))",
        "CREATE INDEX subjects_lookup ON event_subjects(subject,event_id)",
        "CREATE VIRTUAL TABLE events_fts USING fts5(event_id UNINDEXED, content)",
        """
        CREATE TABLE processing_jobs (
            event_id TEXT PRIMARY KEY REFERENCES events(id), status TEXT NOT NULL DEFAULT 'pending',
            attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at REAL NOT NULL,
            lease_until REAL, lease_token TEXT, error TEXT
        )
        """,
        """
        CREATE TABLE claims (
            id TEXT PRIMARY KEY, subject TEXT NOT NULL, predicate TEXT NOT NULL, value TEXT NOT NULL,
            evidence_event_id TEXT NOT NULL REFERENCES events(id), observed_at REAL NOT NULL,
            confidence REAL NOT NULL, origin TEXT NOT NULL,
            UNIQUE(subject,predicate,evidence_event_id)
        )
        """,
        "CREATE INDEX claims_lookup ON claims(subject,predicate,observed_at)",
        "CREATE TABLE decisions (event_id TEXT PRIMARY KEY REFERENCES events(id), json TEXT NOT NULL, raw_response TEXT NOT NULL)",
        """
        CREATE TABLE work_items (
            id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id),
            kind TEXT NOT NULL, status TEXT NOT NULL, UNIQUE(event_id,kind)
        )
        """,
    ]
}
