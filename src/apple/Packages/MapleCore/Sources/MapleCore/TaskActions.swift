import Foundation
import CryptoKit

public struct TaskActionState: Codable, Sendable, Equatable {
    public var resurfaceAt: Date?
    public var reviewAt: Date?
    public var waitingOn: String?
    public var lastMutationScope: String
    public var lastMutationID: String
    public var lastAction: String
    public func isDeferred(at: Date = Date()) -> Bool { resurfaceAt.map { $0 > at } ?? false }
}
public struct TaskActionChange: Codable, Sendable {
    public let kind: String
    public let issuedAt: Date
    public let resurfaceAt: Date?
    public let reviewAt: Date?
    public let waitingOn: String?
    public let targetMutationID: String?
    public init(kind:String,issuedAt:Date,resurfaceAt:Date?=nil,reviewAt:Date?=nil,waitingOn:String?=nil,targetMutationID:String?=nil) {
        self.kind=kind;self.issuedAt=issuedAt;self.resurfaceAt=resurfaceAt;self.reviewAt=reviewAt;self.waitingOn=waitingOn;self.targetMutationID=targetMutationID
    }
}
public struct TaskActionResult: Codable, Sendable {
    public let nodeID: String
    public let version: Int
    public let mutationID: String
}

extension SQLite {
    func migrateTaskActions() throws {
        try execute("CREATE TABLE IF NOT EXISTS task_action_mutations (id TEXT PRIMARY KEY, scope TEXT NOT NULL, mutation_id TEXT NOT NULL, node_id TEXT NOT NULL, result_version INTEGER NOT NULL, before_json TEXT NOT NULL, action TEXT NOT NULL, undone_by TEXT)")
    }
}

extension KnowledgeStore {
    private func taskActionKey(scope:String,id:String) -> String {
        let text=String(scope.utf8.count)+":"+scope+id
        return "task-action:"+SHA256.hash(data:Data(text.utf8)).map{String(format:"%02x",$0)}.joined()
    }

    public func applyTaskAction(nodeID:String,change:TaskActionChange,expectedVersion:Int,requestID:String,scope:String,at:Date=Date()) throws -> TaskActionResult {
        try validateText(scope,max:256,required:true);try validateText(requestID,max:256,required:true)
        try validateText(nodeID,max:1024,required:true)
        guard change.issuedAt.timeIntervalSince1970.isFinite else {throw MapleError.invalid("Invalid task action date.")}
        let key=taskActionKey(scope:scope,id:requestID)
        return try command(key,payload:JSONCodec.string(["node":nodeID,"change":try JSONCodec.string(change),"version":String(expectedVersion)])) {
            guard let before=try taskNode(nodeID),try nodeVersion(nodeID)==expectedVersion else {throw MapleError.invalid("Task changed. Reload before applying this action.")}
            if nodeID.hasPrefix("source:") {
                guard let source=try record("task_suggestions",id:String(nodeID.dropFirst(7)),as:TaskSuggestion.self),source.reviewStatus=="pending",obligationRoot(source,relations:try taskRelations())==nodeID else {throw MapleError.invalid("Open the current combined task before applying an action.")}
            }
            var task=before
            var state=TaskActionState(lastMutationScope:scope,lastMutationID:requestID,lastAction:change.kind)
            switch change.kind {
            case "done", "notNeeded":
                guard change.resurfaceAt==nil,change.reviewAt==nil,change.waitingOn==nil,change.targetMutationID==nil,!before.status.terminal else {throw MapleError.invalid("Task action is no longer available.")}
                task.status=change.kind=="done" ? .completed:.cancelled
                task.completedAt=change.kind=="done" ? at:nil
                task.waitingReason=""
            case "later":
                guard !before.status.terminal,before.status != .waiting,let date=change.resurfaceAt,date.timeIntervalSince1970.isFinite,date>change.issuedAt,change.reviewAt==nil,change.waitingOn==nil,change.targetMutationID==nil else {throw MapleError.invalid("Choose a valid resurfacing time for an actionable task.")}
                state.resurfaceAt=date
            case "waiting":
                let actor=change.waitingOn?.trimmingCharacters(in:.whitespacesAndNewlines) ?? ""
                try validateText(actor,max:512,required:true)
                guard !before.status.terminal,change.resurfaceAt==nil,change.targetMutationID==nil,change.reviewAt.map({$0.timeIntervalSince1970.isFinite && $0>change.issuedAt}) ?? true else {throw MapleError.invalid("Choose a valid waiting review time.")}
                task.status = .waiting;task.waitingReason=actor
                state.waitingOn=actor;state.reviewAt=change.reviewAt
            case "undo":
                guard let target=change.targetMutationID,change.resurfaceAt==nil,change.reviewAt==nil,change.waitingOn==nil else {throw MapleError.invalid("Choose an action to undo.")}
                let targetKey=taskActionKey(scope:scope,id:target)
                guard let prior=try db.rows("SELECT * FROM task_action_mutations WHERE id=? AND scope=? AND node_id=?",[targetKey,scope,nodeID]).first,prior["undone_by"]==nil,prior["action"] != "undo",Int(prior["result_version"] ?? "")==expectedVersion,before.actionState?.lastMutationID==target else {throw MapleError.invalid("This action cannot be undone because the task changed or belongs to another device.")}
                task=try JSONCodec.decode(LifeTask.self,from:Data(prior["before_json"]!.utf8))
                state.resurfaceAt=task.actionState?.resurfaceAt;state.reviewAt=task.actionState?.reviewAt;state.waitingOn=task.actionState?.waitingOn
                try db.execute("UPDATE task_action_mutations SET undone_by=? WHERE id=?",[requestID,targetKey])
            default: throw MapleError.invalid("Unsupported task action.")
            }
            // Deadlines, task content and activity membership are never edited by these actions.
            task.actionState=state;task.updatedAt=at
            let next=expectedVersion+1
            if nodeID.hasPrefix("task:") {
                task.version=next;try writeTask(task,at:at)
            } else if var source=try record("task_suggestions",id:String(nodeID.dropFirst(7)),as:TaskSuggestion.self) {
                source.candidate=task;source.version=next
                try db.execute("UPDATE task_suggestions SET json=? WHERE id=?",[try JSONCodec.string(source),source.id])
            } else {throw MapleError.invalid("Task unavailable.")}
            try db.execute("INSERT OR REPLACE INTO task_inference_corrections VALUES (?,'status')",[nodeID])
            try db.execute("DELETE FROM task_progress_evidence WHERE id=?",[nodeID])
            try db.execute("INSERT INTO task_action_mutations(id,scope,mutation_id,node_id,result_version,before_json,action) VALUES (?,?,?,?,?,?,?)",[key,scope,requestID,nodeID,String(next),try JSONCodec.string(before),change.kind])
            try history(subjects:[String(nodeID.dropFirst(nodeID.hasPrefix("task:") ? 5:7))],type:"task.action."+change.kind,before:before,after:task,command:key,at:at)
            return TaskActionResult(nodeID:nodeID,version:next,mutationID:requestID)
        }
    }
}
