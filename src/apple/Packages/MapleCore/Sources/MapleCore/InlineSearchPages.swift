import Foundation

public struct InlineSearchCursor:Codable,Sendable {
    public let runID:String
    public let offset:Int
    public let fingerprint:String
    public init(runID:String,offset:Int,fingerprint:String) {self.runID=runID;self.offset=offset;self.fingerprint=fingerprint}
}
public struct InlineSearchPageItem:Codable,Sendable {
    public let eventID:String
    public let availability:String
    public let reason:String?
    public var type:String?=nil,connector:String?=nil,account:String?=nil,title:String?=nil,excerpt:String?=nil
    public var receivedAt:Date?=nil,occurredAt:Date?=nil
}
public struct InlineSearchPage:Codable,Sendable {
    public let schemaVersion:Int
    public let runID:String
    public let availability:String
    public let message:String?
    public let intent:InlineSearchIntent?
    public let items:[InlineSearchPageItem]
    public let total:Int
    public let capturedCount:Int
    public let offset:Int
    public let nextCursor:InlineSearchCursor?
    public let hasMoreMatches:Bool
    public let asOf:Date
}

extension KnowledgeStore {
    func ensureInlineSearchSchema() throws {
        try db.execute("CREATE TABLE IF NOT EXISTS inline_search_snapshots (run_id TEXT PRIMARY KEY REFERENCES inline_maple_runs(id) ON DELETE CASCADE,intent_json TEXT NOT NULL,fingerprint TEXT NOT NULL,total INTEGER NOT NULL,captured_count INTEGER NOT NULL,senders_json TEXT NOT NULL,captured_at REAL NOT NULL)")
        // IDs survive source removal so a page can report missing evidence honestly.
        try db.execute("CREATE TABLE IF NOT EXISTS inline_search_rows (run_id TEXT NOT NULL REFERENCES inline_search_snapshots(run_id) ON DELETE CASCADE,position INTEGER NOT NULL,event_id TEXT NOT NULL,PRIMARY KEY(run_id,position),UNIQUE(run_id,event_id))")
    }

    /// Called inside the original search transaction, before any answer-provider
    /// request. Result identity and eligibility never follow later source revisions.
    func captureInlineSourceSearch(runID:String,intent:InlineSearchIntent,filter:String,args:[String?],total:Int,senders:[String]) throws {
        let run=try inlineMapleRun(runID)
        guard run.status == "running" else {throw MapleError.invalid("Only a running Maple request can capture source search results.")}
        let intentJSON=try JSONCodec.string(intent),capturedAt=Date()
        let fingerprint=ManagedMarkdown.hash(runID+"\n"+intentJSON+"\n"+String(capturedAt.timeIntervalSince1970))
        try db.execute("INSERT INTO inline_search_snapshots VALUES (?,?,?,?,?,?,?)",[runID,intentJSON,fingerprint,String(total),String(min(total,5000)),try JSONCodec.string(senders),String(capturedAt.timeIntervalSince1970)])
        try db.execute("INSERT INTO inline_search_rows SELECT ?,ROW_NUMBER() OVER (ORDER BY e.received_at DESC,e.id DESC)-1,e.id FROM events e WHERE "+filter+" ORDER BY e.received_at DESC,e.id DESC LIMIT 5000",[runID]+args)
    }

    func capturedInlineSourceSearch(runID:String,intent:InlineSearchIntent,limit:Int) throws -> InlineSourceSearch? {
        guard let snapshot=try db.rows("SELECT * FROM inline_search_snapshots WHERE run_id=?",[runID]).first else{return nil}
        guard snapshot["intent_json"] == (try JSONCodec.string(intent)) else {throw MapleError.invalid("This Maple run already captured a different source search.")}
        let rows=try db.rows("SELECT e.json FROM inline_search_rows r LEFT JOIN events e ON e.id=r.event_id WHERE r.run_id=? ORDER BY r.position LIMIT ?",[runID,String(max(1,min(limit,25)))])
        guard rows.allSatisfy({$0["json"] != nil}) else {throw MapleError.invalid("Some captured search evidence is no longer available. Its run history is retained.")}
        return InlineSourceSearch(events:try rows.map{try JSONCodec.decode(Event.self,from:Data($0["json"]!.utf8))},total:Int(snapshot["total"]!)!,senders:try JSONCodec.decode([String].self,from:Data(snapshot["senders_json"]!.utf8)))
    }

    /// Paging never calls a model, changes a run, reapplies a response, or reruns
    /// the search. It reads only the immutable result identities captured earlier.
    public func inlineSearchPage(runID:String,cursor:InlineSearchCursor?=nil) throws -> InlineSearchPage {
        let run=try inlineMapleRun(runID)
        guard let snapshot=try db.rows("SELECT * FROM inline_search_snapshots WHERE run_id=?",[runID]).first else {
            guard cursor == nil else {throw MapleError.invalid("This source-search cursor is unavailable for the selected Maple run.")}
            return InlineSearchPage(schemaVersion:1,runID:runID,availability:"not_recorded",message:"A pageable source-search snapshot was not recorded for this request. Its original response and evidence remain in run history.",intent:nil,items:[],total:run.total,capturedCount:0,offset:0,nextCursor:nil,hasMoreMatches:false,asOf:run.createdAt)
        }
        let count=Int(snapshot["captured_count"]!)!,total=Int(snapshot["total"]!)!,fingerprint=snapshot["fingerprint"]!
        let offset=cursor?.offset ?? 0
        guard offset>=0,offset<=count,offset%25 == 0,cursor == nil || (cursor?.runID == runID && cursor?.fingerprint == fingerprint) else {throw MapleError.invalid("This source-search cursor does not belong to the selected Maple results.")}
        let intent=try JSONCodec.decode(InlineSearchIntent.self,from:Data(snapshot["intent_json"]!.utf8))
        let rows=try db.rows("SELECT r.event_id,e.json FROM inline_search_rows r LEFT JOIN events e ON e.id=r.event_id WHERE r.run_id=? AND r.position>=? ORDER BY r.position LIMIT 25",[runID,String(offset)])
        let items=try rows.map {row -> InlineSearchPageItem in
            let id=row["event_id"]!
            guard let json=row["json"] else{return InlineSearchPageItem(eventID:id,availability:"missing",reason:"This captured source is no longer available locally.")}
            let event=try JSONCodec.decode(Event.self,from:Data(json.utf8))
            let lines=event.content.components(separatedBy:"\n").prefix(20)
            let heading=lines.first(where:{$0.hasPrefix("Subject: ") || $0.hasPrefix("Title: ")})
            let title=heading.map{String($0.dropFirst($0.hasPrefix("Subject: ") ? 9:7))} ?? event.type
            return InlineSearchPageItem(eventID:id,availability:"available",reason:nil,type:event.type,connector:event.source.connector,account:event.source.account,title:Self.utf8Excerpt(title,limit:240),excerpt:Self.utf8Excerpt(event.content,limit:500),receivedAt:event.receivedAt,occurredAt:event.occurredAt)
        }
        let next=offset+rows.count
        return InlineSearchPage(schemaVersion:1,runID:runID,availability:"available",message:total>count ? "Only the first 5,000 matches were captured. Narrow the request to inspect additional matches.":nil,intent:intent,items:items,total:total,capturedCount:count,offset:offset,nextCursor:next<count ? InlineSearchCursor(runID:runID,offset:next,fingerprint:fingerprint):nil,hasMoreMatches:total>count,asOf:Date(timeIntervalSince1970:Double(snapshot["captured_at"]!)!))
    }
}
