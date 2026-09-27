import Foundation

extension KnowledgeStore {
    /// Replies are resolution context, never substitute evidence for a new source obligation.
    func freshTaskReviewContext(_ source: Event, at: Date) throws -> Context {
        try AIProcessingWindow.require(source, at: at)
        guard source.occurredAt <= at, source.receivedAt <= at else { throw MapleError.invalid("This message is not yet available at the review time.") }
        let threads = source.subjects.filter { $0.hasPrefix("thread:\(source.source.connector):") }
        let marks = Array(repeating:"?",count:threads.count).joined(separator:",")
        let cutoff = at.addingTimeInterval(-AIProcessingWindow.duration)
        func eligible(_ event: Event) -> Bool {
            event.occurredAt >= cutoff && event.occurredAt <= at && event.receivedAt <= at
        }
        func sameConversation(_ event: Event) -> Bool {
            event.source.connector == source.source.connector && event.source.account == source.source.account &&
            (event.id == source.id || !Set(event.subjects).isDisjoint(with:threads))
        }
        let replies: [Event]
        if threads.isEmpty { replies = [] } else {
            replies = try db.rows("""
                SELECT e.json FROM events e
                WHERE e.connector=? AND e.account=? AND e.id<>? AND e.occurred_at>=? AND e.occurred_at<=? AND e.received_at<=?
                AND EXISTS (SELECT 1 FROM event_subjects s WHERE s.event_id=e.id AND s.subject IN (\(marks)))
                AND NOT EXISTS (SELECT 1 FROM events n WHERE n.connector=e.connector AND n.account=e.account AND n.external_id=e.external_id
                    AND n.occurred_at<=? AND n.received_at<=? AND (n.received_at>e.received_at OR (n.received_at=e.received_at AND n.rowid>e.rowid)))
                ORDER BY e.occurred_at DESC,e.id LIMIT 12
                """, [source.source.connector,source.source.account,source.id,String(cutoff.timeIntervalSince1970),String(at.timeIntervalSince1970),String(at.timeIntervalSince1970)] + threads + [String(at.timeIntervalSince1970),String(at.timeIntervalSince1970)])
                .map { try JSONCodec.decode(Event.self,from:Data($0["json"]!.utf8)) }
        }
        func validEvidence(_ ids:[String]) throws -> Bool {
            try !ids.isEmpty && ids.allSatisfy { id in guard let event = try self.event(id) else {return false};return eligible(event) }
        }
        func relevantTask(_ task:LifeTask) throws -> Bool {
            guard task.waitingFollowUp == nil, task.updatedAt >= cutoff, task.updatedAt <= at,
                  try validEvidence(task.evidenceIDs) else {return false}
            return try task.evidenceIDs.contains { id in try self.event(id).map(sameConversation) ?? false }
        }
        var tasks = try self.tasks().filter(relevantTask)
        let relations = try taskRelations()
        let suggestions = try records("task_suggestions",as:TaskSuggestion.self)
        var protectedNodes = Set(try db.rows("SELECT id FROM task_inference_corrections").compactMap { $0["id"] }.flatMap { $0.components(separatedBy:"|") })
        protectedNodes.formUnion(try db.rows("SELECT node_id FROM task_action_mutations").compactMap { $0["node_id"] })
        protectedNodes.formUnion(try self.tasks().map { "task:" + $0.id })
        for item in suggestions where item.reviewStatus != "pending" || item.acceptedTaskID != nil || item.linkedTaskID != nil || item.candidate.status.terminal || item.candidate.actionState != nil || item.provider.isEmpty || item.provider == "user" {
            protectedNodes.insert("source:" + item.id)
        }
        var propagated = true
        while propagated {
            propagated = false
            for relation in relations where protectedNodes.contains(relation.duplicateID) || protectedNodes.contains(relation.primaryID) {
                if protectedNodes.insert(relation.duplicateID).inserted { propagated = true }
                if protectedNodes.insert(relation.primaryID).inserted { propagated = true }
            }
        }
        for suggestion in suggestions where ["pending","rejected"].contains(suggestion.reviewStatus) && suggestion.acceptedTaskID == nil && suggestion.linkedTaskID == nil {
            let nodeID = "source:" + suggestion.id
            guard reconciliationRoot(nodeID,relations:relations) == nodeID,
                  let evidence = try event(suggestion.eventID), eligible(evidence),sameConversation(evidence),suggestion.createdAt <= at else {continue}
            // A machine proposal from this very source is the object being reconsidered,
            // not independent proof that the user's obligation is already represented.
            if suggestion.eventID == source.id, !protectedNodes.contains(nodeID) {
                let userHistory = try db.rows("SELECT 1 FROM world_history h WHERE json_extract(h.json,'$.actor')='user' AND EXISTS (SELECT 1 FROM json_each(h.json,'$.subjects') s WHERE s.value IN (?,?)) LIMIT 1",[suggestion.id,nodeID])
                if userHistory.isEmpty { continue }
            }
            var task = suggestion.candidate
            task.id = nodeID;task.evidenceIDs = [evidence.id]
            // Review status timestamps live in immutable history, not candidate.createdAt.
            let last = try db.rows("SELECT h.json FROM world_history h WHERE EXISTS (SELECT 1 FROM json_each(h.json,'$.subjects') s WHERE s.value=?) ORDER BY sequence DESC LIMIT 1",[suggestion.id]).first
            let changedAt = try last.map { try JSONCodec.decode(WorldHistory.self,from:Data($0["json"]!.utf8)).recordedAt } ?? suggestion.createdAt
            task.updatedAt = max(task.updatedAt,changedAt)
            if suggestion.reviewStatus == "rejected" {task.status = .cancelled}
            if try relevantTask(task) { tasks.append(task) }
        }
        tasks.sort { a,b in a.status.terminal != b.status.terminal ? a.status.terminal : a.updatedAt == b.updatedAt ? a.id < b.id : a.updatedAt > b.updatedAt }
        let validation = try classificationValidationSnapshot(for:source.id,at:at)
        let claims = try validation.currentState.filter { try $0.observedAt <= at && (event($0.evidenceEventID).map(eligible) ?? false) }
        let facts = try validation.sourceFacts.filter { try event($0.eventID).map(eligible) ?? false }
        let states = try worldStates(at:at).filter { state in
            try !state.candidates.isEmpty && (source.subjects.contains(state.subject) || ["person:self","home:self"].contains(state.subject)) &&
            (state.candidates.allSatisfy { try $0.observedAt <= at && $0.observedAt >= cutoff && validEvidence($0.evidenceIDs) })
        }
        func excerpt(_ event:Event,_ limit:Int)->Event {
            Event(id:event.id,type:event.type,source:event.source,occurredAt:event.occurredAt,receivedAt:event.receivedAt,subjects:event.subjects,content:Self.utf8Excerpt(event.content,limit:limit))
        }
        return Context(event:excerpt(source,12_000),currentState:claims,recentEvents:replies.map {excerpt($0,1_500)},relatedEvidence:[],version:"task-review-v1/30-day-window",sourceFacts:facts,
                       world:ReasoningWorldContext(asOf:at,activities:Array(try activities().filter {$0.lifecycle == .active && $0.updatedAt >= cutoff && $0.updatedAt <= at}.prefix(30)),tasks:Array(tasks.prefix(20)),states:states))
    }
}
