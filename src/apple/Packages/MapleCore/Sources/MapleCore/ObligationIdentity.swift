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
    func obligationIsProtected(_ suggestion: TaskSuggestion) throws -> Bool {
        if suggestion.reviewStatus == "rejected" || suggestion.candidate.status.terminal { return true }
        if let accepted = suggestion.acceptedTaskID,
           try taskNode("task:" + accepted)?.status.terminal == true { return true }
        let root = reconciliationRoot("source:" + suggestion.id, relations: try taskRelations())
        if root != "source:" + suggestion.id {
            if try taskNode(root)?.status.terminal == true { return true }
            if root.hasPrefix("source:"),
               try record("task_suggestions", id: String(root.dropFirst(7)), as: TaskSuggestion.self)?.reviewStatus == "rejected" { return true }
        }
        return false
    }

    /// Runs inside the extraction transaction. Repeated evidence does not change
    /// status, corrections, or request identity. Failed batches roll this back too.
    func preserveResolvedObligation(_ incoming: TaskSuggestion, event: Event, at: Date) throws -> TaskSuggestion? {
        guard let identity = incoming.obligationIdentity else { return nil }
        for var existing in try records("task_suggestions", as: TaskSuggestion.self) {
            guard try obligationIsProtected(existing), let original = try self.event(existing.eventID) else { continue }
            // Lazy compatibility for old rows; never reinterpret them using incoming fields.
            let oldIdentity = existing.obligationIdentity ?? ObligationIdentity(event: original, suggestion: existing)
            guard oldIdentity == identity else { continue }
            let old = existing
            existing.obligationIdentity = oldIdentity
            let evidence = Set(existing.candidate.evidenceIDs + [existing.eventID])
            if !evidence.contains(event.id) {
                existing.candidate.evidenceIDs = Array(evidence.union([event.id])).sorted()
                existing.version += 1
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
