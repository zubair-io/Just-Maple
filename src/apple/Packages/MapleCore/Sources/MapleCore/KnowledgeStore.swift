import Foundation

public actor KnowledgeStore {
    let db: SQLite
    public init(path: String) throws {
        db = try SQLite(path: path)
        try db.migrate()
        try db.migrateWorld()
        try db.migrateTaskUserProtection()
        try db.migrateTaskExtractionRetries()
        try db.migrateIntelligence()
        try db.migrateDiscovery()
        try db.migrateTaskReconciliation()
        try db.migrateTaskActions()
        try db.migrateWaitingFollowUps()
        try db.migrateObligationAggregation()
        try db.migrateProcessingSchedule()
    }

    /// Event and queue insertion are atomic. Returns the canonical ID on duplicate delivery.
    @discardableResult
    public func ingest(_ event: Event) throws -> String {
        try event.validate()
        guard !event.type.hasPrefix("user.") else {
            throw MapleError.invalid("User commands must use the correction API, not connector ingestion.")
        }
        return try db.transaction { try insert(event, enqueue: true) }
    }

    func insert(_ event: Event, enqueue: Bool) throws -> String {
        let source = event.source
        if let existing = try db.rows("SELECT id, json FROM events WHERE connector=? AND account=? AND external_id=? AND revision=?",
                                      [source.connector, source.account, source.externalID, source.revision]).first {
            let stored = try JSONCodec.decode(Event.self, from: Data(existing["json"]!.utf8))
            guard stored.type == event.type, stored.content == event.content, stored.subjects == event.subjects else {
                throw MapleError.invalid("A source revision was reused with different content. Supply a new revision.")
            }
            return existing["id"]!
        }
        try db.execute("INSERT INTO events VALUES (?,?,?,?,?,?,?,?)", [event.id, source.connector, source.account,
                       source.externalID, source.revision, String(event.occurredAt.timeIntervalSince1970),
                       String(event.receivedAt.timeIntervalSince1970), try JSONCodec.string(event)])
        for subject in Set(event.subjects) {
            try db.execute("INSERT INTO event_subjects VALUES (?,?)", [event.id, subject])
        }
        try db.execute("INSERT INTO events_fts(event_id,content) VALUES (?,?)", [event.id, event.content])
        try db.execute("INSERT INTO embedding_jobs(event_id) VALUES (?)", [event.id])
        if enqueue {
            try db.execute("INSERT INTO processing_jobs(event_id,next_attempt_at) VALUES (?,?)",
                           [event.id, String(event.receivedAt.timeIntervalSince1970)])
        }
        try history(subjects:[event.id]+event.subjects,type:"source.\(event.source.connector).\(event.type)",before:Optional<String>.none,after:event.id,command:"event:"+event.id,at:event.receivedAt,actor:event.source.connector,effectiveAt:event.occurredAt)
        return event.id
    }

    public func event(_ id: String) throws -> Event? {
        guard let json = try db.rows("SELECT json FROM events WHERE id=?", [id]).first?["json"] else { return nil }
        return try JSONCodec.decode(Event.self, from: Data(json.utf8))
    }

    public func eventCount() throws -> Int {
        Int(try db.rows("SELECT COUNT(*) AS n FROM events").first?["n"] ?? "0") ?? 0
    }

    /// Latest explicit correction wins over any inference. All superseded claims remain inspectable.
    public func state(subjects: [String]? = nil) throws -> [Claim] {
        let rows = try db.rows("SELECT * FROM claims ORDER BY (origin='user') DESC, observed_at DESC, rowid DESC")
        var seen = Set<String>()
        var result: [Claim] = []
        for row in rows {
            let subject = row["subject"]!, predicate = row["predicate"]!
            guard subjects == nil || subjects!.contains(subject) else { continue }
            let key = try JSONCodec.string([subject, predicate])
            guard seen.insert(key).inserted else { continue }
            result.append(claim(row))
        }
        return result.sorted { ($0.subject, $0.predicate) < ($1.subject, $1.predicate) }
    }

    public func claimHistory(subject: String, predicate: String) throws -> [Claim] {
        try db.rows("SELECT * FROM claims WHERE subject=? AND predicate=? ORDER BY observed_at,rowid", [subject, predicate]).map(claim)
    }

    @discardableResult
    public func correct(subject: String, predicate: String, value: String, at: Date = Date()) throws -> Claim {
        guard [subject, predicate, value].allSatisfy({ !$0.isEmpty && $0.utf8.count <= 1024 }) else {
            throw MapleError.invalid("Correction fields must be nonempty and bounded.")
        }
        let event = Event(type: "user.correction", source: Source(connector: "user", account: "local",
                          externalID: UUID().uuidString, revision: "1"), occurredAt: at, receivedAt: at,
                          subjects: [subject], content: "User correction: \(predicate) = \(value)")
        let claim = Claim(id: UUID().uuidString, subject: subject, predicate: predicate, value: value,
                          evidenceEventID: event.id, observedAt: at, confidence: 1, origin: "user")
        try db.transaction {
            _ = try insert(event, enqueue: false)
            try insertClaim(claim)
        }
        return claim
    }

    func insertClaim(_ claim: Claim) throws {
        try db.execute("INSERT OR IGNORE INTO claims VALUES (?,?,?,?,?,?,?,?)",
                       [claim.id, claim.subject, claim.predicate, claim.value, claim.evidenceEventID,
                        String(claim.observedAt.timeIntervalSince1970), String(claim.confidence), claim.origin])
    }

    private func claim(_ row: [String: String]) -> Claim {
        Claim(id: row["id"]!, subject: row["subject"]!, predicate: row["predicate"]!, value: row["value"]!,
              evidenceEventID: row["evidence_event_id"]!, observedAt: Date(timeIntervalSince1970: Double(row["observed_at"]!)!),
              confidence: Double(row["confidence"]!)!, origin: row["origin"]!)
    }

    public func decision(eventID:String) throws -> Decision? {
        guard let row = try db.rows("SELECT json FROM decisions WHERE event_id=?",[eventID]).first else {return nil}
        return try JSONCodec.decode(Decision.self,from:Data(row["json"]!.utf8))
    }

    public func decisions() throws -> [Decision] {
        try db.rows("SELECT json FROM decisions ORDER BY rowid").map {
            try JSONCodec.decode(Decision.self, from: Data($0["json"]!.utf8))
        }
    }

    public func workItems() throws -> [WorkItem] {
        try db.rows("SELECT * FROM work_items ORDER BY rowid").map {
            WorkItem(id: $0["id"]!, eventID: $0["event_id"]!, kind: $0["kind"]!, status: $0["status"]!)
        }
    }

    public func dismiss(_ id: String) throws {
        guard let row = try db.rows("SELECT kind FROM work_items WHERE id=?", [id]).first,
              ["notify", "ask_user"].contains(row["kind"]!) else {
            throw MapleError.invalid("Only existing inbox items can be dismissed.")
        }
        try db.execute("UPDATE work_items SET status='dismissed' WHERE id=?", [id])
    }
}
