import Foundation

extension KnowledgeStore {
    /// Exactly the state/fact slices compared at commit, without rebuilding lexical,
    /// semantic or world retrieval. Prefix selection precedes age/provenance filtering
    /// to match context(for:) followed by modelContext's 30-day policy.
    func classificationValidationSnapshot(for id: String, at: Date) throws -> (currentState: [Claim], sourceFacts: [SourceFact]) {
        guard let event = try event(id) else { throw MapleError.invalid("Unknown observation.") }
        try AIProcessingWindow.require(event, at: at)
        let claims = try state(subjects: event.subjects).prefix(24).filter { claim in
            guard AIProcessingWindow.includes(claim.observedAt, at: at),
                  let source = try self.event(claim.evidenceEventID) else { return false }
            return AIProcessingWindow.includes(source.occurredAt, at: at)
        }
        let facts = try sourceFacts(subjects: event.subjects, limit: 12).compactMap { fact -> SourceFact? in
            guard let source = try self.event(fact.eventID), AIProcessingWindow.includes(source.occurredAt, at: at) else { return nil }
            var dated = fact
            dated.sourceOccurredAt = source.occurredAt
            return dated
        }
        return (Array(claims), facts)
    }
}
