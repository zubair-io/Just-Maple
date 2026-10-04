import Foundation

extension KnowledgeStore {
    /// New evidence invalidates only existing attention in the same explicit conversation.
    /// Pending reviews coalesce during import; polling and duplicate deliveries do nothing.
    func invalidateConversationAttention(after event: Event) throws {
        _ = try queueConversationAttentionReview(event, at: event.receivedAt, debounce: 30)
    }

    /// Bounded, explicit repair for already-imported conversation evidence. This queues
    /// real classification; it never declares a thread resolved or fabricates a decision.
    @discardableResult
    public func requestConversationAttentionReview(eventID: String, at: Date = Date()) throws -> [String] {
        guard let source = try event(eventID) else { throw MapleError.invalid("Source not found.") }
        try AIProcessingWindow.require(source, at: at)
        return try db.transaction { try queueConversationAttentionReview(source, at: at, debounce: 0) }
    }

    private func queueConversationAttentionReview(_ source: Event, at: Date, debounce: TimeInterval) throws -> [String] {
        guard ["gmail", "imessage"].contains(source.source.connector) else { return [] }
        let threads = source.subjects.filter { $0.hasPrefix("thread:\(source.source.connector):") }
        guard !threads.isEmpty else { return [] }
        let rows = try db.rows("""
            SELECT DISTINCT e.id,p.status FROM events e
            JOIN processing_jobs p ON p.event_id=e.id
            JOIN event_subjects s ON s.event_id=e.id
            WHERE e.connector=? AND e.account=?
              AND s.subject IN (SELECT value FROM json_each(?))
              AND e.occurred_at>=? AND e.occurred_at<=? AND e.received_at<=?
              AND p.status IN ('succeeded','pending')
              AND (EXISTS (SELECT 1 FROM work_items w WHERE w.event_id=e.id
                  AND ((w.status='unread' AND w.kind IN ('notify','ask_user'))
                    OR (w.status='proposed' AND w.kind IN ('summarize','reason'))))
                OR EXISTS (SELECT 1 FROM task_suggestions t WHERE json_extract(t.json,'$.eventID')=e.id
                  AND json_extract(t.json,'$.reviewStatus')='pending'))
            ORDER BY e.occurred_at DESC,e.id LIMIT 64
            """, [source.source.connector, source.source.account, try JSONCodec.string(threads),
                    String(at.addingTimeInterval(-AIProcessingWindow.duration).timeIntervalSince1970),
                    String(at.timeIntervalSince1970), String(at.timeIntervalSince1970)])
        var queued: [String] = []
        for row in rows {
            let id = row["id"]!
            // A current committed snapshot makes manual repair idempotent too.
            if let prior = try decision(eventID: id), prior.context.messageReview != nil,
               try classificationMessageReviewIsCurrent(prior.context, at: at) { continue }
            if row["status"] == "succeeded" {
                try db.execute("""
                    UPDATE processing_jobs SET status='pending',attempts=0,next_attempt_at=?,
                      lease_token=NULL,lease_until=NULL,error=NULL WHERE event_id=? AND status='succeeded'
                    """, [String(at.addingTimeInterval(debounce).timeIntervalSince1970), id])
            } else if debounce > 0 {
                // Do not reset failures/attempts. A burst is one review after it settles,
                // and the original retry backoff remains a lower bound.
                try db.execute("UPDATE processing_jobs SET next_attempt_at=MAX(next_attempt_at,?) WHERE event_id=? AND status='pending'",
                               [String(at.addingTimeInterval(debounce).timeIntervalSince1970), id])
            }
            queued.append(id)
        }
        return queued
    }

    /// A successful, fenced reassessment supersedes stale machine attention. Dismissal
    /// stays user-owned, and canonical task completion is deliberately separate.
    func commitConversationAttention(_ decision: Decision) throws {
        guard decision.context.messageReview != nil else { return }
        try db.execute("""
            UPDATE work_items SET status='superseded' WHERE event_id=?
              AND kind IN ('notify','ask_user','summarize','reason')
              AND status IN ('unread','proposed') AND kind<>?
            """, [decision.eventID, decision.route.rawValue])
        if decision.route != .retain {
            let status = [.notify, .askUser].contains(decision.route) ? "unread" : "proposed"
            try db.execute("UPDATE work_items SET status=? WHERE event_id=? AND kind=? AND status='superseded'",
                           [status, decision.eventID, decision.route.rawValue])
        }
    }

    func reviewPriorTaskProposalsIfNeeded(_ decision: Decision) throws {
        guard decision.context.messageReview != nil,
              try self.decision(eventID: decision.eventID) != nil,
              !(try db.rows("SELECT id FROM task_suggestions WHERE json_extract(json,'$.eventID')=? AND json_extract(json,'$.reviewStatus')='pending' LIMIT 1", [decision.eventID])).isEmpty else { return }
        // A quiet reassessment is not proof that a suggestion was completed. Ask the
        // task reviewer using fresh evidence; its versioned proposal path owns retirement.
        try requestTaskExtraction(eventID: decision.eventID, reprocess: true)
    }
}
