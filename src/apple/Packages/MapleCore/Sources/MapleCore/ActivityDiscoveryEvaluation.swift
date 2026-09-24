import Foundation
public enum ActivityDiscoveryEvaluation {
    public static func run(client:ACPClient)async throws->[String:String] {
        // Synthetic fixtures only. No user database or seeded activity names are used.
        let store=try KnowledgeStore(path:":memory:")
        let quotes=[
            "For the kitchen water damage repair, please approve the plumber's estimate before we book the crew.",
            "The kitchen water damage repair needs your choice of replacement cabinet finish before ordering.",
            "To finish enrollment in your evening Spanish course, submit the placement assessment.",
            "For your evening Spanish course enrollment, choose a weekly class time from the available sections.",
            "Your bicycle repair at Northstar is ready. Please arrange pickup.",
            "Northstar software support needs the application crash log to diagnose the export failure."
        ]
        var ids:[String]=[]
        for (index,quote) in quotes.enumerated() {
            let event=Event(type:"message.received",source:Source(connector:"gmail",account:"synthetic-evaluation",externalID:String(index),revision:"1"),occurredAt:Date(),subjects:["person:self"],content:quote)
            try await store.ingest(event)
            var suggestion=TaskSuggestion();suggestion.eventID=event.id;suggestion.provider="synthetic-fixture";suggestion.quote=quote;suggestion.candidate.title=quote
            ids.append(try await store.offerTask(suggestion).id)
        }
        var observations:[String]=[]
        for (index,item) in [
            ("notes","I am rehearsing violin with the community orchestra each week for our winter concert. We are working on the second movement."),
            ("apple_calendar","Community orchestra weekly rehearsal for the winter concert. String section rehearsal in the music room."),
            ("notes","Cedar sent a receipt for the replacement kettle. This purchase is finished."),
            ("imessage","Cedar park has a new entrance sign. Just sharing a photo from today's walk.")
        ].enumerated() {
            let event=Event(type:"observation.updated",source:Source(connector:item.0,account:"synthetic-evaluation",externalID:"observation-"+String(index),revision:"1"),occurredAt:Date(),subjects:["person:self"],content:item.1)
            try await store.ingest(event);observations.append(event.id)
        }
        try await ActivityDiscoveryEngine(store:store,client:client).runOne()
        let snapshot=try await store.worldSnapshot()
        func groups(_ i:Int)->Set<String> {Set(snapshot.suggestions.first{$0.id==ids[i]}?.candidate.activityIDs ?? [])}
        let repairs = !groups(0).intersection(groups(1)).isEmpty
        let learning = !groups(2).intersection(groups(3)).isEmpty
        let separated = groups(0).intersection(groups(2)).isEmpty
        let entityNegative = groups(4).intersection(groups(5)).isEmpty
        func observationGroups(_ i:Int)->Set<String> {Set(snapshot.activityEvidence.filter{$0.eventID==observations[i]}.map(\.activityID))}
        let withoutTasks = !observationGroups(0).intersection(observationGroups(1)).isEmpty
        let observationNegative = observationGroups(2).intersection(observationGroups(3)).isEmpty
        let noInventedTasks = snapshot.suggestions.count==quotes.count && snapshot.tasks.isEmpty
        return ["observationGrouping":String(withoutTasks),"observationSameNameNegative":String(observationNegative),"noInventedTasks":String(noInventedTasks),"mode":"live provider; synthetic held-out scenarios","repairGrouping":String(repairs),"courseGrouping":String(learning),"separatePurposes":String(separated),"sameNameNegative":String(entityNegative),"passed":String(repairs && learning && separated && entityNegative && withoutTasks && observationNegative && noInventedTasks),"discoveredNames":snapshot.activities.map(\.name).joined(separator:"; ")]
    }
}
