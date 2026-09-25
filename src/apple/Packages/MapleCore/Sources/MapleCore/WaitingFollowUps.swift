import Foundation
import CryptoKit

public struct WaitingFollowUp: Codable, Sendable, Equatable {
    public let parentNodeID: String
    public let triggerAt: Date
    public let reviewKey: String?
    public let lastAutomaticVersion: Int?
    public let automaticallyInvalidated: Bool?
    public let reason: String // review_due or deadline_reached
    public init(parentNodeID:String,triggerAt:Date,reviewKey:String?=nil,reason:String,lastAutomaticVersion:Int?=nil,automaticallyInvalidated:Bool?=nil) {
        self.parentNodeID=parentNodeID;self.triggerAt=triggerAt;self.reviewKey=reviewKey;self.reason=reason
        self.lastAutomaticVersion=lastAutomaticVersion;self.automaticallyInvalidated=automaticallyInvalidated
    }
}

extension SQLite {
    func migrateWaitingFollowUps() throws {
        try execute("CREATE TABLE IF NOT EXISTS waiting_followup_occurrences (parent_node TEXT NOT NULL, review_key TEXT NOT NULL, task_id TEXT NOT NULL, PRIMARY KEY(parent_node,review_key))")
    }
}

extension KnowledgeStore {
    /// One durable review per waiting occurrence. Only an explicitly different
    /// review time creates another occurrence; normal processing never nags again.
    @discardableResult
    public func materializeWaitingFollowUps(at:Date=Date()) throws -> Bool {
        try db.transaction { let before=try worldRevision();try materializeWaitingFollowUpsInTransaction(at:at);return try worldRevision() != before }
    }

    func materializeWaitingFollowUpsInTransaction(at:Date) throws {
        let suggestions=try records("task_suggestions",as:TaskSuggestion.self)
        let bySource=Dictionary(uniqueKeysWithValues:suggestions.map{("source:"+$0.id,$0)})
        let relations=try taskRelations()
        func root(_ id:String)->String {
            let mapped=bySource[id]?.acceptedTaskID.map{"task:"+$0} ?? id
            return reconciliationRoot(mapped,relations:relations)
        }
        var nodes=Dictionary(uniqueKeysWithValues:try tasks().filter{$0.waitingFollowUp==nil && root("task:"+$0.id)=="task:"+$0.id}.map{("task:"+$0.id,$0)})
        for source in suggestions where source.reviewStatus=="pending" && source.candidate.waitingFollowUp==nil {
            let id="source:"+source.id
            if root(id)==id {nodes[id]=source.candidate}
        }
        let invalidatedSuffix=" This review is no longer needed because the parent left Waiting, its review time changed, or it was combined with another reviewed obligation."
        let mappings=try db.rows("SELECT parent_node,review_key,task_id FROM waiting_followup_occurrences ORDER BY rowid")
        func occurrence(_ task:LifeTask)->String {task.actionState?.reviewAt.map{"review:"+String($0.timeIntervalSince1970)} ?? "initial"}
        func key(_ id:String,_ occurrence:String)->String {id+"|"+occurrence}
        var existing:[String:String]=[:]
        for row in mappings {
            let value=key(root(row["parent_node"]!),row["review_key"]!)
            existing[value] = existing[value] ?? row["task_id"]!
        }
        for (id,parent) in nodes.sorted(by:{$0.key<$1.key}) where parent.status == .waiting {
            let reviewKey=occurrence(parent),storageKey=key(id,occurrence(parent))
            if let known=existing[storageKey] {
                // Source acceptance must not manufacture a new review of the same occurrence.
                try db.execute("INSERT OR IGNORE INTO waiting_followup_occurrences VALUES (?,?,?)",[id,reviewKey,known])
                if var review=try record("life_tasks",id:known,as:LifeTask.self),let link=review.waitingFollowUp,
                   link.automaticallyInvalidated==true,review.version==link.lastAutomaticVersion,
                   review.status == .cancelled,review.actionState==nil,
                   try db.rows("SELECT id FROM task_inference_corrections WHERE id=? AND kind='status'",["task:"+known]).isEmpty {
                    let before=review;review.status = .open;review.version+=1;review.updatedAt=at
                    if review.description.hasSuffix(invalidatedSuffix) {review.description.removeLast(invalidatedSuffix.count)}
                    review.waitingFollowUp=WaitingFollowUp(parentNodeID:link.parentNodeID,triggerAt:link.triggerAt,reviewKey:link.reviewKey,reason:link.reason,lastAutomaticVersion:review.version,automaticallyInvalidated:false)
                    try writeTask(review,at:at)
                    try history(subjects:[review.id],type:"task.waiting_review_restored",before:before,after:review,command:review.id+":restored:"+String(review.version),at:at,actor:"waiting-review")
                }
                continue
            }
            let review=parent.actionState?.reviewAt
            let previouslyReviewed=mappings.contains{root($0["parent_node"]!)==id}
            // A new user-selected review time supersedes an already-reviewed overdue
            // deadline instead of immediately re-creating the old deadline alert.
            let deadline=try (previouslyReviewed && review != nil) ? nil:parent.due?.boundary(endOfDay:true)
            let triggers=[review.map{($0,"review_due")},deadline.map{($0,"deadline_reached")}].compactMap{$0}.filter{$0.0<=at}
            guard let trigger=triggers.sorted(by:{$0.0==$1.0 ? $0.1<$1.1:$0.0<$1.0}).first else {continue}
            var task=LifeTask()
            task.id="waiting-followup:"+SHA256.hash(data:Data(storageKey.utf8)).map{String(format:"%02x",$0)}.joined()
            let actor=parent.actionState?.waitingOn?.trimmingCharacters(in:.whitespacesAndNewlines)
            let title=actor.flatMap{$0.isEmpty ? nil:"Follow up with \($0) about \(parent.title)"} ?? "Review waiting status: \(parent.title)"
            // Task titles are bounded without changing the parent's original wording/evidence.
            task.title=title
            while task.title.utf8.count>512 {task.title.removeLast()}
            task.description=trigger.1=="review_due" ? "Your waiting review time has arrived. Check whether the blocker has cleared and decide whether to follow up. The original obligation remains waiting." : "The original obligation's deadline has arrived while it is still waiting. Review its status and decide whether to follow up. No completion is assumed."
            task.activityIDs=parent.activityIDs;task.people=parent.people
            task.evidenceIDs=Array(Set(parent.evidenceIDs).sorted().prefix(50))
            task.waitingFollowUp=WaitingFollowUp(parentNodeID:id,triggerAt:trigger.0,reviewKey:reviewKey,reason:trigger.1,lastAutomaticVersion:1,automaticallyInvalidated:false)
            var scheduled=DueSpec();scheduled.kind = .instant;scheduled.instant=trigger.0;scheduled.timeZone="UTC"
            task.scheduled=scheduled;task.version=1;task.createdAt=at;task.updatedAt=at
            try validateTask(task)
            try writeTask(task,at:at)
            try db.execute("INSERT INTO waiting_followup_occurrences VALUES (?,?,?)",[id,reviewKey,task.id])
            try history(subjects:[task.id,String(id.dropFirst(id.hasPrefix("task:") ? 5:7))],type:"task.waiting_review_created",before:Optional<LifeTask>.none,after:task,command:task.id,at:at,actor:"waiting-review")
            existing[storageKey]=task.id
        }
        // A parent's explicit/source-verified status change invalidates an untouched
        // review, but must never complete it or overwrite an edited/corrected review.
        for taskID in Set(mappings.compactMap{$0["task_id"]}) {
            guard var task=try record("life_tasks",id:taskID,as:LifeTask.self),let link=task.waitingFollowUp,task.version==link.lastAutomaticVersion,!task.status.terminal,
                  let parent=nodes[root(link.parentNodeID)],parent.status != .waiting || occurrence(parent) != (link.reviewKey ?? "initial") || existing[key(root(link.parentNodeID),link.reviewKey ?? "initial")] != taskID,
                  try db.rows("SELECT id FROM task_inference_corrections WHERE id=? AND kind='status'",["task:"+taskID]).isEmpty else {continue}
            let before=task;task.status = .cancelled;task.version+=1;task.updatedAt=at
            task.description += invalidatedSuffix
            task.waitingFollowUp=WaitingFollowUp(parentNodeID:link.parentNodeID,triggerAt:link.triggerAt,reviewKey:link.reviewKey,reason:link.reason,lastAutomaticVersion:task.version,automaticallyInvalidated:true)
            try writeTask(task,at:at)
            try history(subjects:[task.id],type:"task.waiting_review_invalidated",before:before,after:task,command:task.id+":invalidated",at:at,actor:"waiting-review")
        }
    }
}
