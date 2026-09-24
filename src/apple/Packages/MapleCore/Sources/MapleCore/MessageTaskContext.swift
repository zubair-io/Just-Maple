import Foundation

extension TaskEvidenceRules {
    public static func messageHeader(_ event:Event,_ field:String)->String? {
        let header=event.source.connector == "imessage" ? event.content.components(separatedBy:"\n\n").first! : event.content.components(separatedBy:"\nBody:").first!
        return header.components(separatedBy:"\n").first{$0.hasPrefix(field+": ")}.map{String($0.dropFirst(field.count+2))}
    }
    public static func messageDirection(_ event:Event)->String? {
        let direction=messageHeader(event,"Direction")
        return ["incoming","outgoing"].contains(direction ?? "") ? direction : nil
    }
    /// Ownership is explicit provider output, checked against connector-authored speaker metadata.
    /// False means a tentative plan: preserve the source, never manufacture a task.
    public static func configureOwnership(_ suggestion:inout TaskSuggestion,obligation:String?,actorID:String?,event:Event)throws->Bool {
        guard event.source.connector=="imessage" else{return true}
        guard let direction=messageDirection(event),let obligation,let actorID,
              ["user_action","waiting_on_other","tentative_plan"].contains(obligation),
              actorID.hasPrefix("person:"),event.subjects.contains(actorID) else {
            throw MapleError.provider("Message task extraction needs supported speaker and obligation evidence.")
        }
        if obligation=="tentative_plan" {return false}
        suggestion.obligation=obligation;suggestion.actorID=actorID
        if obligation=="user_action" {
            guard actorID=="person:self" else {throw MapleError.provider("A user action must belong to the user.")}
            suggestion.candidate.status = .open;suggestion.candidate.assignee="You";suggestion.candidate.waitingReason=""
        } else {
            guard direction=="incoming",actorID != "person:self" else {throw MapleError.provider("A waiting commitment must belong to the incoming speaker.")}
            suggestion.candidate.status = .waiting
            suggestion.candidate.assignee=messageHeader(event,"Sender") ?? "Other person"
            suggestion.candidate.waitingReason=suggestion.quote
            suggestion.candidate.people=Array(Set(suggestion.candidate.people+[actorID])).sorted()
        }
        return true
    }
    /// Reuse the JEV decision context, filtered again at send time. Bound provider input without
    /// letting a huge world snapshot crowd out the source and its immediate conversation.
    public static func promptContext(_ input:Context,maxBytes:Int=24_000)throws->String {
        var context=try AIProcessingWindow.filtered(input)
        guard context.event.content.utf8.count<=12_000 else {throw MapleError.provider("Task source exceeds the supported context size.")}
        func encoded()throws->String {try JSONCodec.string(context)}
        while try encoded().utf8.count>maxBytes {
            if var world=context.world,!world.tasks.isEmpty {world.tasks.removeLast();context.world=world}
            else if var world=context.world,!world.states.isEmpty {world.states.removeLast();context.world=world}
            else if var world=context.world,!world.activities.isEmpty {world.activities.removeLast();context.world=world}
            else if !context.relatedEvidence.isEmpty {context=Context(event:context.event,currentState:context.currentState,recentEvents:context.recentEvents,relatedEvidence:Array(context.relatedEvidence.dropLast()),version:context.version,sourceFacts:context.sourceFacts,world:context.world)}
            else if !(context.sourceFacts ?? []).isEmpty {context=Context(event:context.event,currentState:context.currentState,recentEvents:context.recentEvents,relatedEvidence:[],version:context.version,sourceFacts:Array(context.sourceFacts!.dropLast()),world:context.world)}
            else if !context.currentState.isEmpty {context=Context(event:context.event,currentState:Array(context.currentState.dropLast()),recentEvents:context.recentEvents,relatedEvidence:[],version:context.version,sourceFacts:[],world:context.world)}
            else if !context.recentEvents.isEmpty {context=Context(event:context.event,currentState:[],recentEvents:Array(context.recentEvents.dropLast()),relatedEvidence:[],version:context.version,sourceFacts:[],world:context.world)}
            else {throw MapleError.provider("Task context exceeds the supported size.")}
        }
        return try encoded()
    }
}

extension KnowledgeStore {
    public func taskModelContext(for eventID:String,at:Date=Date())throws->Context {
        if let row=try db.rows("SELECT json FROM decisions WHERE event_id=?",[eventID]).first,let json=row["json"] {
            let decision=try JSONCodec.decode(Decision.self,from:Data(json.utf8))
            return try AIProcessingWindow.filtered(decision.context,at:at)
        }
        return try modelContext(for:eventID,at:at)
    }
}

extension KnowledgeStore {
    /// Upgrade already-classified recent messages without another JEV call. Jobs are unique by
    /// source event, so repeated startup/index ticks cannot duplicate extraction work.
    public func prepareIMessageTaskJobs(at:Date=Date())throws {
        try db.execute("""
            INSERT OR IGNORE INTO task_extraction_jobs(event_id)
            SELECT e.id FROM events e JOIN decisions d ON d.event_id=e.id
            LEFT JOIN task_extraction_jobs j ON j.event_id=e.id
            WHERE e.connector='imessage' AND e.occurred_at>=? AND j.event_id IS NULL
            AND (json_extract(d.json,'$.route')<>'retain'
                OR json_extract(d.json,'$.assessment.message.actionNeeded')>=0.85
                OR json_extract(d.json,'$.assessment.message.replyNeeded')>=0.85
                OR json_extract(d.json,'$.assessment.message.commitmentChanged')>=0.85)
            ORDER BY e.occurred_at DESC LIMIT 100
            """,[String(at.addingTimeInterval(-AIProcessingWindow.duration).timeIntervalSince1970)])
    }
}
