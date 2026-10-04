import Foundation

/// Evidence declared by the provider adapter from its actual final input. This
/// never dates a claim from observedAt or guesses provenance from source text.
struct ProviderDispatchEvidence:Sendable {
    private(set) var evidence:[ProviderInputEvidence]
    private(set) var coverage:ProviderEvidenceCoverage

    init(event:Event) {
        self.init(context:Context(event:event,currentState:[],recentEvents:[],relatedEvidence:[],version:"event-only"))
    }
    init(context:Context,includeWorld:Bool=true,includeSourceFacts:Bool=true,additionalActivities:[LifeActivity]=[]) {
        var entries=[ProviderInputEvidence](),partial = !additionalActivities.isEmpty
        func source(_ id:String,_ occurredAt:Date?=nil) {
            guard !id.isEmpty else {partial=true;return}
            entries.append(ProviderInputEvidence(eventID:id,occurredAt:occurredAt))
        }
        for event in [context.event]+context.recentEvents+context.relatedEvidence {source(event.id,event.occurredAt)}
        if includeSourceFacts {for fact in context.sourceFacts ?? [] {source(fact.eventID,fact.sourceOccurredAt)}}
        for claim in context.currentState {source(claim.evidenceEventID)}
        if includeWorld,let world=context.world {
            // Activity summaries have no source identities in this DTO. Their
            // presence cannot be certified as complete source lineage.
            partial = partial || !world.activities.isEmpty
            for task in world.tasks {
                partial = partial || task.evidenceIDs.isEmpty
                for id in task.evidenceIDs {source(id)}
            }
            for state in world.states {
                partial = partial || state.candidates.isEmpty
                for claim in state.candidates {
                    partial = partial || claim.evidenceIDs.isEmpty
                    for id in claim.evidenceIDs {source(id)}
                }
            }
        }
        self.init(entries:entries,coverage:partial ? .partial:.complete)
    }
    private init(entries:[ProviderInputEvidence],coverage:ProviderEvidenceCoverage) {
        var ids=Set<String>(),dates=[String:Date](),conflicts=Set<String>(),partial=coverage != .complete
        for entry in entries {
            ids.insert(entry.eventID)
            guard let date=entry.occurredAt else {continue}
            guard date.timeIntervalSince1970.isFinite else {conflicts.insert(entry.eventID);partial=true;continue}
            if let existing=dates[entry.eventID],existing != date {conflicts.insert(entry.eventID);partial=true}
            else {dates[entry.eventID]=date}
        }
        evidence=ids.sorted().map{ProviderInputEvidence(eventID:$0,occurredAt:conflicts.contains($0) ? nil:dates[$0])}
        self.coverage=partial ? .partial:.complete
    }
    func merging(_ other:Self)->Self {
        Self(entries:evidence+other.evidence,coverage:coverage == .complete && other.coverage == .complete ? .complete:.partial)
    }
    func capture(at:Date=Date())->ProviderDispatchCapture {
        ProviderDispatchCapture(attemptedAt:at,evidence:evidence,coverage:coverage)
    }
}
