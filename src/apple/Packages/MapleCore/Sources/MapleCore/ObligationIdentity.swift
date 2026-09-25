import Foundation
import CryptoKit

/// Conservative storage identity, not a semantic equivalence judgment. Version one
/// deliberately requires the same source occurrence, action wording and evidence.
/// Different wording remains eligible for the evidence-backed reconciliation path.
public struct ObligationIdentity: Codable, Sendable, Equatable {
    public let version: Int
    public let connector: String
    public let account: String
    public let occurrenceID: String
    public let threadIDs: [String]
    public let responsibleActor: String
    public let actionAndTarget: String
    public let actionEvidence: String
    public let digest: String

    init(event: Event, suggestion: TaskSuggestion) {
        version = 1
        connector = event.source.connector
        account = event.source.account
        occurrenceID = event.source.externalID
        threadIDs = event.subjects.filter { $0.hasPrefix("thread:") }.sorted()
        responsibleActor = suggestion.actorID ?? "unspecified:" + (suggestion.obligation ?? "unspecified")
        actionAndTarget = Self.normalize(suggestion.candidate.title)
        actionEvidence = Self.normalize(suggestion.quote)
        // Encode unambiguously and retain all fields for inspection. Revision and
        // extraction IDs are excluded; a distinct source occurrence is never merged.
        let fields = [String(version), connector, account, occurrenceID,
                      responsibleActor, actionAndTarget, actionEvidence] + threadIDs
        let bytes = Data(fields.map { String($0.utf8.count) + ":" + $0 }.joined().utf8)
        digest = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }

    private static func normalize(_ text: String) -> String {
        text.precomposedStringWithCanonicalMapping
            .split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }
}

extension KnowledgeStore {
    func suggestionsForSource(_ source: Source) throws -> [TaskSuggestion] {
        let events = try db.rows("SELECT id FROM events WHERE connector=? AND account=? AND external_id=? ORDER BY rowid",[source.connector,source.account,source.externalID])
        return try events.flatMap { event in
            try db.rows("SELECT json FROM task_suggestions WHERE json_extract(json, '$.eventID')=? ORDER BY rowid",[event["id"]!]).map { try JSONCodec.decode(TaskSuggestion.self,from:Data($0["json"]!.utf8)) }
        }
    }

    func obligationRoot(_ suggestion: TaskSuggestion, relations: [TaskRelation]) -> String {
        if let task = suggestion.acceptedTaskID { return "task:" + task }
        return reconciliationRoot("source:" + suggestion.id, relations: relations)
    }

    func obligationIsProtected(_ suggestion: TaskSuggestion, relations: [TaskRelation]) throws -> Bool {
        let canonical = obligationRoot(suggestion, relations: relations)
        let rawCanonical = String(canonical.dropFirst(canonical.hasPrefix("task:") ? 5 : 7))
        if try db.rows("SELECT subject FROM task_user_history_subjects WHERE subject IN (?,?,?,?) LIMIT 1",
                       [suggestion.id, "source:" + suggestion.id, canonical, rawCanonical]).first != nil { return true }
        if try db.rows("SELECT id FROM task_inference_corrections WHERE id=? AND kind='status'",["source:" + suggestion.id]).first != nil { return true }
        if suggestion.reviewStatus == "rejected" || suggestion.candidate.status.terminal || suggestion.candidate.actionState != nil { return true }
        if let accepted = suggestion.acceptedTaskID,
           try taskNode("task:" + accepted).map({ $0.status.terminal || $0.actionState != nil }) == true { return true }
        let root = obligationRoot(suggestion, relations: relations)
        if root != "source:" + suggestion.id {
            if try db.rows("SELECT id FROM task_inference_corrections WHERE id=? AND kind='status'",[root]).first != nil { return true }
            if try taskNode(root).map({ $0.status.terminal || $0.actionState != nil }) == true { return true }
            if root.hasPrefix("source:"),
               try record("task_suggestions", id: String(root.dropFirst(7)), as: TaskSuggestion.self)?.reviewStatus == "rejected" { return true }
        }
        return false
    }

    /// Runs inside the extraction transaction. Repeated evidence does not change
    /// status, corrections, or request identity. Failed batches roll this back too.
    func preserveResolvedObligation(_ incoming: TaskSuggestion, event: Event, at: Date) throws -> TaskSuggestion? {
        guard let identity = incoming.obligationIdentity else { return nil }
        let candidates = try suggestionsForSource(event.source)
        guard !candidates.isEmpty else { return nil }
        let relations = try taskRelations()
        for var existing in candidates {
            guard try obligationIsProtected(existing, relations: relations), let original = try self.event(existing.eventID) else { continue }
            // Lazy compatibility for old rows; never reinterpret them using incoming fields.
            let oldIdentity = existing.obligationIdentity ?? ObligationIdentity(event: original, suggestion: existing)
            guard oldIdentity == identity else { continue }
            let old = existing
            existing.obligationIdentity = oldIdentity
            let evidence = Set(existing.candidate.evidenceIDs + [existing.eventID])
            if !evidence.contains(event.id) {
                existing.candidate.evidenceIDs = Array(evidence.union([event.id])).sorted()
                existing.version += 1
                let root = obligationRoot(existing, relations: relations)
                if root != "source:" + existing.id, var task = try taskNode(root), !task.evidenceIDs.contains(event.id) {
                    let before = task
                    task.evidenceIDs = Array(Set(task.evidenceIDs + [event.id])).sorted()
                    task.updatedAt = at
                    if root.hasPrefix("task:") {
                        task.version += 1
                        try writeTask(task,at:at)
                    } else if var primary = try record("task_suggestions",id:String(root.dropFirst(7)),as:TaskSuggestion.self) {
                        primary.candidate = task; primary.version += 1
                        try db.execute("UPDATE task_suggestions SET json=? WHERE id=?",[try JSONCodec.string(primary),primary.id])
                    }
                    try history(subjects:[String(root.dropFirst(root.hasPrefix("task:") ? 5 : 7))],type:"obligation.evidence_retained",before:before,after:task,command:identity.digest + ":" + event.id,at:at,actor:incoming.provider)
                }
                try history(subjects: [existing.id], type: "obligation.evidence_retained",
                            before: old, after: existing, command: identity.digest + ":" + event.id,
                            at: at, actor: incoming.provider)
            }
            if existing.obligationIdentity != old.obligationIdentity || !evidence.contains(event.id) {
                try db.execute("UPDATE task_suggestions SET json=? WHERE id=?", [try JSONCodec.string(existing), existing.id])
            }
            return existing
        }
        return nil
    }
}
