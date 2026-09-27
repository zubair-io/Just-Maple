import Foundation

/// A bounded first-pass view. Retrieval relevance is based on explicit source/thread
/// relationships, never names, title similarity, or the shared `person:self` subject.
public enum MessageScreeningContext {
    public static func filtered(_ input: Context, at: Date = Date(), maximumBytes: Int = 24_576) throws -> Context {
        let context = try AIProcessingWindow.filtered(input, at: at)
        let threads = Set(context.event.subjects.filter {
            $0.hasPrefix("thread:gmail:") || $0.hasPrefix("thread:imessage:")
        })
        func sameThread(_ event: Event) -> Bool {
            event.source.connector == context.event.source.connector &&
            event.source.account == context.event.source.account &&
            event.occurredAt <= context.event.occurredAt &&
            !threads.isDisjoint(with: event.subjects)
        }
        var observations: [String: Event] = [context.event.id: context.event]
        for event in context.recentEvents + context.relatedEvidence { observations[event.id] = event }
        let threadIDs = Set(observations.values.filter(sameThread).map(\.id)).union([context.event.id])
        // Preserve correction/fact arrays exactly: the commit guard compares these
        // snapshots against current storage before applying an in-flight decision.
        let provenanceIDs = Set(context.currentState.map(\.evidenceEventID) + (context.sourceFacts ?? []).map(\.eventID))
        var seen = Set<String>()
        let recent = context.recentEvents.filter { sameThread($0) && $0.id != context.event.id && seen.insert($0.id).inserted }
        seen = []
        let evidence = context.relatedEvidence.filter {
            $0.id != context.event.id && (sameThread($0) || provenanceIDs.contains($0.id)) && seen.insert($0.id).inserted
        }
        var world = context.world
        if var value = world {
            value.tasks = value.tasks.filter { task in
                !threadIDs.isDisjoint(with: task.evidenceIDs) &&
                // A Context-only projection cannot date an absent source. Omit
                // such derived text rather than accidentally send old evidence.
                task.evidenceIDs.allSatisfy { observations[$0] != nil }
            }
            let activityIDs = Set(value.tasks.flatMap(\.activityIDs))
            value.activities = value.activities.filter { activityIDs.contains($0.id) }
            // Explicit user truth lives in currentState; unrelated inferred
            // personal/home world state does not belong in this first pass.
            value.states = []
            world = value
        }
        let result = Context(event: context.event, currentState: context.currentState,
                             recentEvents: recent, relatedEvidence: evidence,
                             version: "message-screening-v1", sourceFacts: context.sourceFacts, world: world)
        guard maximumBytes > 0, try JSONCodec.encode(result).count <= maximumBytes else {
            throw MapleError.invalid("Message screening context exceeds the size limit; review remains queued.")
        }
        return result
    }
}
