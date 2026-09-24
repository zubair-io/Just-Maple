import Foundation
extension KnowledgeStore {
    /// User correction: merge every linked task, or move selected tasks into another scope.
    public func regroupActivity(sourceID:String,target:LifeActivity,selectedIDs:[String],merge:Bool,expectedRevision:Int64,requestID:String,at:Date=Date())throws->String {
        try command(requestID,payload:JSONCodec.string(["source":sourceID,"target":try JSONCodec.string(target),"selected":try JSONCodec.string(selectedIDs),"merge":String(merge),"revision":String(expectedRevision)])) {
            guard try worldRevision()==expectedRevision,let source=try record("life_activities",id:sourceID,as:LifeActivity.self),target.id != sourceID else {throw MapleError.invalid("Activities changed. Refresh before regrouping.")}
            var destination=target
            if let old=try record("life_activities",id:target.id,as:LifeActivity.self) {
                guard old.version==target.version,old.lifecycle == .active else {throw MapleError.invalid("Destination changed or is inactive.")};destination=old
            } else {
                try validateText(target.name,max:256,required:true);try validateText(target.purpose)
                destination.version=1;destination.createdAt=at;destination.updatedAt=at
                try db.execute("INSERT INTO life_activities VALUES (?,?,?)",[destination.id,"1",try JSONCodec.string(destination)])
                try history(subjects:[destination.id],type:"activity.created",before:Optional<LifeActivity>.none,after:destination,command:requestID,at:at)
            }
            let tasks=try tasks().filter{$0.activityIDs.contains(sourceID)}
            let suggestions=try records("task_suggestions",as:TaskSuggestion.self).filter{$0.candidate.activityIDs.contains(sourceID)}
            let available=Set(tasks.map(\.id)+suggestions.map(\.id))
            guard merge || (!selectedIDs.isEmpty && Set(selectedIDs).isSubset(of:available)) else {throw MapleError.invalid("Select current tasks to move.")}
            var moved=Set(selectedIDs)
            if merge {moved=available}
            // Accepted source links and their canonical task move together.
            for s in suggestions {if moved.contains(s.id),let id=s.acceptedTaskID {moved.insert(id)}}
            for var task in tasks where moved.contains(task.id) {
                let old=task;task.activityIDs=Array(Set(task.activityIDs.filter{$0 != sourceID}+[destination.id])).sorted();task.version+=1;task.updatedAt=at
                try writeTask(task,at:at)
                try history(subjects:[task.id,sourceID,destination.id],type:"task.regrouped",before:old,after:task,command:requestID,at:at)
            }
            for var s in suggestions where moved.contains(s.id) || (s.acceptedTaskID.map{moved.contains($0)} ?? false) {
                let old=s;s.candidate.activityIDs=Array(Set(s.candidate.activityIDs.filter{$0 != sourceID}+[destination.id])).sorted();s.version+=1
                try db.execute("UPDATE task_suggestions SET json=? WHERE id=?",[try JSONCodec.string(s),s.id])
                try db.execute("INSERT OR IGNORE INTO activity_membership_corrections VALUES (?,?)",[sourceID,s.id])
                try db.execute("DELETE FROM activity_link_evidence WHERE activity_id=? AND suggestion_id=?",[sourceID,s.id])
                let evidence=ActivityLinkEvidence(activityID:destination.id,suggestionID:s.id,eventID:s.eventID,reason:"You moved this task to this activity.")
                try db.execute("INSERT OR REPLACE INTO activity_link_evidence VALUES (?,?,?)",[destination.id,s.id,try JSONCodec.string(evidence)])
                try history(subjects:[s.id,sourceID,destination.id],type:"suggestion.regrouped",before:old,after:s,command:requestID,at:at)
            }
            if merge {
                // Preserve non-task provenance when an entire activity is merged.
                for var link in try records("activity_link_evidence",as:ActivityLinkEvidence.self) where link.activityID==sourceID {
                    try db.execute("INSERT OR IGNORE INTO activity_membership_corrections VALUES (?,?)",[sourceID,link.suggestionID])
                    try db.execute("DELETE FROM activity_link_evidence WHERE activity_id=? AND suggestion_id=?",[sourceID,link.suggestionID])
                    link.activityID=destination.id
                    try db.execute("INSERT OR REPLACE INTO activity_link_evidence VALUES (?,?,?)",[destination.id,link.suggestionID,try JSONCodec.string(link)])
                }
                for var series in try records("task_series",as:TaskSeries.self) where series.template.activityIDs.contains(sourceID) {
                    let old=series;series.template.activityIDs=Array(Set(series.template.activityIDs.filter{$0 != sourceID}+[destination.id])).sorted();series.version+=1
                    try db.execute("UPDATE task_series SET version=?,json=? WHERE id=?",[String(series.version),try JSONCodec.string(series),series.id])
                    try history(subjects:[series.id,sourceID,destination.id],type:"series.regrouped",before:old,after:series,command:requestID,at:at)
                }
                var archived=source;archived.lifecycle = .archived;archived.version+=1;archived.updatedAt=at
                try db.execute("UPDATE life_activities SET version=?,json=? WHERE id=?",[String(archived.version),try JSONCodec.string(archived),sourceID])
                try history(subjects:[sourceID,destination.id],type:"activity.merged",before:source,after:archived,command:requestID,at:at)
            } else {
                try history(subjects:[sourceID,destination.id],type:"activity.split",before:source,after:destination,command:requestID,at:at)
            }
            return destination.id
        }
    }
}
