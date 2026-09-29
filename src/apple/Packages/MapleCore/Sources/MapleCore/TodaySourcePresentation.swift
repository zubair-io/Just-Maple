import Foundation

extension KnowledgeStore {
    /// A source excerpt, not an AI summary or an explanation of which entity caused a decision.
    func homeBatchPreview(_ batch: Event) throws -> String? {
        guard batch.source.connector == "home_assistant", batch.type == "home.batch" else { return nil }
        let entities = try db.rows("""
            SELECT e.external_id FROM home_batch_members m JOIN events e ON e.id=m.event_id
            WHERE m.batch_id=? GROUP BY e.external_id ORDER BY e.external_id
            """, [batch.id]).compactMap { $0["external_id"] }
        guard !entities.isEmpty else { return nil }
        func field(_ name: String, _ event: Event) -> String? {
            event.content.components(separatedBy: "\n").prefix(16).first { $0.hasPrefix(name + ": ") }
                .map { String($0.dropFirst(name.count + 2).prefix(60)) }
        }
        var excerpts = [String]()
        for entity in entities.prefix(3) {
            let rows = try db.rows("""
                SELECT e.id,m.previous_event_id FROM home_batch_members m JOIN events e ON e.id=m.event_id
                WHERE m.batch_id=? AND e.external_id=? ORDER BY e.occurred_at,e.received_at,e.rowid
                """, [batch.id, entity])
            guard let last = rows.last?["id"], let current = try event(last) else { continue }
            let first = rows.first!
            let previousID = first["previous_event_id"] ?? (rows.count > 1 ? first["id"] : nil)
            let previous = try previousID.flatMap { try event($0) }
            let name = field("Name", current) ?? field("Home Assistant entity", current) ?? "Home observation"
            if let state = field("State", current) {
                let before = previous.flatMap { field("State", $0) }
                excerpts.append(name + ": " + (before.map { $0 + " → " } ?? "observed ") + state)
            } else { excerpts.append(name + ": captured update") }
        }
        if entities.count > 3 { excerpts.append("+\(entities.count - 3) more entities; inspect batch evidence") }
        return "Observed changes · " + excerpts.joined(separator: "; ")
    }

    func sourceAttentionReason(_ eventID: String) throws -> String? {
        guard let decision = try decision(eventID: eventID) else { return nil }
        switch decision.route {
        case .notify: return "Needs attention"
        case .askUser: return "Reply or decision requested"
        case .summarize: return "For your information"
        default: return nil
        }
    }
}
