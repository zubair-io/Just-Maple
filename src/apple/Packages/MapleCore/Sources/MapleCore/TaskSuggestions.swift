import Foundation
import CryptoKit

extension KnowledgeStore {
    public func offerTask(_ input:TaskSuggestion, at:Date = Date()) throws -> TaskSuggestion {
        try db.transaction { try offerTaskInTransaction(input, at:at) }
    }
    func offerTaskInTransaction(_ input:TaskSuggestion, at:Date) throws -> TaskSuggestion {
            guard let event=try event(input.eventID),["gmail","google_calendar","apple_calendar","imessage"].contains(event.source.connector),!input.quote.isEmpty,event.content.contains(input.quote),!input.provider.isEmpty else { throw MapleError.invalid("Task suggestions require an exact quote from a supported source.") }
            var suggestion=input
            if event.source.connector=="imessage", input.obligation != nil || input.actorID != nil {
                guard try TaskEvidenceRules.configureOwnership(&suggestion,obligation:input.obligation,actorID:input.actorID,event:event) else {throw MapleError.invalid("Tentative plans do not create tasks.")}
            }
            let headers=event.content.components(separatedBy:"\nBody:").first!.components(separatedBy:"\n")
            suggestion.sourceSubject=headers.first{$0.hasPrefix("Subject: ")}.map{String($0.dropFirst(9))}
            suggestion.sourceSender=headers.first{$0.hasPrefix("Sender: ")}.map{String($0.dropFirst(8))}
            try validateTask(suggestion.candidate)
            suggestion.obligationIdentity = ObligationIdentity(event:event, suggestion:suggestion)
            if let protected = try preserveResolvedObligation(suggestion, event:event, at:at) { return protected }
            let normalized=suggestion.candidate.title.trimmingCharacters(in:.whitespacesAndNewlines).lowercased()
            suggestion.sourceKey=try JSONCodec.string([event.source.connector,event.source.account,event.source.externalID,normalized])
            suggestion.fingerprint=SHA256.hash(data:Data((suggestion.sourceKey+event.source.revision).utf8)).map{String(format:"%02x",$0)}.joined()
            if let row=try db.rows("SELECT json FROM task_suggestions WHERE fingerprint=?",[suggestion.fingerprint]).first {
                let existing=try JSONCodec.decode(TaskSuggestion.self,from:Data(row["json"]!.utf8))
                guard existing.reviewStatus=="superseded" else {return existing}
                suggestion.id=existing.id;suggestion.version=existing.version
            }
            let older=try db.rows("SELECT json FROM task_suggestions WHERE source_key=? ORDER BY rowid DESC",[suggestion.sourceKey]).map{try JSONCodec.decode(TaskSuggestion.self,from:Data($0["json"]!.utf8))}
            suggestion.linkedTaskID=older.first(where:{$0.acceptedTaskID != nil})?.acceptedTaskID
            suggestion.possibleDuplicateIDs=try tasks().filter{!$0.status.terminal && $0.title.lowercased()==normalized}.map(\.id)
            suggestion.reviewStatus="pending";suggestion.acceptedTaskID=nil;suggestion.createdAt=at;suggestion.version+=1
            suggestion.candidate.evidenceIDs=[event.id]
            if suggestion.obligation != "waiting_on_other" {suggestion.candidate.status = .open}
            try db.execute("INSERT INTO task_suggestions VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json",[suggestion.id,suggestion.fingerprint,suggestion.sourceKey,try JSONCodec.string(suggestion)])
            try history(subjects:[suggestion.id],type:"task.suggested",before:Optional<TaskSuggestion>.none,after:suggestion,command:suggestion.fingerprint,at:at,actor:input.provider)
            return suggestion
    }
    public func reviewSuggestion(id:String, action:String, edited:LifeTask?, expectedVersion:Int, expectedTaskVersion:Int? = nil, requestID:String, at:Date = Date()) throws -> TaskSuggestion {
        try command(requestID,payload:JSONCodec.string(["id":id,"action":action,"edited":try edited.map{try JSONCodec.string($0)} ?? "", "version":String(expectedVersion),"taskVersion":String(expectedTaskVersion ?? -1)])) {
            guard var suggestion=try record("task_suggestions",id:id,as:TaskSuggestion.self) else {throw MapleError.invalid("Suggestion unavailable.")}
            if action=="accept",suggestion.reviewStatus=="accepted" {return suggestion}
            guard suggestion.version==expectedVersion else {throw MapleError.invalid("This suggestion changed. Reload it before deciding.")}
            let old=suggestion
            switch action {
            case "accept":
                guard reconciliationRoot("source:"+id,relations:try taskRelations())=="source:"+id else {throw MapleError.invalid("This source belongs to a combined task. Open the primary task to review it.")}
                guard suggestion.reviewStatus=="pending",try event(suggestion.eventID) != nil else {throw MapleError.invalid("This source cannot be accepted.")}
                var task=edited ?? suggestion.candidate
                if edited==nil {
                    let members=try reconciliationMembers("source:"+id).compactMap{try taskNode($0)}
                    task.activityIDs=Array(Set(members.flatMap(\.activityIDs))).sorted()
                    if task.due==nil {task.due=try members.compactMap(\.due).sorted{try $0.boundary(endOfDay:true)<$1.boundary(endOfDay:true)}.first}
                }
                task.id=suggestion.linkedTaskID ?? "suggestion-task:\(suggestion.id)"
                let previous=try record("life_tasks",id:task.id,as:LifeTask.self)
                if previous != nil {guard previous!.version==expectedTaskVersion else {throw MapleError.invalid("The linked task has edits. Review its current version before applying this proposal.")}}
                task.evidenceIDs=Array(Set((previous?.evidenceIDs ?? []) + (try reconciliationEvidence("source:"+suggestion.id))));task.version=(previous?.version ?? 0)+1
                task.createdAt=previous?.createdAt ?? at;task.updatedAt=at;task.activityIDs=Array(Set(task.activityIDs)).sorted()
                task.status=previous?.status ?? suggestion.candidate.status;task.completedAt=previous?.completedAt ?? suggestion.candidate.completedAt;task.seriesID=previous?.seriesID;task.occurrenceKey=previous?.occurrenceKey
                try validateTask(task);try writeTask(task,at:at)
                try history(subjects:[task.id]+task.activityIDs,type:previous == nil ? "task.accepted":"task.proposal_applied",before:previous,after:task,command:requestID,at:at)
                suggestion.reviewStatus="accepted";suggestion.acceptedTaskID=task.id
            case "reject": guard suggestion.reviewStatus=="pending" else {throw MapleError.invalid("Only pending suggestions can be rejected.")};suggestion.reviewStatus="rejected"
            case "undoReject": guard suggestion.reviewStatus=="rejected",try event(suggestion.eventID) != nil else {throw MapleError.invalid("This rejection cannot be undone.")};suggestion.reviewStatus="pending"
            case "detach":
                guard suggestion.reviewStatus=="accepted" else {throw MapleError.invalid("Only accepted suggestions can be detached.")}
                // Safe undo: never deletes or rewinds a canonical task, even if it was edited.
                suggestion.reviewStatus="rejected";suggestion.acceptedTaskID=nil
            default: throw MapleError.invalid("Unsupported suggestion decision.")
            }
            // Review applies to the consolidated obligation while retaining every original source row.
            for member in try reconciliationMembers("source:"+id) where member.hasPrefix("source:") && member != "source:"+id {
                guard var other=try record("task_suggestions",id:String(member.dropFirst(7)),as:TaskSuggestion.self) else {continue}
                if action=="accept" && other.reviewStatus=="pending" {other.reviewStatus="accepted";other.acceptedTaskID=suggestion.acceptedTaskID}
                else if action=="reject" && other.reviewStatus=="pending" {other.reviewStatus="rejected"}
                else if action=="undoReject" && other.reviewStatus=="rejected" {other.reviewStatus="pending"}
                else {continue}
                other.version+=1
                try db.execute("UPDATE task_suggestions SET json=? WHERE id=?",[try JSONCodec.string(other),other.id])
            }
            if action=="accept",let taskID=suggestion.acceptedTaskID {
                if try db.rows("SELECT id FROM task_inference_corrections WHERE id=? AND kind='status'",["source:"+id]).first != nil {try db.execute("INSERT OR REPLACE INTO task_inference_corrections VALUES (?,'status')",["task:"+taskID])}
                if var progress=try record("task_progress_evidence",id:"source:"+id,as:TaskProgressEvidence.self) {progress.nodeID="task:"+taskID;try db.execute("INSERT OR REPLACE INTO task_progress_evidence VALUES (?,?)",[progress.nodeID,try JSONCodec.string(progress)])}
            }
            suggestion.version+=1
            try db.execute("UPDATE task_suggestions SET json=? WHERE id=?",[try JSONCodec.string(suggestion),id])
            try history(subjects:[id]+[suggestion.acceptedTaskID].compactMap{$0},type:"suggestion.\(action)",before:old,after:suggestion,command:requestID,at:at)
            return suggestion
        }
    }
}
