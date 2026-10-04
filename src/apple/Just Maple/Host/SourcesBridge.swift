import Foundation
import MapleCore

extension Bridge {
    func sourcesCommand(_ action:String,_ body:[String:Any]) async throws -> Any {
        guard let store=model.store else{throw MapleError.invalid("Your local workspace is not ready.")}
        func integer(_ key:String,_ fallback:Int,_ range:ClosedRange<Int>) throws -> Int {
            guard let value=body[key] else{return fallback}
            guard let n=value as? Int,range.contains(n) else{throw MapleError.invalid("Invalid \(key).")};return n
        }
        switch action {
        case "sourceList", "sourceChanges":
            var data=body["query"] as? [String:Any] ?? [:]
            for key in ["receivedAfter","receivedBefore"] {
                if let date=data[key] as? String {
                    let parser=ISO8601DateFormatter()
                    parser.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
                    var parsed=parser.date(from:date)
                    if parsed==nil {parser.formatOptions=[.withInternetDateTime];parsed=parser.date(from:date)}
                    guard let parsed else{throw MapleError.invalid("Invalid received date.")}
                    data[key]=parsed.timeIntervalSince1970
                }
            }
            let query=try decode(SourceQuery.self,["query":data],"query",limit:8000)
            let cursor:SourceCursor? = body["cursor"] == nil || body["cursor"] is NSNull ? nil:try decode(SourceCursor.self,body,"cursor",limit:2048)
            if action=="sourceChanges" {
                guard let cursor else {throw MapleError.invalid("Refresh Sources to check new entries.")}
                return try json(try await store.sourceChanges(query:query,cursor:cursor))
            }
            return try json(try await store.sourceList(query:query,cursor:cursor,limit:integer("limit",60,1...100)))
        case "sourceDetail":return try json(try await store.sourceDetail(eventID:string(body,"eventID",limit:1024)))
        case "sourceHistory":
            let before=(body["beforeSequence"] as? NSNumber)?.int64Value
            guard before.map({$0>0}) ?? true else{throw MapleError.invalid("Invalid history cursor.")}
            return try json(try await store.sourceHistory(eventID:string(body,"eventID",limit:1024),beforeSequence:before,limit:integer("limit",60,1...100)))
        case "sourceArtifact":return try json(try await store.sourceArtifact(eventID:string(body,"eventID",limit:1024),artifactID:string(body,"artifactID",limit:256),offset:integer("offset",0,0...8_388_608),limit:integer("limit",65_536,1...65_536)))
        case "sourceRetry":
            guard let version=body["expectedVersion"] as? NSNumber,version.int64Value>=0 else{throw MapleError.invalid("A processing version is required.")}
            return try json(try await store.sourceRetry(commandID:string(body,"commandID",limit:256),eventID:string(body,"eventID",limit:1024),stage:string(body,"stage",limit:80),expectedVersion:version.int64Value))
        default:throw MapleError.invalid("Unsupported source request.")
        }
    }
}
