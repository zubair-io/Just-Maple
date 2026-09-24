import Foundation

struct Lease: Sendable {
    let eventID: String
    let token: String
}

extension KnowledgeStore {
    func acquire(now: Date, duration: TimeInterval = 90, eventIDs:[String]? = nil) throws -> Lease? {
        try excludeExpiredAIWork(at:now)
        return try db.transaction {
            if let eventIDs,eventIDs.isEmpty {return nil}
            let filter=eventIDs.map{" AND event_id IN ("+Array(repeating:"?",count:$0.count).joined(separator:",")+")"} ?? ""
            guard let row = try db.rows("""
                SELECT event_id FROM processing_jobs WHERE
                ((status='pending' AND next_attempt_at<=?) OR (status='leased' AND lease_until<=?))\(filter)
                ORDER BY next_attempt_at,rowid LIMIT 1
                """, [String(now.timeIntervalSince1970), String(now.timeIntervalSince1970)] + (eventIDs ?? [])).first else { return nil }
            let lease = Lease(eventID: row["event_id"]!, token: UUID().uuidString)
            try db.execute("UPDATE processing_jobs SET status='leased', attempts=attempts+1, lease_token=?, lease_until=?, error=NULL WHERE event_id=?",
                           [lease.token, String(now.addingTimeInterval(duration).timeIntervalSince1970), lease.eventID])
            return lease
        }
    }

    func finish(_ lease: Lease, decision: Decision, raw: Data, now: Date) throws -> Bool {
        try db.transaction {
            guard try owns(lease, now: now) else { return false }
            let freshContext = try modelContext(for:lease.eventID,at:now)
            let fresh = freshContext.currentState
            // A correction/another event can arrive while the network request is in flight.
            guard Array(fresh.prefix(24)) == decision.context.currentState else {
                try db.execute("UPDATE processing_jobs SET status='pending', next_attempt_at=?, lease_token=NULL, lease_until=NULL WHERE event_id=?",
                               [String(now.timeIntervalSince1970), lease.eventID])
                return false
            }
            let freshFacts = freshContext.sourceFacts ?? []
            guard freshFacts == (decision.context.sourceFacts ?? []) else {
                try db.execute("UPDATE processing_jobs SET status='pending', next_attempt_at=?, lease_token=NULL, lease_until=NULL WHERE event_id=?", [String(now.timeIntervalSince1970), lease.eventID])
                return false
            }
            // Quiet historical retention does not imply an explicit request is resolved.
            let signals=decision.assessment.message
            if decision.route != .retain || (signals?.actionNeeded ?? 0) >= 0.85 || (signals?.replyNeeded ?? 0) >= 0.85 || (signals?.commitmentChanged ?? 0) >= 0.85 {
                try enqueueTaskExtraction(decision.context.event)
            }
            let assessment = decision.assessment
            if let probability = assessment.containsFacts {
                try insertFactCheck(eventID: lease.eventID, probability: probability, provider: assessment.provider, model: assessment.model, now: now, context: decision.context, rawResponse: String(decoding: raw, as: UTF8.self))
            }
            let jobs = decision.context.event.subjects.filter { $0.hasPrefix("job:") }
            if assessment.stageConfidence >= 0.85,
               ![JobStage.unchanged, .uncertain].contains(assessment.jobStage), jobs.count == 1 {
                try insertClaim(Claim(id: UUID().uuidString, subject: jobs[0], predicate: "job.status",
                                      value: assessment.jobStage.rawValue, evidenceEventID: lease.eventID,
                                      observedAt: decision.context.event.occurredAt, confidence: assessment.stageConfidence,
                                      origin: "inference"))
            }
            try db.execute("INSERT INTO decisions VALUES (?,?,?)",
                           [lease.eventID, try JSONCodec.string(decision), String(decoding: raw, as: UTF8.self)])
            if decision.route != .retain {
                let status = [.notify, .askUser].contains(decision.route) ? "unread" : "proposed"
                try db.execute("INSERT OR IGNORE INTO work_items VALUES (?,?,?,?)",
                               [UUID().uuidString, lease.eventID, decision.route.rawValue, status])
            }
            try db.execute("UPDATE processing_jobs SET status='succeeded', lease_token=NULL, lease_until=NULL, error=NULL WHERE event_id=?", [lease.eventID])
            return true
        }
    }

    func fail(_ lease: Lease, error: String, now: Date) throws {
        try db.transaction {
            guard try owns(lease, now: now) else { return }
            let attempts = Int(try db.rows("SELECT attempts FROM processing_jobs WHERE event_id=?", [lease.eventID]).first?["attempts"] ?? "1") ?? 1
            let delay = min(3600.0, 5 * pow(2, Double(min(attempts - 1, 10))))
            try db.execute("UPDATE processing_jobs SET status=?, next_attempt_at=?, error=?, lease_token=NULL, lease_until=NULL WHERE event_id=?",
                           [attempts >= 5 ? "blocked" : "pending", String(now.addingTimeInterval(delay).timeIntervalSince1970),
                            String(error.prefix(500)), lease.eventID])
        }
    }

    private func owns(_ lease: Lease, now: Date) throws -> Bool {
        !(try db.rows("SELECT event_id FROM processing_jobs WHERE event_id=? AND status='leased' AND lease_token=? AND lease_until>?",
                      [lease.eventID, lease.token, String(now.timeIntervalSince1970)])).isEmpty
    }

    public func retryFailures(now: Date = Date()) throws {
        try db.execute("UPDATE processing_jobs SET status='pending', attempts=0, next_attempt_at=?, error=NULL WHERE status='blocked' OR (status='pending' AND error IS NOT NULL)",
                       [String(now.timeIntervalSince1970)])
    }

    public func queue() throws -> [QueueItem] {
        try db.rows("SELECT * FROM processing_jobs ORDER BY rowid").map {
            QueueItem(eventID: $0["event_id"]!, status: $0["status"]!, attempts: Int($0["attempts"]!)!,
                      nextAttemptAt: Date(timeIntervalSince1970: Double($0["next_attempt_at"]!)!), error: $0["error"])
        }
    }
}
