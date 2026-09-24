import Foundation

extension KnowledgeStore {
    /// Explicit user correction. Removes organization, never source evidence or task content.
    public func removeActivity(id:String,expectedVersion:Int,requestID:String,at:Date=Date())throws->String {
        try command(requestID,payload:JSONCodec.string(["removeActivity":id,"version":String(expectedVersion)])) {
            guard let activity=try record("life_activities",id:id,as:LifeActivity.self),activity.version==expectedVersion else {throw MapleError.invalid("Activity changed or is unavailable. Reload before removing it.")}
            var linkedSources=try records("task_suggestions",as:TaskSuggestion.self).filter{$0.candidate.activityIDs.contains(id)}.map(\.sourceKey)
            for link in try records("activity_link_evidence",as:ActivityLinkEvidence.self) where link.activityID==id {
                if let key=link.sourceKey {linkedSources.append(key)}
                if let source=try event(link.eventID) {linkedSources.append("observation:"+(try JSONCodec.string([source.source.connector,source.source.account,source.source.externalID])))}
            }
            if !linkedSources.isEmpty {try db.execute("INSERT OR REPLACE INTO activity_discovery_blocks VALUES (?,?,?)",[try JSONCodec.string(Array(Set(linkedSources)).sorted()),activity.name,String(at.timeIntervalSince1970)])}
            for var task in try tasks() where task.activityIDs.contains(id) {
                let before=task;task.activityIDs.removeAll{$0==id};task.version+=1;task.updatedAt=at
                try writeTask(task,at:at)
                try history(subjects:[task.id,id],type:"task.activity_removed",before:before,after:task,command:requestID,at:at)
            }
            for var suggestion in try records("task_suggestions",as:TaskSuggestion.self) where suggestion.candidate.activityIDs.contains(id) {
                let before=suggestion;suggestion.candidate.activityIDs.removeAll{$0==id};suggestion.version+=1
                try db.execute("UPDATE task_suggestions SET json=? WHERE id=?",[try JSONCodec.string(suggestion),suggestion.id])
                try history(subjects:[suggestion.id,id],type:"suggestion.activity_removed",before:before,after:suggestion,command:requestID,at:at)
            }
            for var series in try records("task_series",as:TaskSeries.self) where series.template.activityIDs.contains(id) {
                let before=series;series.template.activityIDs.removeAll{$0==id};series.version+=1
                try db.execute("UPDATE task_series SET version=?,json=? WHERE id=?",[String(series.version),try JSONCodec.string(series),series.id])
                try history(subjects:[series.id,id],type:"series.activity_removed",before:before,after:series,command:requestID,at:at)
            }
            try db.execute("DELETE FROM task_activities WHERE activity_id=?",[id])
            try db.execute("DELETE FROM world_states WHERE subject=?",[id])
            try db.execute("DELETE FROM activity_link_evidence WHERE activity_id=?",[id])
            try db.execute("DELETE FROM life_activities WHERE id=?",[id])
            try history(subjects:[id],type:"activity.removed",before:activity,after:Optional<LifeActivity>.none,command:requestID,at:at)
            return id
        }
    }
}
