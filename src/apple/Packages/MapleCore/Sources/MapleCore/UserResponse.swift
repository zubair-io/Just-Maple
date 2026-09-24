import Foundation

extension KnowledgeStore {
    /// Answering a prompt and enqueueing its feedback are one durable operation.
    @discardableResult
    public func respond(to itemID: String, text: String) throws -> String {
        let response = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !response.isEmpty, response.utf8.count <= 32_000 else {
            throw MapleError.invalid("Enter a response shorter than 32 KB.")
        }
        return try db.transaction {
            guard let row = try db.rows("SELECT * FROM work_items WHERE id=?", [itemID]).first,
                  row["kind"] == "ask_user", let original = try event(row["event_id"]!) else {
                throw MapleError.invalid("This prompt could not be found.")
            }
            let source = Source(connector: "feedback", account: "local", externalID: itemID, revision: "1")
            let feedback = Event(type: "feedback.received", source: source, occurredAt: Date(),
                                 subjects: original.subjects,
                                 content: "User response to event \(original.id):\n\(response)")
            // insert performs payload collision checking, making repeated submission safe.
            let id = try insert(feedback, enqueue: true)
            try db.execute("UPDATE work_items SET status='answered' WHERE id=?", [itemID])
            return id
        }
    }
}
