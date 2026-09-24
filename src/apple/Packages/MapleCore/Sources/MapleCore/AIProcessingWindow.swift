import Foundation

public enum AIProcessingWindow {
    public static let duration:TimeInterval = 30 * 24 * 60 * 60
    public static func includes(_ date:Date,at:Date=Date())->Bool {date >= at.addingTimeInterval(-duration)}
    public static func require(_ event:Event,at:Date=Date())throws {
        guard includes(event.occurredAt,at:at) else {throw MapleError.invalid("This source is older than 30 days. It remains locally indexed, but is excluded from Jev and AI processing.")}
    }
    public static func filtered(_ context:Context,at:Date=Date())throws -> Context {
        try require(context.event,at:at)
        var world=context.world
        if var value=world {
        value.activities=value.activities.filter{includes($0.updatedAt,at:at)}
        value.tasks=value.tasks.filter{$0.waitingFollowUp==nil && includes($0.updatedAt,at:at)}
        value.states=value.states.compactMap { state in
            let candidates=state.candidates.filter{includes($0.observedAt,at:at)}
            guard !candidates.isEmpty,let property=StateProperty.catalog.first(where:{$0.key==state.property}) else {return nil}
            return StateResolver.resolve(subject:state.subject,property:property,claims:candidates,revision:state.revision,at:at)
        }
        world=value
        }
        return Context(event:context.event,currentState:context.currentState.filter{includes($0.observedAt,at:at)},recentEvents:context.recentEvents.filter{includes($0.occurredAt,at:at)},relatedEvidence:context.relatedEvidence.filter{includes($0.occurredAt,at:at)},version:context.version+"/30-day-window",sourceFacts:context.sourceFacts?.filter{ $0.sourceOccurredAt.map{includes($0,at:at)} ?? false },world:world)
    }
}

extension KnowledgeStore {
    /// Intentional local-only retention, not a provider failure or a fabricated decision.
    public func excludeExpiredAIWork(at:Date=Date())throws {
        let cutoff=String(at.addingTimeInterval(-AIProcessingWindow.duration).timeIntervalSince1970)
        for (table,token) in [("processing_jobs","lease_token"),("fact_jobs","lease_token"),("task_extraction_jobs","lease_token"),("state_jobs","token")] {
            try db.execute("UPDATE \(table) SET status='outside_window',\(token)=NULL,lease_until=NULL,error=NULL WHERE status NOT IN ('succeeded','done','superseded','outside_window') AND event_id IN (SELECT id FROM events WHERE occurred_at<?)",[cutoff])
        }
    }
    public func modelContext(for id:String,at:Date=Date())throws->Context {
        let raw=try context(for:id)
        var context=try AIProcessingWindow.filtered(raw,at:at)
        func recentEvidence(_ ids:[String])throws->Bool {
            try ids.allSatisfy { id in guard let source=try event(id) else {return false};return AIProcessingWindow.includes(source.occurredAt,at:at) }
        }
        let claims=try context.currentState.filter{try recentEvidence([$0.evidenceEventID])}
        if var world=context.world {
            world.tasks=try world.tasks.filter{try recentEvidence($0.evidenceIDs)}
            world.states=try world.states.filter { state in try state.candidates.allSatisfy{try recentEvidence($0.evidenceIDs)} }
            context.world=world
        }
        return Context(event:context.event,currentState:claims,recentEvents:context.recentEvents,relatedEvidence:context.relatedEvidence,version:context.version,sourceFacts:context.sourceFacts,world:context.world)
    }
}
