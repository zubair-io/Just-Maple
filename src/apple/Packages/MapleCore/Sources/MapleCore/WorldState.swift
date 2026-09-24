import Foundation

public enum StateResolver {
    public static func resolve(subject:String, property:StateProperty, claims:[WorldStateClaim], revision:Int64, at:Date) -> StateProjection {
        let related = claims.filter { $0.subject==subject && $0.property==property.key && !$0.retracted && $0.sourceAvailable }
        let superseded = Set(related.filter{$0.validFrom<=at && ($0.validUntil == nil || $0.validUntil!>at)}.compactMap(\.supersedes))
        let eligible = related.filter { c in
            !superseded.contains(c.id) && c.validFrom<=at && (c.validUntil == nil || c.validUntil!>at) &&
            (c.origin=="user-confirmed" || property.ttl == nil || c.observedAt.addingTimeInterval(property.ttl!)>at)
        }
        var selected = eligible.filter{$0.origin=="user-confirmed"}.sorted { ($0.validFrom,$0.ingestedAt,$0.id)>($1.validFrom,$1.ingestedAt,$1.id) }
        var reason = "A valid user correction takes precedence for its effective period."
        if selected.isEmpty {
            let observed=eligible.filter{$0.origin=="observed"}
            // Newer effective observations supersede older readings of the same source.
            // Simultaneous contradictions and independent sources remain visible conflicts.
            let groups=Dictionary(grouping:observed,by:{$0.sourceKey ?? $0.id})
            let observations=groups.values.flatMap { group in
                let latest=group.map(\.observedAt).max()!
                return group.filter{$0.observedAt==latest}
            }
            let inferences=Dictionary(grouping:eligible.filter{$0.origin=="inferred"},by:{$0.sourceKey ?? $0.id}).values.flatMap { group in
                let latest=group.map(\.observedAt).max()!
                return group.filter{$0.observedAt==latest}
            }
            selected = observations.isEmpty ? inferences : observations
            reason = observations.isEmpty ? "Inferred from eligible evidence; not independently confirmed." : "Direct observations within this property's validity and freshness window."
        } else { selected=Array(selected.prefix(1)) }
        if selected.isEmpty {
            return StateProjection(subject:subject,property:property.key,status:related.isEmpty ? "unknown":"stale",value:nil,candidates:related.sorted{$0.observedAt>$1.observedAt},reason:related.isEmpty ? "No eligible evidence. Unknown is a valid state." : "The last evidence is no longer current. It is retained for inspection, not used as current state.",revision:revision,asOf:at)
        }
        let values=Set(selected.map{$0.value.lowercased()})
        let conflicts = values.count>1
        return StateProjection(subject:subject,property:property.key,status:conflicts ? "conflicting":"known",value:conflicts ? nil:selected[0].value,candidates:selected,reason:conflicts ? "Credible current claims disagree. Review their evidence rather than assuming one is true.":reason,revision:revision,asOf:at)
    }
}

extension KnowledgeStore {
    public func stateClaims() throws -> [WorldStateClaim] {
        var values = try records("world_states",as:WorldStateClaim.self)
        for old in try state() where old.predicate == "person.relationship" {
            var c = WorldStateClaim(); c.id = "legacy:"+old.id; c.subject=old.subject; c.property="relationship"; c.value=old.value
            c.origin=old.origin=="user" ? "user-confirmed":"inferred"; c.confidence=old.origin=="user" ? nil:old.confidence
            c.observedAt=old.observedAt;c.ingestedAt=old.observedAt;c.validFrom=old.observedAt;c.evidenceIDs=[old.evidenceEventID]
            values.append(c)
        }
        return values
    }
    public func correctWorldState(_ input:WorldStateClaim, expectedRevision:Int64, requestID:String, at:Date = Date()) throws -> WorldStateClaim {
        try command(requestID,payload:JSONCodec.string(["state":JSONCodec.string(input),"revision":String(expectedRevision)])) {
            guard try worldRevision()==expectedRevision else { throw MapleError.invalid("Your world changed while editing. Your correction is preserved; review the latest state before saving.") }
            var claim=input;claim.origin="user-confirmed";claim.confidence=nil;claim.observedAt=at;claim.ingestedAt=at;claim.version=1;claim.sourceAvailable=true;claim.retracted=false
            try validateWorldState(claim)
            let previous = try stateClaims().filter{$0.subject==claim.subject && $0.property==claim.property && $0.origin=="user-confirmed"}.max{$0.ingestedAt<$1.ingestedAt}
            // Explicit supersession applies to prior corrections; source observations remain intact.
            claim.supersedes=previous?.id
            try db.execute("INSERT INTO world_states VALUES (?,?,?,?)",[claim.id,claim.subject,claim.property,try JSONCodec.string(claim)])
            try history(subjects:[claim.subject],type:"state.corrected",before:previous,after:claim,command:requestID,at:at)
            return claim
        }
    }
    func validateWorldState(_ c:WorldStateClaim) throws {
        guard let property=StateProperty.catalog.first(where:{$0.key==c.property}),c.subject != "health",!c.subject.hasPrefix("health:") else { throw MapleError.invalid("This property is not enabled for state inference.") }
        guard c.subject=="person:self" || c.subject=="home:self" || c.subject.hasPrefix("person:") || (try? record("life_activities",id:c.subject,as:LifeActivity.self)) != nil else { throw MapleError.invalid("Unknown state subject.") }
        try validateText(c.id,max:256,required:true);try validateText(c.value,max:1024,required:true)
        guard c.validUntil == nil || c.validUntil!>c.validFrom else { throw MapleError.invalid("The correction must expire after it begins.") }
        guard property.durable || c.validUntil != nil else { throw MapleError.invalid("Temporary state requires a visible expiration time.") }
        guard ["observed","inferred","user-confirmed"].contains(c.origin), c.confidence == nil || (0...1).contains(c.confidence!) else { throw MapleError.invalid("Invalid state provenance.") }
        for id in c.evidenceIDs { guard try event(id) != nil else { throw MapleError.invalid("State evidence is unavailable.") } }
    }
    /// Connector adapters may only offer evidence-backed observations; no ungrounded projection writes.
    public func observeWorldState(_ input:WorldStateClaim, requestID:String, at:Date = Date()) throws -> WorldStateClaim {
        try command(requestID,payload:JSONCodec.string(input)) {
            guard input.origin != "user-confirmed", !input.evidenceIDs.isEmpty else { throw MapleError.invalid("Observations require source evidence and cannot impersonate corrections.") }
            try validateWorldState(input)
            var claim=input;claim.ingestedAt=at;claim.version=1
            if let evidence=try event(input.evidenceIDs[0]) {claim.sourceKey=try JSONCodec.string([evidence.source.connector,evidence.source.account,evidence.source.externalID])}
            try db.execute("INSERT INTO world_states VALUES (?,?,?,?)",[claim.id,claim.subject,claim.property,try JSONCodec.string(claim)])
            try history(subjects:[claim.subject],type:"state.observed",before:Optional<WorldStateClaim>.none,after:claim,command:requestID,at:at,actor:input.origin)
            return claim
        }
    }
    public func worldStates(at:Date = Date()) throws -> [StateProjection] {
        let claims=try stateClaims(), revision=try worldRevision()
        var subjects:[(String,StateProperty)]=StateProperty.catalog.filter{$0.lens != "Activities" && $0.lens != "People"}.map {($0.lens=="Home" ? "home:self":"person:self",$0)}
        let milestone=StateProperty.catalog.first{$0.key=="milestone"}!
        subjects += try activities().map {($0.id,milestone)}
        for claim in claims where claim.property=="relationship" { if !subjects.contains(where:{$0.0==claim.subject && $0.1.key==claim.property}) {subjects.append((claim.subject,StateProperty.catalog.first{$0.key==claim.property}!))} }
        return subjects.map { StateResolver.resolve(subject:$0.0,property:$0.1,claims:claims,revision:revision,at:at) }
    }
    public func acknowledgeAttention(id:String, until:Date?, requestID:String, at:Date = Date()) throws -> String {
        try command(requestID,payload:JSONCodec.string(["id":id,"until":until.map{String($0.timeIntervalSince1970)} ?? "ack"])) {
            let current=try attention(at:at)
            guard current.contains(where:{$0.id==id}) else { throw MapleError.invalid("This attention item has changed. Refresh to see its current reason.") }
            try db.execute("INSERT INTO attention_ack VALUES (?,?) ON CONFLICT(id) DO UPDATE SET until_at=excluded.until_at",[id,until.map{String($0.timeIntervalSince1970)}])
            try history(subjects:[current.first{$0.id==id}!.taskID],type:until == nil ? "attention.acknowledged":"attention.snoozed",before:Optional<String>.none,after:id,command:requestID,at:at)
            return id
        }
    }
    public func attention(at:Date = Date()) throws -> [TaskAttention] {
        let states=try worldStates(at:at)
        var items:[TaskAttention]=[]
        for task in try tasks() where !task.status.terminal && task.status != .waiting && task.actionState?.isDeferred(at:at) != true {
            var reasons:[String]=[],stateIDs:[String]=[];var category="upcoming",rank=4,explanation=""
            let due=try task.due?.boundary(endOfDay:true), scheduled=try task.scheduled?.boundary()
            let when=[due,scheduled].compactMap{$0}.min()
            if let due, due<at {reasons.append("overdue");rank=0;category="relevant_now";explanation="This responsibility is overdue."}
            else if let when,when.timeIntervalSince(at)<=86400 {reasons.append("due_soon");rank=1;category="relevant_now";explanation="This task is due or scheduled within the next day."}
            if task.priority==3 {reasons.append("user_priority");rank=0;category="relevant_now";explanation="You marked this task as a high priority."}
            if rank<=1 {
                for condition in task.conditions {
                    let state=states.first{$0.subject==condition.subject && $0.property==condition.property}
                    stateIDs += state?.candidates.map(\.id) ?? []
                    if state?.status=="known",state?.value?.lowercased() != condition.value.lowercased() {
                        reasons.append("state_conflict");category="context_mismatch";explanation="This task needs \(condition.value), but current \(condition.property) is \(state?.value ?? "unknown"). Confirm who is covering it or adjust the task. Its due time is unchanged."
                    } else if state?.status != "known" {
                        reasons.append(state?.status=="conflicting" ? "state_conflict":"source_stale");if category != "context_mismatch" {category="uncertain";explanation="The due responsibility remains visible; its required context is unknown or stale."}
                    }
                }
                if task.assignee.isEmpty {reasons.append("assignee_missing")}
                if task.status == .waiting {reasons.append("waiting_response")}
            }
            guard !reasons.isEmpty else {continue}
            // A changed task, reason or evidence creates a new presentation, never a new task.
            let signature=[task.id,String(task.version)]+reasons.sorted()+stateIDs.sorted()
            let id=signature.joined(separator:"|")
            if let ack=try db.rows("SELECT until_at FROM attention_ack WHERE id=?",[id]).first,
               ack["until_at"] == nil || Double(ack["until_at"]!)!>at.timeIntervalSince1970 {continue}
            items.append(TaskAttention(id:id,taskID:task.id,taskVersion:task.version,category:category,reasonCodes:reasons,explanation:explanation,rank:rank,relevantAt:when,stateIDs:stateIDs))
        }
        return items.sorted { ($0.rank,$0.relevantAt ?? .distantFuture,$0.id)<($1.rank,$1.relevantAt ?? .distantFuture,$1.id) }
    }
    public func worldSnapshot(at:Date = Date()) throws -> WorldSnapshot {
        WorldSnapshot(revision:try worldRevision(),asOf:at,activities:try activities(),tasks:try tasks(),states:try worldStates(at:at),suggestions:try records("task_suggestions",as:TaskSuggestion.self),series:try records("task_series",as:TaskSeries.self),attention:try attention(at:at),history:try worldHistory(),taskRelations:try taskRelations(),taskProgress:try records("task_progress_evidence",as:TaskProgressEvidence.self),reconciliationFailures:Int(try db.rows("SELECT count(*) AS n FROM task_reconciliation_jobs WHERE status='failed'").first?["n"] ?? "0") ?? 0,activityEvidence:try records("activity_link_evidence",as:ActivityLinkEvidence.self),discoveryFailures:Int(try db.rows("SELECT count(*) AS n FROM activity_discovery_jobs WHERE status='failed'").first?["n"] ?? "0") ?? 0)
    }
}
