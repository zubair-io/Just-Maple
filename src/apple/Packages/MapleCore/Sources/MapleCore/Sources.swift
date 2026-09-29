import Foundation
import CryptoKit

public struct SourceQuery: Codable, Sendable {
    public var types:[String]=[], connectors:[String]=[], accounts:[String]=[], states:[String]=[]
    public var receivedAfter:Date?, receivedBefore:Date?, text:String?
    public init(types:[String]=[],connectors:[String]=[],accounts:[String]=[],states:[String]=[],receivedAfter:Date?=nil,receivedBefore:Date?=nil,text:String?=nil) {self.types=types;self.connectors=connectors;self.accounts=accounts;self.states=states;self.receivedAfter=receivedAfter;self.receivedBefore=receivedBefore;self.text=text}
    enum CodingKeys:String,CodingKey {case types,connectors,accounts,states,receivedAfter,receivedBefore,text}
    public init(from decoder:Decoder)throws {let c=try decoder.container(keyedBy:CodingKeys.self);types=try c.decodeIfPresent([String].self,forKey:.types) ?? [];connectors=try c.decodeIfPresent([String].self,forKey:.connectors) ?? [];accounts=try c.decodeIfPresent([String].self,forKey:.accounts) ?? [];states=try c.decodeIfPresent([String].self,forKey:.states) ?? [];receivedAfter=try c.decodeIfPresent(Date.self,forKey:.receivedAfter);receivedBefore=try c.decodeIfPresent(Date.self,forKey:.receivedBefore);text=try c.decodeIfPresent(String.self,forKey:.text)}
}
public struct SourceCursor:Codable,Sendable {public let sessionID:String;public let offset:Int;public let fingerprint:String}
public struct SourceRow:Codable,Sendable {
    public let id:String,type:String,connector:String,account:String,externalID:String,revision:String,sender:String,subject:String,preview:String,status:String,statusDetail:String
    public let occurredAt:Date,receivedAt:Date
    public let stateVersion:Int64
    public let classificationState:String,analysisState:String
    public let observedState:String?
    public var attentionReason:String? = nil
    public var calendar:CalendarSourcePresentation? = nil
    public var direction:String? = nil
}
public struct SourceFacets:Codable,Sendable {public let types:[String],connectors:[String],accounts:[String],states:[String]}
public struct SourcePage:Codable,Sendable {public let schemaVersion:Int;public let items:[SourceRow];public let nextCursor:SourceCursor?;public let total:Int;public let asOf:Date;public let hasMoreMatches:Bool;public let facets:SourceFacets}
public struct SourceStage:Codable,Sendable {public let stage:String,state:String;public let version:Int64;public let attemptID:String?,reason:String?;public var relatedEventID:String?=nil}
public struct SourceArtifactSummary:Codable,Sendable {public let id:String,stage:String,kind:String,availability:String,mediaType:String;public let byteCount:Int;public let legacy:Bool;public var attemptID:String?=nil;public var provider:String?=nil;public var model:String?=nil}
public struct SourceAttempt:Codable,Sendable {public let id:String,stage:String;public let parentAttemptID:String?,provider:String?,model:String?;public let startedAt:Date,endedAt:Date?;public let transportOutcome:String,commitOutcome:String}
public struct SourceDetail:Codable,Sendable {public let schemaVersion:Int;public let row:SourceRow;public let content:String;public let truncated:Bool;public let subjects:[String];public let stages:[SourceStage];public let attempts:[SourceAttempt];public let artifacts:[SourceArtifactSummary];public let relatedRevisions:[String];public let backlinks:[ManagedSourceBacklink];public let historyAvailability:String;public let asOf:Date}
public struct SourceTransition:Codable,Sendable {public let sequence:Int64;public let eventID:String,stage:String;public let fromState:String?;public let toState:String;public let attemptID:String?,reason:String?;public let at:Date;public var relatedEventID:String?=nil;public var artifacts:[SourceArtifactSummary]=[]}
public struct SourceHistoryPage:Codable,Sendable {public let items:[SourceTransition];public let nextSequence:Int64?}
public struct SourceArtifactPage:Codable,Sendable {public let id:String,availability:String,content:String;public let offset:Int,totalBytes:Int;public let complete:Bool;public let nextOffset:Int?}
public struct SourceRetryResult:Codable,Sendable {public let commandID:String,eventID:String,stage:String,status:String;public let stateVersion:Int64}

extension SQLite {
    func migrateSources() throws {
        try transaction {
            try execute("CREATE TABLE IF NOT EXISTS source_audit_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
            try execute("INSERT OR IGNORE INTO source_audit_metadata VALUES ('started_at',?)",[String(Date().timeIntervalSince1970)])
            try execute("CREATE TABLE IF NOT EXISTS source_transitions(sequence INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,stage TEXT NOT NULL,from_state TEXT,to_state TEXT NOT NULL,attempt_id TEXT,reason TEXT,at REAL NOT NULL,related_event_id TEXT)")
            if !((try rows("PRAGMA table_info(source_transitions)")).contains{$0["name"]=="related_event_id"}) {try execute("ALTER TABLE source_transitions ADD COLUMN related_event_id TEXT")}
            try execute("CREATE INDEX IF NOT EXISTS source_transitions_event ON source_transitions(event_id,sequence DESC)")
            try execute("CREATE TABLE IF NOT EXISTS source_attempts(id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,stage TEXT NOT NULL,started_at REAL NOT NULL,ended_at REAL,transport_outcome TEXT NOT NULL DEFAULT 'unknown',commit_outcome TEXT NOT NULL DEFAULT 'pending',provider TEXT,model TEXT,parent_id TEXT)")
            if !((try rows("PRAGMA table_info(source_attempts)")).contains{$0["name"]=="parent_id"}) {try execute("ALTER TABLE source_attempts ADD COLUMN parent_id TEXT")}
            try execute("CREATE TABLE IF NOT EXISTS source_artifacts(id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,attempt_id TEXT,stage TEXT NOT NULL,kind TEXT NOT NULL,media_type TEXT NOT NULL,payload TEXT,byte_count INTEGER NOT NULL,availability TEXT NOT NULL,legacy INTEGER NOT NULL DEFAULT 0,UNIQUE(event_id,attempt_id,kind))")
            try execute("CREATE TABLE IF NOT EXISTS source_retry_commands(id TEXT PRIMARY KEY,payload TEXT NOT NULL,result TEXT NOT NULL)")
            try execute("CREATE INDEX IF NOT EXISTS sources_received_order ON events(received_at DESC,id DESC)")
            try execute("CREATE INDEX IF NOT EXISTS sources_connector_account ON events(connector,account,received_at DESC,id DESC)")
            try execute("CREATE INDEX IF NOT EXISTS sources_event_type ON events(json_extract(json,'$.type'))")
            try execute("CREATE INDEX IF NOT EXISTS sources_account ON events(account)")
            // Queue triggers participate in their caller's transaction, including bulk skip/retry paths.
            for (table,stage,token,active) in [("processing_jobs","classification","lease_token","leased"),("fact_jobs","facts","lease_token","leased"),("task_extraction_jobs","tasks","lease_token","processing"),("state_jobs","state","token","running")] {
                try execute("DROP TRIGGER IF EXISTS source_\(stage)_insert")
                try execute("DROP TRIGGER IF EXISTS source_\(stage)_update")
                try execute("""
                CREATE TRIGGER IF NOT EXISTS source_\(stage)_insert AFTER INSERT ON \(table) BEGIN
                INSERT INTO source_transitions(event_id,stage,to_state,reason,at) VALUES(NEW.event_id,'\(stage)',NEW.status,'scheduled',((julianday('now')-2440587.5)*86400.0));
                END
                """)
                try execute("""
                CREATE TRIGGER IF NOT EXISTS source_\(stage)_update AFTER UPDATE ON \(table)
                WHEN OLD.status<>NEW.status OR OLD.\(token) IS NOT NEW.\(token) OR OLD.attempts<>NEW.attempts BEGIN
                INSERT INTO source_transitions(event_id,stage,from_state,to_state,attempt_id,reason,at,related_event_id)
                VALUES(NEW.event_id,'\(stage)',OLD.status,NEW.status,COALESCE(NEW.\(token),OLD.\(token)),CASE WHEN OLD.status='\(active)' AND NEW.status='\(active)' THEN 'lease_recovered_outcome_unknown' WHEN NEW.status IN ('outside_window','coalesced') THEN NEW.status WHEN NEW.status IN ('failed','blocked') THEN 'provider_or_validation_failed' WHEN OLD.status='\(active)' AND NEW.status='pending' THEN 'retry_or_discard' WHEN OLD.status IN ('failed','blocked') AND NEW.status='pending' THEN 'manual_retry' ELSE 'queue_transition' END,((julianday('now')-2440587.5)*86400.0),CASE WHEN NEW.status='coalesced' AND NEW.error LIKE 'Indexed locally; cumulative energy increment superseded by observation %' THEN substr(NEW.error,72) ELSE NULL END);
                UPDATE source_attempts SET ended_at=COALESCE(ended_at,((julianday('now')-2440587.5)*86400.0)),commit_outcome=CASE WHEN commit_outcome='invalid' THEN 'invalid' WHEN NEW.status IN ('succeeded','done') THEN 'committed' WHEN NEW.status IN ('failed','blocked') OR NEW.error IS NOT NULL THEN 'failed' ELSE 'interrupted_or_discarded' END WHERE (id=OLD.\(token) OR id LIKE OLD.\(token)||':%') AND OLD.status='\(active)' AND (NEW.status<>'\(active)' OR OLD.\(token) IS NOT NEW.\(token));
                INSERT OR IGNORE INTO source_attempts(id,event_id,stage,started_at) SELECT NEW.\(token),NEW.event_id,'\(stage)',((julianday('now')-2440587.5)*86400.0) WHERE NEW.status='\(active)' AND NEW.\(token) IS NOT NULL;
                END
                """)
            }
            // Sessions are ephemeral, window-bounded and never persist a second copy of source bodies.
            try execute("CREATE TEMP TABLE IF NOT EXISTS source_query_sessions(id TEXT PRIMARY KEY,window_id TEXT,fingerprint TEXT,created_at REAL,total INTEGER,capped INTEGER,facets TEXT)")
            try execute("CREATE TEMP TABLE IF NOT EXISTS source_query_rows(session_id TEXT,position INTEGER,id TEXT,connector TEXT,account TEXT,external_id TEXT,revision TEXT,occurred_at REAL,received_at REAL,type TEXT,excerpt TEXT,aggregate_state TEXT,state_version INTEGER,classification_status TEXT,facts_status TEXT,tasks_status TEXT,state_status TEXT,PRIMARY KEY(session_id,position))")
            try execute("CREATE TEMP TABLE IF NOT EXISTS source_query_facets(id INTEGER PRIMARY KEY,watermark INTEGER,event_count INTEGER,json TEXT)")
        }
    }
}

extension KnowledgeStore {
    private static let sourceStateSQL="""
    CASE WHEN p.status IN ('failed','blocked') OR f.status IN ('failed','blocked') OR t.status IN ('failed','blocked') OR s.status IN ('failed','blocked') THEN 'failed'
    WHEN p.status IN ('pending','leased') OR f.status IN ('pending','leased') OR t.status IN ('pending','processing') OR s.status IN ('pending','running') THEN 'pending'
    WHEN p.status IN ('coalesced','outside_window') THEN 'skipped'
    WHEN p.status='succeeded' THEN 'complete' ELSE 'not_run' END
    """
    private static let sourceSelect="""
    SELECT e.id,e.connector,e.account,e.external_id,e.revision,e.occurred_at,e.received_at,json_extract(e.json,'$.type') AS type,substr(json_extract(e.json,'$.content'),1,768) AS excerpt,
    \(sourceStateSQL) AS aggregate_state,(SELECT COALESCE(MAX(sequence),0) FROM source_transitions WHERE event_id IN (e.id,h.batch_id)) AS state_version,CASE WHEN h.batch_id IS NOT NULL THEN 'batched' ELSE p.status END AS classification_status,f.status AS facts_status,t.status AS tasks_status,s.status AS state_status
    FROM events e LEFT JOIN home_batch_members h ON h.event_id=e.id LEFT JOIN processing_jobs p ON p.event_id=COALESCE(h.batch_id,e.id) LEFT JOIN fact_jobs f ON f.event_id=COALESCE(h.batch_id,e.id) LEFT JOIN task_extraction_jobs t ON t.event_id=COALESCE(h.batch_id,e.id) LEFT JOIN state_jobs s ON s.event_id=COALESCE(h.batch_id,e.id)
    """
    private func sourceRow(_ row:[String:String],preview:String?=nil,attentionReason:String?=nil,calendar:CalendarSourcePresentation?=nil)->SourceRow {
        let lines=(row["excerpt"] ?? "").components(separatedBy:"\n")
        func field(_ name:String)->String? {lines.prefix(20).first{$0.hasPrefix(name+": ")}.map{String($0.dropFirst(name.count+2))}}
        let body=lines.firstIndex(where:{$0=="Body:" || $0=="Body (snippet only):"}).map{lines.dropFirst($0+1).joined(separator:" ")} ?? lines.filter{!$0.hasPrefix("Sender:") && !$0.hasPrefix("Subject:")}.joined(separator:" ")
        let state=row["aggregate_state"] ?? "not_run"
        let batched=row["classification_status"]=="batched"
        let detail=batched ? ["failed":"The Home Assistant batch needs retry. Open this source’s classification stage, then its HA batch.","pending":"Processing together in one Home Assistant batch.","complete":"Processed together in one Home Assistant batch. Open the batch to inspect its response.","skipped":"The Home Assistant batch was skipped; open it for details.","not_run":"Retained in a Home Assistant batch; no classification is scheduled."][state]! : ["failed":"An applicable processing stage needs retry.","pending":"Processing is queued, running or retrying.","complete":"All scheduled processing stages completed.","skipped":"Classification was explicitly skipped; see stage history.","not_run":"No classification is scheduled."][state]!
        let deeper=[row["facts_status"],row["tasks_status"],row["state_status"]].compactMap{$0}
        let analysis=deeper.contains(where:{["failed","blocked"].contains($0)}) ? "failed":deeper.contains(where:{["pending","leased","processing","running"].contains($0)}) ? "pending":deeper.isEmpty ? ((row["classification_status"]=="succeeded" || (batched && state=="complete")) ? "not_needed":"not_scheduled"):deeper.allSatisfy({["outside_window","coalesced","superseded"].contains($0)}) ? "skipped":"complete"
        return SourceRow(id:row["id"]!,type:row["type"] ?? "unknown",connector:row["connector"]!,account:row["account"]!,externalID:row["external_id"]!,revision:row["revision"]!,sender:String((field("Sender") ?? field("From") ?? row["connector"]!).prefix(200)),subject:String((field("Subject") ?? field("Title") ?? row["type"] ?? "Source").prefix(240)),preview:preview ?? String(body.prefix(280)),status:state,statusDetail:detail,occurredAt:Date(timeIntervalSince1970:Double(row["occurred_at"]!)!),receivedAt:Date(timeIntervalSince1970:Double(row["received_at"]!)!),stateVersion:Int64(row["state_version"]!)!,classificationState:row["classification_status"] ?? "not_scheduled",analysisState:analysis,observedState:row["connector"]=="home_assistant" ? field("State"):nil,attentionReason:attentionReason,calendar:calendar,direction:field("Direction"))
    }
    public func sourceList(query:SourceQuery=SourceQuery(),cursor:SourceCursor?=nil,limit:Int=60,windowID:String="main",now:Date=Date()) throws -> SourcePage {
        guard (1...100).contains(limit),windowID.utf8.count<=128,now.timeIntervalSince1970.isFinite else {throw MapleError.invalid("Invalid source query.")}
        for values in [query.types,query.connectors,query.accounts,query.states] {guard values.count<=32,values.allSatisfy({!$0.isEmpty && $0.utf8.count<=256}) else {throw MapleError.invalid("Invalid source filters.")}}
        guard Set(query.states).isSubset(of:["failed","pending","complete","skipped","not_run"]),(query.text?.utf8.count ?? 0)<=512,query.receivedAfter?.timeIntervalSince1970.isFinite ?? true,query.receivedBefore?.timeIntervalSince1970.isFinite ?? true else {throw MapleError.invalid("Invalid source filters.")}
        if let a=query.receivedAfter,let b=query.receivedBefore,a>b {throw MapleError.invalid("Invalid source date interval.")}
        var normalized=query;normalized.types=Array(Set(query.types)).sorted();normalized.connectors=Array(Set(query.connectors)).sorted();normalized.accounts=Array(Set(query.accounts)).sorted();normalized.states=Array(Set(query.states)).sorted();normalized.text=query.text?.trimmingCharacters(in:.whitespacesAndNewlines)
        let fingerprint=SHA256.hash(data:try JSONCodec.encode(normalized)).map{String(format:"%02x",$0)}.joined()
        try db.execute("DELETE FROM source_query_rows WHERE session_id IN (SELECT id FROM source_query_sessions WHERE created_at<?)",[String(now.addingTimeInterval(-600).timeIntervalSince1970)])
        try db.execute("DELETE FROM source_query_sessions WHERE created_at<?",[String(now.addingTimeInterval(-600).timeIntervalSince1970)])
        let id:String,offset:Int
        if let cursor {
            guard cursor.offset>=0,cursor.offset<=50000,cursor.fingerprint==fingerprint,let session=try db.rows("SELECT id FROM source_query_sessions WHERE id=? AND fingerprint=? AND window_id=?",[cursor.sessionID,fingerprint,windowID]).first else {throw MapleError.invalid("queryExpired: refresh Sources to continue.")}
            id=session["id"]!;offset=cursor.offset
        } else {
            id=UUID().uuidString;offset=0
            try db.transaction {
                var whereSQL="1=1",args=[String?]()
                for (column,values) in [("json_extract(e.json,'$.type')",normalized.types),("e.connector",normalized.connectors),("e.account",normalized.accounts),(Self.sourceStateSQL,normalized.states)] where !values.isEmpty {whereSQL += " AND \(column) IN ("+Array(repeating:"?",count:values.count).joined(separator:",")+")";args += values}
                if let date=query.receivedAfter {whereSQL += " AND e.received_at>=?";args.append(String(date.timeIntervalSince1970))}
                if let date=query.receivedBefore {whereSQL += " AND e.received_at<=?";args.append(String(date.timeIntervalSince1970))}
                if let text=normalized.text,!text.isEmpty {whereSQL += " AND e.id IN (SELECT event_id FROM events_fts WHERE events_fts MATCH ?)";args.append("\""+text.replacingOccurrences(of:"\"",with:"\"\"")+"\"")}
                // Materialize entirely inside SQLite: only the requested page enters Swift memory.
                try db.execute("INSERT INTO source_query_rows SELECT ?,ROW_NUMBER() OVER (ORDER BY received_at DESC,id DESC)-1,snapshot.* FROM ("+Self.sourceSelect+" WHERE "+whereSQL+" ORDER BY e.received_at DESC,e.id DESC LIMIT 50001) snapshot",[id]+args)
                let count=Int(try db.rows("SELECT COUNT(*) AS n FROM source_query_rows WHERE session_id=?",[id]).first!["n"]!)!
                try db.execute("DELETE FROM source_query_rows WHERE session_id=? AND position>=50000",[id])
                let watermark=try db.rows("SELECT COALESCE(MAX(rowid),0) AS watermark,COUNT(*) AS n FROM events").first!
                let facets:SourceFacets
                if let cached=try db.rows("SELECT json FROM source_query_facets WHERE id=1 AND watermark=? AND event_count=?",[watermark["watermark"],watermark["n"]]).first {
                    facets=try JSONCodec.decode(SourceFacets.self,from:Data(cached["json"]!.utf8))
                } else {
                    // Corpus facets remain switchable while a type/account filter is active.
                    func facet(_ expression:String)throws->[String] {try db.rows("SELECT DISTINCT \(expression) AS value FROM events ORDER BY value LIMIT 256").compactMap{$0["value"]}}
                    facets=SourceFacets(types:try facet("json_extract(json,'$.type')"),connectors:try facet("connector"),accounts:try facet("account"),states:["pending","complete","failed","skipped","not_run"])
                    try db.execute("INSERT OR REPLACE INTO source_query_facets VALUES (1,?,?,?)",[watermark["watermark"],watermark["n"],try JSONCodec.string(facets)])
                }
                try db.execute("INSERT INTO source_query_sessions VALUES (?,?,?,?,?,?,?)",[id,windowID,fingerprint,String(now.timeIntervalSince1970),String(min(count,50000)),count>50000 ? "1":"0",try JSONCodec.string(facets)])
                let expired=try db.rows("SELECT id FROM source_query_sessions WHERE window_id=? ORDER BY rowid DESC LIMIT -1 OFFSET 4",[windowID])
                for row in expired {try db.execute("DELETE FROM source_query_rows WHERE session_id=?",[row["id"]]);try db.execute("DELETE FROM source_query_sessions WHERE id=?",[row["id"]])}
            }
        }
        guard let session=try db.rows("SELECT * FROM source_query_sessions WHERE id=?",[id]).first else {throw MapleError.invalid("queryExpired: refresh Sources to continue.")}
        let rows=try db.rows("SELECT * FROM source_query_rows WHERE session_id=? AND position>=? ORDER BY position LIMIT ?",[id,String(offset),String(limit)]).map{sourceRow($0)}
        let total=Int(session["total"]!)!,next=offset+rows.count
        return SourcePage(schemaVersion:1,items:rows,nextCursor:next<total ? SourceCursor(sessionID:id,offset:next,fingerprint:fingerprint):nil,total:total,asOf:Date(timeIntervalSince1970:Double(session["created_at"]!)!),hasMoreMatches:session["capped"]=="1",facets:try JSONCodec.decode(SourceFacets.self,from:Data(session["facets"]!.utf8)))
    }
    public func sourceDetail(eventID:String,now:Date=Date()) throws -> SourceDetail {
        guard let event=try event(eventID),var row=try db.rows(Self.sourceSelect+" WHERE e.id=?",[eventID]).first else {throw MapleError.invalid("Source not found.")}
        row["excerpt"] = String(event.content.prefix(64000))
        var stages=[SourceStage]()
        for (table,stage,token) in [("processing_jobs","classification","lease_token"),("fact_jobs","facts","lease_token"),("task_extraction_jobs","tasks","lease_token"),("state_jobs","state","token")] {
            let queue=try db.rows("SELECT status,\(token) AS token FROM \(table) WHERE event_id=?",[eventID]).first
            let last=try db.rows("SELECT * FROM source_transitions WHERE event_id=? AND stage=? ORDER BY sequence DESC LIMIT 1",[eventID,stage]).first
            if stage=="classification",let batchID=try db.rows("SELECT batch_id FROM home_batch_members WHERE event_id=?",[eventID]).first?["batch_id"] {
                stages.append(SourceStage(stage:stage,state:"batched",version:Int64(last?["sequence"] ?? "0")!,attemptID:nil,reason:"Classified together in one Home Assistant batch. Open the batch for its processing state, response and retry controls.",relatedEventID:batchID))
                continue
            }
            stages.append(SourceStage(stage:stage,state:queue?["status"] ?? (["facts","tasks"].contains(stage) && row["classification_status"]=="succeeded" ? "not_needed":"not_scheduled"),version:Int64(last?["sequence"] ?? "0")!,attemptID:queue?["token"] ?? last?["attempt_id"],reason:last?["reason"] ?? (queue==nil ? "No work was scheduled for this stage.":"legacy_latest_only"),relatedEventID:last?["related_event_id"]))
        }
        var artifacts=try db.rows("SELECT a.*,p.provider,p.model FROM source_artifacts a LEFT JOIN source_attempts p ON p.id=a.attempt_id WHERE a.event_id=? ORDER BY a.rowid DESC LIMIT 200",[eventID]).map{SourceArtifactSummary(id:$0["id"]!,stage:$0["stage"]!,kind:$0["kind"]!,availability:$0["availability"]!,mediaType:$0["media_type"]!,byteCount:Int($0["byte_count"]!)!,legacy:$0["legacy"]=="1",attemptID:$0["attempt_id"],provider:$0["provider"],model:$0["model"])}
        for (id,stage,kind,payload) in try legacySourceArtifacts(eventID) where !artifacts.contains(where:{$0.stage==stage && $0.kind==kind}) {artifacts.append(SourceArtifactSummary(id:id,stage:stage,kind:kind,availability:"available",mediaType:"application/json",byteCount:payload.utf8.count,legacy:id.hasPrefix("legacy:")))}
        let revisions=try db.rows("SELECT id FROM events WHERE connector=? AND account=? AND external_id=? ORDER BY received_at DESC,id DESC LIMIT 100",[event.source.connector,event.source.account,event.source.externalID]).compactMap{$0["id"]}
        let attempts=try db.rows("SELECT * FROM source_attempts WHERE event_id=? ORDER BY started_at DESC,id DESC LIMIT 100",[eventID]).map{SourceAttempt(id:$0["id"]!,stage:$0["stage"]!,parentAttemptID:$0["parent_id"],provider:$0["provider"],model:$0["model"],startedAt:Date(timeIntervalSince1970:Double($0["started_at"]!)!),endedAt:$0["ended_at"].flatMap(Double.init).map{Date(timeIntervalSince1970:$0)},transportOutcome:$0["transport_outcome"]!,commitOutcome:$0["commit_outcome"]!)}
        let ingestedWithAudit = !(try db.rows("SELECT sequence FROM source_transitions WHERE event_id=? AND stage='classification' AND from_state IS NULL AND reason='scheduled' LIMIT 1",[eventID])).isEmpty
        return SourceDetail(schemaVersion:1,row:sourceRow(row,preview:try homeBatchPreview(event),attentionReason:try sourceAttentionReason(eventID),calendar:CalendarSourcePresentation(event)),content:String(event.content.prefix(64000)),truncated:event.content.count>64000,subjects:event.subjects,stages:stages,attempts:attempts,artifacts:artifacts,relatedRevisions:revisions,backlinks:try managedSourceBacklinks(eventID:eventID),historyAvailability:ingestedWithAudit ? "recorded_since_ingestion":"legacy_latest_only_before_audit",asOf:now)
    }
    public func sourceHistory(eventID:String,beforeSequence:Int64?=nil,limit:Int=60)throws -> SourceHistoryPage {
        guard (1...100).contains(limit),try event(eventID) != nil,beforeSequence.map({$0>0}) ?? true else {throw MapleError.invalid("Invalid source history request.")}
        let rows=try db.rows("SELECT * FROM source_transitions WHERE event_id=? AND sequence<? ORDER BY sequence DESC LIMIT ?",[eventID,String(beforeSequence ?? Int64.max),String(limit+1)])
        var items=rows.prefix(limit).map{SourceTransition(sequence:Int64($0["sequence"]!)!,eventID:eventID,stage:$0["stage"]!,fromState:$0["from_state"],toState:$0["to_state"]!,attemptID:$0["attempt_id"],reason:$0["reason"],at:Date(timeIntervalSince1970:Double($0["at"]!)!),relatedEventID:$0["related_event_id"])}
        for i in items.indices {
            guard let attempt=items[i].attemptID else {continue}
            items[i].artifacts=try db.rows("SELECT a.*,p.provider,p.model FROM source_artifacts a LEFT JOIN source_attempts p ON p.id=a.attempt_id WHERE a.event_id=? AND (a.attempt_id=? OR a.attempt_id LIKE ? ESCAPE '!') ORDER BY a.rowid LIMIT 100",[eventID,attempt,attempt.replacingOccurrences(of:"!",with:"!!").replacingOccurrences(of:"%",with:"!%").replacingOccurrences(of:"_",with:"!_")+":%"]).map{SourceArtifactSummary(id:$0["id"]!,stage:$0["stage"]!,kind:$0["kind"]!,availability:$0["availability"]!,mediaType:$0["media_type"]!,byteCount:Int($0["byte_count"]!)!,legacy:$0["legacy"]=="1",attemptID:$0["attempt_id"],provider:$0["provider"],model:$0["model"])}
        }
        return SourceHistoryPage(items:items,nextSequence:rows.count>limit ? items.last?.sequence:nil)
    }
    private func legacySourceArtifacts(_ eventID:String)throws -> [(String,String,String,String)] {
        var items=[(String,String,String,String)]()
        if let original=try event(eventID) {items.append(("original:source","source","original",original.content))}
        if let row=try db.rows("SELECT raw_response,json_extract(json,'$.context') AS context FROM decisions WHERE event_id=?",[eventID]).first {if let raw=row["raw_response"] {items.append(("legacy:classification:response","classification","response",raw))};if let context=row["context"] {items.append(("legacy:classification:context","classification","context",context))}}
        if let raw=try db.rows("SELECT response FROM state_jobs WHERE event_id=?",[eventID]).first?["response"] {items.append(("legacy:state:response","state","response",raw))}
        return items
    }
    public func sourceArtifact(eventID:String,artifactID:String,offset:Int=0,limit:Int=65536)throws -> SourceArtifactPage {
        guard offset>=0,(1...65536).contains(limit),try event(eventID) != nil else {throw MapleError.invalid("Invalid artifact request.")}
        let payload:String,availability:String
        if let row=try db.rows("SELECT payload,availability FROM source_artifacts WHERE id=? AND event_id=?",[artifactID,eventID]).first {payload=row["payload"] ?? "";availability=row["availability"]!}
        else if let legacy=try legacySourceArtifacts(eventID).first(where:{$0.0==artifactID}) {payload=legacy.3;availability="available"}
        else {return SourceArtifactPage(id:artifactID,availability:"not_recorded",content:"",offset:offset,totalBytes:0,complete:false,nextOffset:nil)}
        let bytes=Array(payload.utf8);guard offset<=bytes.count,offset==bytes.count || bytes[offset]&0xC0 != 0x80 else {throw MapleError.invalid("Invalid artifact offset.")}
        var end=min(bytes.count,offset+limit);while end<bytes.count && end>offset && bytes[end]&0xC0==0x80 {end-=1}
        guard end>offset || end==bytes.count else {throw MapleError.invalid("Artifact page limit must fit a UTF-8 character.")}
        return SourceArtifactPage(id:artifactID,availability:availability,content:String(decoding:bytes[offset..<end],as:UTF8.self),offset:offset,totalBytes:bytes.count,complete:end==bytes.count && availability=="available",nextOffset:end<bytes.count ? end:nil)
    }
    /// Caller persists only actual provider data, never synthesized raw responses. Queue completion and artifacts share its transaction.
    func recordSourceArtifact(eventID:String,attemptID:String,stage:String,kind:String,payload:String,provider:String?=nil,model:String?=nil)throws {
        let id=SHA256.hash(data:Data((eventID+"\u{0}"+attemptID+"\u{0}"+kind).utf8)).map{String(format:"%02x",$0)}.joined()
        // Store full payload locally; reads are capped. A hard bounded ceiling is explicit, never silent truncation.
        let available=payload.utf8.count<=8*1024*1024
        try db.execute("INSERT OR IGNORE INTO source_artifacts(id,event_id,attempt_id,stage,kind,media_type,payload,byte_count,availability) VALUES (?,?,?,?,?,'application/json',?,?,?)",[id,eventID,attemptID,stage,kind,available ? payload:nil,String(payload.utf8.count),available ? "available":"not_recorded_size_limit"])
        try db.execute("UPDATE source_attempts SET transport_outcome=CASE WHEN ?='response' THEN 'response_received' ELSE transport_outcome END,provider=COALESCE(?,provider),model=COALESCE(?,model) WHERE id=?",[kind,provider,model,attemptID])
    }
    public func sourceRetry(commandID:String,eventID:String,stage:String,expectedVersion:Int64,now:Date=Date())throws -> SourceRetryResult {
        guard !commandID.isEmpty,commandID.utf8.count<=128,expectedVersion>=0,now.timeIntervalSince1970.isFinite else {throw MapleError.invalid("Invalid retry command.")}
        let tables=["classification":"processing_jobs","facts":"fact_jobs","tasks":"task_extraction_jobs","state":"state_jobs"]
        guard let table=tables[stage] else {throw MapleError.invalid("Unknown processing stage.")}
        let payload=try JSONCodec.string([eventID,stage,String(expectedVersion)])
        return try db.transaction {
            if let old=try db.rows("SELECT payload,result FROM source_retry_commands WHERE id=?",[commandID]).first {guard old["payload"]==payload else {throw MapleError.invalid("Retry command ID reused with different payload.")};return try JSONCodec.decode(SourceRetryResult.self,from:Data(old["result"]!.utf8))}
            guard let event=try event(eventID) else {throw MapleError.invalid("Source not found.")};try AIProcessingWindow.require(event,at:now)
            let version=Int64(try db.rows("SELECT COALESCE(MAX(sequence),0) AS n FROM source_transitions WHERE event_id=?",[eventID]).first!["n"]!)!
            guard version==expectedVersion else {throw MapleError.invalid("Source state changed. Refresh before retrying.")}
            guard let job=try db.rows("SELECT status,error FROM \(table) WHERE event_id=?",[eventID]).first,["failed","blocked"].contains(job["status"] ?? "") || (job["status"]=="pending" && job["error"] != nil) else {throw MapleError.invalid("Stage is not eligible for retry.")}
            if stage=="state" {try db.execute("UPDATE state_jobs SET status='pending',attempts=0,error=NULL,token=NULL WHERE event_id=?",[eventID])}
            else {try db.execute("UPDATE \(table) SET status='pending',attempts=0,error=NULL,lease_token=NULL,lease_until=NULL,next_attempt_at=? WHERE event_id=?",[String(now.timeIntervalSince1970),eventID])}
            if stage=="facts" {try db.execute("UPDATE work_items SET status='pending' WHERE event_id=? AND kind='extract_facts'",[eventID])}
            if stage=="tasks" {try db.execute("UPDATE task_extraction_jobs SET error_code=NULL WHERE event_id=?",[eventID])}
            let updated=Int64(try db.rows("SELECT COALESCE(MAX(sequence),0) AS n FROM source_transitions WHERE event_id=?",[eventID]).first!["n"]!)!
            let result=SourceRetryResult(commandID:commandID,eventID:eventID,stage:stage,status:"pending",stateVersion:updated)
            try db.execute("INSERT INTO source_retry_commands VALUES (?,?,?)",[commandID,payload,try JSONCodec.string(result)])
            return result
        }
    }
}
