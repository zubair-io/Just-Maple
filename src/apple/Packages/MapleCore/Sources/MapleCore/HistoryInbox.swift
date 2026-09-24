import Foundation

public struct HistoryInboxCursor: Codable, Sendable {
    public let occurredAt:Date
    public let eventID:String
    public let snapshotRowID:Int64
    public let connector:String?
    public init(occurredAt:Date,eventID:String,snapshotRowID:Int64,connector:String?=nil) {self.occurredAt=occurredAt;self.eventID=eventID;self.snapshotRowID=snapshotRowID;self.connector=connector}
}
public struct HistoryInboxTag: Codable, Sendable {public let id:String;public let name:String}
public struct HistoryInboxItem: Codable, Sendable {
    public let id:String, connector:String, sender:String, subject:String, preview:String, status:String, statusDetail:String
    public let occurredAt:Date
    public let analysisStatus:String?
    public let tags:[HistoryInboxTag]
}
public struct HistoryInboxSource: Codable, Sendable {public let connector:String;public let name:String;public let count:Int}
public struct HistoryInboxPage: Codable, Sendable {
    public let items:[HistoryInboxItem]
    public let nextCursor:HistoryInboxCursor?
    public let total:Int
    public let sources:[HistoryInboxSource]
}

extension KnowledgeStore {
    /// Bounded global diagnostics. Full contexts remain stored and source detail is
    /// fetched only when inspected, never used as the History list's data source.
    public func recentDecisions(limit:Int=30) throws -> [Decision] {
        try db.rows("SELECT json FROM decisions ORDER BY rowid DESC LIMIT ?",[String(min(50,max(1,limit)))]).map {try JSONCodec.decode(Decision.self,from:Data($0["json"]!.utf8))}
    }
    public func recentQueue(limit:Int=100) throws -> [QueueItem] {
        try db.rows("SELECT * FROM processing_jobs ORDER BY rowid DESC LIMIT ?",[String(min(200,max(1,limit)))]).map {QueueItem(eventID:$0["event_id"]!,status:$0["status"]!,attempts:Int($0["attempts"]!)!,nextAttemptAt:Date(timeIntervalSince1970:Double($0["next_attempt_at"]!)!),error:$0["error"])}
    }
    public func processingQueueCounts() throws -> [String:Int] {
        Dictionary(uniqueKeysWithValues:try db.rows("SELECT status,COUNT(*) AS count FROM processing_jobs GROUP BY status").map {($0["status"]!,Int($0["count"]!)!)})
    }
    public func historyInboxPage(cursor:HistoryInboxCursor?=nil,limit:Int=60,connector:String?=nil) throws -> HistoryInboxPage {
        guard (1...100).contains(limit),cursor.map({$0.occurredAt.timeIntervalSince1970.isFinite && $0.snapshotRowID>=0 && !$0.eventID.isEmpty && $0.eventID.utf8.count<=1024}) ?? true else {throw MapleError.invalid("Invalid history page.")}
        if let connector {try validateText(connector,max:128,required:true)}
        guard cursor==nil || cursor?.connector==connector else {throw MapleError.invalid("Restart history when changing the source filter.")}
        // Index creation is idempotent and contains no source-data transformation.
        try db.execute("CREATE INDEX IF NOT EXISTS history_inbox_order ON events(occurred_at DESC,id DESC)")
        try db.execute("CREATE INDEX IF NOT EXISTS history_inbox_connector_order ON events(connector,occurred_at DESC,id DESC)")
        let watermark=try cursor?.snapshotRowID ?? Int64(db.rows("SELECT COALESCE(MAX(rowid),0) AS n FROM events").first!["n"]!)!
        var arguments:[String?]=[String(watermark)]
        var condition="e.rowid<=?"
        if let connector {condition += " AND e.connector=?";arguments.append(connector)}
        if let cursor {condition += " AND (e.occurred_at<? OR (e.occurred_at=? AND e.id<?))";let date=String(cursor.occurredAt.timeIntervalSince1970);arguments += [date,date,cursor.eventID]}
        arguments.append(String(limit+1))
        let rows=try db.rows("""
        SELECT e.id,e.connector,e.occurred_at,substr(json_extract(e.json,'$.content'),1,4096) AS excerpt,
          json_extract(e.json,'$.type') AS type,p.status AS processing,f.status AS fact,t.status AS extraction,
          s.status AS state,json_extract(d.json,'$.route') AS route
        FROM events e LEFT JOIN processing_jobs p ON p.event_id=e.id
        LEFT JOIN fact_jobs f ON f.event_id=e.id LEFT JOIN task_extraction_jobs t ON t.event_id=e.id
        LEFT JOIN state_jobs s ON s.event_id=e.id LEFT JOIN decisions d ON d.event_id=e.id
        WHERE \(condition) ORDER BY e.occurred_at DESC,e.id DESC LIMIT ?
        """,arguments)
        let visible=Array(rows.prefix(limit)),ids=visible.compactMap{$0["id"]}
        var tags=[String:Set<String>](),statuses=[String:Set<String>]()
        if !ids.isEmpty {
            let marks=Array(repeating:"?",count:ids.count).joined(separator:",")
            let matched=try db.rows("SELECT id,json_extract(json,'$.eventID') AS event_id FROM task_suggestions WHERE json_extract(json,'$.eventID') IN (\(marks)) AND json_extract(json,'$.reviewStatus') IN ('pending','accepted')",ids)
            let suggestions=try matched.compactMap { row -> [String:String]? in
                guard var metadata=try historyTaskMetadata("source:"+row["id"]!) else {return nil}
                metadata["event_id"]=row["event_id"];return metadata
            }
            let tasks=try db.rows("""
            SELECT e.value AS event_id,json_extract(t.json,'$.status') AS status,json_extract(t.json,'$.activityIDs') AS tags
            FROM life_tasks t,json_each(t.json,'$.evidenceIDs') e WHERE e.value IN (\(marks))
            """,ids)
            for row in suggestions+tasks {
                guard let id=row["event_id"] else {continue}
                statuses[id,default:[]].insert(row["status"] ?? "")
                if let json=row["tags"],let values=try? JSONDecoder().decode([String].self,from:Data(json.utf8)) {tags[id,default:[]].formUnion(values)}
            }
        }
        let names=Dictionary(uniqueKeysWithValues:try db.rows("SELECT id,substr(json_extract(json,'$.name'),1,120) AS name FROM life_activities").map{($0["id"]!,$0["name"] ?? "Activity")})
        let items=visible.map { row -> HistoryInboxItem in
            let id=row["id"]!,excerpt=row["excerpt"] ?? ""
            let lines=excerpt.components(separatedBy:"\n")
            func field(_ key:String)->String? {lines.prefix(16).first(where:{$0.hasPrefix(key+": ")}).map{String($0.dropFirst(key.count+2))}}
            let sender=field("Sender") ?? field("From") ?? Self.historyConnectorName(row["connector"]!)
            let subject=field("Subject") ?? field("Title") ?? (row["connector"]=="imessage" ? "Message conversation":field("Thread")) ?? (row["type"] ?? "Source update").replacingOccurrences(of:".",with:" ")
            let body:String
            if let bodyIndex=lines.firstIndex(where:{$0=="Body:" || $0=="Body (snippet only):"}) {body=lines.dropFirst(bodyIndex+1).joined(separator:" ")}
            else if let separator=excerpt.range(of:"\n\n") {body=String(excerpt[separator.upperBound...])}
            else {body=lines.filter{!$0.hasPrefix("Sender:") && !$0.hasPrefix("Subject:") && !$0.hasPrefix("Thread:") && !$0.hasPrefix("Direction:")}.joined(separator:" ")}
            let taskStates=statuses[id] ?? []
            let processing=row["processing"] ?? "pending"
            let deeper=[row["fact"],row["extraction"],row["state"]].compactMap{$0}
            let analysis=deeper.contains(where:{["failed","blocked"].contains($0)}) ? "failed":deeper.contains(where:{["pending","running","leased"].contains($0)}) ? "waiting":nil
            let status:String,detail:String
            if !taskStates.isDisjoint(with:["open","in_progress"]) {status="flagged";detail="An open action is linked to this source."}
            else if taskStates.contains("waiting") {status="waiting";detail="A linked action is waiting on someone or something."}
            else if ["failed","blocked"].contains(processing) {status="failed";detail="Source processing needs retry. The source is preserved."}
            else if ["ask_user","notify"].contains(row["route"] ?? "") {status="flagged";detail="Source processing flagged this for your attention."}
            else if processing=="outside_window" {status="indexed";detail="Retained locally; outside the AI processing window."}
            else if row["route"] != nil || processing=="succeeded" {status="processed";detail=analysis=="waiting" ? "Source classification finished. Deeper analysis is waiting.":analysis=="failed" ? "Source classification finished. Deeper analysis needs retry.":"Source processing finished."}
            else {status="waiting";detail="Waiting for source classification."}
            return HistoryInboxItem(id:id,connector:row["connector"]!,sender:Self.historyBound(sender,200),subject:Self.historyBound(subject,240),preview:Self.historyBound(body.split(whereSeparator:{$0.isWhitespace}).joined(separator:" "),280),status:status,statusDetail:detail,occurredAt:Date(timeIntervalSince1970:Double(row["occurred_at"]!)!),analysisStatus:analysis,tags:(tags[id] ?? []).sorted().prefix(8).compactMap{tag in names[tag].map{HistoryInboxTag(id:tag,name:Self.historyBound($0,80))}})
        }
        let last=visible.last
        let next=rows.count>limit ? last.map{HistoryInboxCursor(occurredAt:Date(timeIntervalSince1970:Double($0["occurred_at"]!)!),eventID:$0["id"]!,snapshotRowID:watermark,connector:connector)}:nil
        let sources=try db.rows("SELECT connector,COUNT(*) AS n FROM events WHERE rowid<=? GROUP BY connector ORDER BY connector",[String(watermark)]).map{HistoryInboxSource(connector:$0["connector"]!,name:Self.historyConnectorName($0["connector"]!),count:Int($0["n"]!)!)}
        let total=sources.filter{connector==nil || $0.connector==connector}.reduce(0){$0+$1.count}
        return HistoryInboxPage(items:items,nextCursor:next,total:total,sources:sources)
    }
    /// Resolve only the handful of matched rows, without decoding all suggestions
    /// or copying their source bodies into the inbox payload.
    private func historyTaskMetadata(_ nodeID:String) throws -> [String:String]? {
        var current=nodeID,seen=Set<String>()
        while seen.insert(current).inserted && seen.count<=32 {
            if let link=try db.rows("SELECT json_extract(json,'$.primaryID') AS id FROM task_relations WHERE duplicate_id=?",[current]).first?["id"] {current=link;continue}
            if current.hasPrefix("task:") {return try db.rows("SELECT json_extract(json,'$.status') AS status,json_extract(json,'$.activityIDs') AS tags FROM life_tasks WHERE id=?",[String(current.dropFirst(5))]).first}
            guard current.hasPrefix("source:"),let row=try db.rows("SELECT json_extract(json,'$.reviewStatus') AS review,json_extract(json,'$.acceptedTaskID') AS accepted,json_extract(json,'$.linkedTaskID') AS linked,json_extract(json,'$.candidate.status') AS status,json_extract(json,'$.candidate.activityIDs') AS tags FROM task_suggestions WHERE id=?",[String(current.dropFirst(7))]).first,["pending","accepted"].contains(row["review"] ?? "") else {return nil}
            if let task=row["accepted"] ?? row["linked"] {current="task:"+task;continue}
            return row["review"]=="pending" ? row:nil
        }
        return nil
    }
    private static func historyBound(_ text:String,_ bytes:Int)->String {
        var output="",count=0
        for scalar in text.unicodeScalars {guard count+scalar.utf8.count<=bytes else {break};output.unicodeScalars.append(scalar);count+=scalar.utf8.count}
        return output
    }
    private static func historyConnectorName(_ connector:String)->String {
        switch connector {case "gmail":return "Gmail";case "imessage":return "Messages";case "home_assistant":return "Home Assistant";case "apple_calendar":return "Apple Calendar";case "google_calendar":return "Google Calendar";case "apple_contacts":return "Apple Contacts";case "google_contacts":return "Google Contacts";case "notes","notebook":return "Notebook";default:return connector.replacingOccurrences(of:"_",with:" ")}
    }
}
