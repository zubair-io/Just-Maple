import Foundation
import MapleCore

extension Bridge {
    func decode<T:Decodable>(_ type:T.Type, _ body:[String:Any], _ key:String, limit:Int = 65536) throws -> T {
        guard let value=body[key],JSONSerialization.isValidJSONObject(value) else {throw MapleError.invalid("Missing \(key).")}
        let data=try JSONSerialization.data(withJSONObject:value)
        guard data.count<=limit else {throw MapleError.invalid("This change is too large.")}
        return try JSONCodec.decode(type,from:data)
    }
    func worldCommand(_ action:String,_ body:[String:Any]) async throws -> Any {
        guard let store=model.store else {throw MapleError.invalid("Your local workspace is not ready.")}
        if action=="worldHistory" { return try json(try await store.worldHistory(before:(body["before"] as? NSNumber)?.int64Value,subjects:body["subjects"] as? [String] ?? [])) }
        if action=="extractTasks" {try await store.requestTaskExtraction(eventID:string(body,"id",limit:256));await model.refresh();return try snapshot()}
        let requestID=try string(body,"requestID",limit:256)
        guard let version=body["expectedVersion"] as? Int,version>=0 else {throw MapleError.invalid("A current version is required.")}
        switch action {
        case "applyTaskAction":
            _ = try await store.applyTaskAction(nodeID:string(body,"id",limit:512),change:decode(TaskActionChange.self,body,"change"),expectedVersion:version,requestID:requestID,scope:"desktop")
        case "correctTaskInference":
            _ = try await store.correctTaskInference(nodeID:string(body,"id",limit:512),status:(body["status"] as? String).flatMap(TaskStatus.init(rawValue:)),separate:body["separate"] as? Bool ?? false,expectedVersion:version,requestID:requestID)
        case "regroupActivity": _ = try await store.regroupActivity(sourceID:string(body,"id",limit:256),target:decode(LifeActivity.self,body,"record"),selectedIDs:body["ids"] as? [String] ?? [],merge:body["merge"] as? Bool ?? false,expectedRevision:Int64(version),requestID:requestID)
        case "removeActivity": _ = try await store.removeActivity(id:string(body,"id",limit:256),expectedVersion:version,requestID:requestID)
        case "saveActivity": _ = try await store.saveActivity(decode(LifeActivity.self,body,"record"),expectedVersion:version,requestID:requestID)
        case "saveTask": _ = try await store.saveTask(decode(LifeTask.self,body,"record"),expectedVersion:version,requestID:requestID)
        case "saveSeries": _ = try await store.saveSeries(decode(TaskSeries.self,body,"record"),expectedVersion:version,requestID:requestID)
        case "correctState": _ = try await store.correctWorldState(decode(WorldStateClaim.self,body,"record"),expectedRevision:Int64(version),requestID:requestID)
        case "reviewSuggestion":
            _ = try await store.reviewSuggestion(id:string(body,"id",limit:256),action:string(body,"decision",limit:40),edited:body["record"] == nil ? nil : decode(LifeTask.self,body,"record"),expectedVersion:version,expectedTaskVersion:body["expectedTaskVersion"] as? Int,requestID:requestID)
        case "acknowledgeAttention":
            let until=(body["until"] as? Double).map{Date(timeIntervalSince1970:$0)}
            _ = try await store.acknowledgeAttention(id:string(body,"id",limit:4096),until:until,requestID:requestID)
        default: throw MapleError.invalid("Unsupported world command.")
        }
        await model.refresh()
        return try snapshot()
    }
}
