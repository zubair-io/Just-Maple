import Foundation

public struct DocumentTaskOffer:Codable,Sendable {
    public let taskID:String,title:String
    public let version:Int
    public let evidenceIDs:[String]
}
public struct DocumentCarryOffer:Codable,Sendable {
    public let documentID:String,day:String,revision:String,blockID:String,label:String
    public let version:Int
}
public struct DocumentSuggestions:Codable,Sendable {
    public let tasks:[DocumentTaskOffer]
    public let carryForward:[DocumentCarryOffer]
    public let hasMore:Bool
}
extension KnowledgeStore {
    public func documentSuggestions(documentID:String)throws -> DocumentSuggestions {
        guard let document=try managedDocument(id:documentID) else{throw MapleError.invalid("Document unavailable.")}
        let excluded=Set(try documentBlocks(documentID:documentID).compactMap(\.taskID))
        let allTasks:[LifeTask]=try self.tasks()
        var offeredTasks:[LifeTask]=[]
        for task in allTasks {
            guard !task.status.terminal, !excluded.contains("task:"+task.id) else{continue}
            if let day=document.day,let scheduled=task.scheduled?.date,scheduled>day{continue}
            offeredTasks.append(task)
        }
        offeredTasks.sort {a,b in
            if a.priority != b.priority{return a.priority>b.priority}
            return a.updatedAt>b.updatedAt
        }
        var carry:[DocumentCarryOffer]=[]
        var carryCapped=false
        if let day=document.day {
            let rows=try db.rows("SELECT b.json,d.id,d.day,d.revision FROM document_block_index b JOIN managed_documents d ON d.id=b.document_id WHERE d.notebook_id=? AND d.day<? AND d.revision IS NOT NULL AND b.state='active' AND json_extract(b.json,'$.taskID') IS NOT NULL ORDER BY d.day DESC,b.rowid DESC LIMIT 201",[document.notebookID,day])
            carryCapped=rows.count>200
            for row in rows.prefix(200) {
                let block=try JSONCodec.decode(DocumentBlockRecord.self,from:Data(row["json"]!.utf8))
                guard let taskID=block.taskID,!excluded.contains(taskID),let task=try taskNode(taskID),!task.status.terminal else{continue}
                carry.append(DocumentCarryOffer(documentID:row["id"]!,day:row["day"]!,revision:row["revision"]!,blockID:block.blockID,label:task.title,version:block.version))
            }
        }
        return DocumentSuggestions(tasks:offeredTasks.prefix(20).map{DocumentTaskOffer(taskID:"task:"+$0.id,title:$0.title,version:$0.version,evidenceIDs:$0.evidenceIDs)},carryForward:Array(carry.prefix(20)),hasMore:offeredTasks.count>20 || carry.count>20 || carryCapped)
    }
    func documentTaskOffer(_ taskID:String)throws -> DocumentTaskOffer {
        guard let task=try taskNode(taskID),!task.status.terminal,let version=try nodeVersion(taskID) else{throw MapleError.invalid("This task is unavailable or already finished.")}
        return DocumentTaskOffer(taskID:taskID,title:task.title,version:version,evidenceIDs:task.evidenceIDs)
    }
}
extension TodayDocumentCoordinator {
    public func insertTask(documentID:String,expectedRevision:String,commandID:String,taskID:String)async throws -> TodayDocumentSnapshot {
        let blockID="task-link:"+ManagedMarkdown.hash(documentID+":"+commandID)
        if let replay=try await store.documentMutation(commandID) {
            guard replay.documentID==documentID,replay.expectedRevision==expectedRevision,
                  try ManagedMarkdown.segments(replay.after).contains(where:{$0.id==blockID && $0.metadata["taskID"] as? String==taskID}) else{throw MapleError.invalid("Task insertion command reused with different content.")}
            return try await commit(documentID:documentID,expectedRevision:expectedRevision,content:replay.after,commandID:commandID)
        }
        let document=try await open(documentID:documentID)
        guard !document.readOnly,document.revision==expectedRevision else{throw MapleError.invalid("This note changed. Refresh before adding a task.")}
        guard try await !store.documentBlocks(documentID:documentID).contains(where:{$0.taskID==taskID}) else{throw MapleError.invalid("This task already has a block here. Use its existing block or restore it from history.")}
        let task=try await store.documentTaskOffer(taskID)
        let title=task.title.map {c in "\\`*_{}[]<>()#+-.!|~".contains(c) ? "\\"+String(c):String(c)}.joined().replacingOccurrences(of:"\n",with:" ")
        let content=document.content+"\n"+(try ManagedMarkdown.marker(["id":blockID,"taskID":taskID,"kind":"task"]))+"- [ ] "+title+"\n"
        return try await commit(documentID:documentID,expectedRevision:expectedRevision,content:content,commandID:commandID)
    }
}
