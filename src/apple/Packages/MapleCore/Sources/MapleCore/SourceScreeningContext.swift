import Foundation

/// First-pass classification needs the source and its explicit relationships, not
/// the user's entire inferred world. Shared personal/home subjects are not links.
public enum SourceScreeningContext {
    public static func filtered(_ input: Context, at: Date = Date(), maximumBytes: Int = 24_576) throws -> Context {
        let context = try AIProcessingWindow.filtered(input, at: at)
        let scopes = Set(context.event.subjects.filter { !["person:self", "home:self"].contains($0) })
        func related(_ event: Event) -> Bool {
            guard event.occurredAt <= context.event.occurredAt else { return false }
            let sameSource = event.source.connector == context.event.source.connector &&
                event.source.account == context.event.source.account &&
                event.source.externalID == context.event.source.externalID
            return sameSource || !scopes.isDisjoint(with: event.subjects)
        }
        let provenanceIDs = Set(context.currentState.map(\.evidenceEventID) + (context.sourceFacts ?? []).map(\.eventID))
        var observations: [String: Event] = [context.event.id: context.event]
        for event in context.recentEvents + context.relatedEvidence { observations[event.id] = event }
        let scopeIDs = Set(observations.values.filter(related).map(\.id)).union([context.event.id])
        var seen: Set<String> = [context.event.id]
        let recent = context.recentEvents.filter {
            (related($0) || provenanceIDs.contains($0.id)) && seen.insert($0.id).inserted
        }
        // An observation already in recentEvents is not serialized a second time.
        let evidence = context.relatedEvidence.filter {
            (related($0) || provenanceIDs.contains($0.id)) && seen.insert($0.id).inserted
        }
        var world = context.world
        if var value = world {
            value.tasks = value.tasks.filter { task in
                !scopeIDs.isDisjoint(with: task.evidenceIDs) &&
                task.evidenceIDs.allSatisfy { observations[$0] != nil }
            }
            let activityIDs = Set(value.tasks.flatMap(\.activityIDs))
            value.activities = value.activities.filter { activityIDs.contains($0.id) }
            value.states = []
            world = value
        }
        // Preserve these age-filtered snapshots exactly for the decision commit
        // guard; never discard an explicit correction to meet a byte budget.
        let result = Context(event: context.event, currentState: context.currentState,
                             recentEvents: recent, relatedEvidence: evidence,
                             version: "source-screening-v1", sourceFacts: context.sourceFacts, world: world)
        guard maximumBytes > 0, try JSONCodec.encode(result).count <= maximumBytes else {
            throw MapleError.invalid("Source screening context exceeds the size limit; review remains queued.")
        }
        return result
    }
}
