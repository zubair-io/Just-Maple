import Foundation
import NaturalLanguage
import Accelerate

extension SQLite {
    func migrateIntelligence() throws {
        guard try rows("PRAGMA user_version").first?["user_version"] != "8" else { return }
        try transaction {
            try execute("CREATE TABLE IF NOT EXISTS embedding_jobs(event_id TEXT PRIMARY KEY REFERENCES events(id), status TEXT NOT NULL DEFAULT 'pending', error TEXT)")
            try execute("CREATE TABLE IF NOT EXISTS semantic_chunks(event_id TEXT REFERENCES events(id), ordinal INTEGER, model TEXT NOT NULL, dimensions INTEGER NOT NULL, vector TEXT NOT NULL, PRIMARY KEY(event_id,ordinal))")
            try execute("CREATE TABLE IF NOT EXISTS state_jobs(event_id TEXT PRIMARY KEY REFERENCES events(id), status TEXT NOT NULL DEFAULT 'pending', token TEXT, lease_until REAL, attempts INTEGER NOT NULL DEFAULT 0, error TEXT, response TEXT)")
            try execute("INSERT OR IGNORE INTO embedding_jobs(event_id) SELECT id FROM events")
            try execute("PRAGMA user_version = 8")
        }
    }
}

public struct LocalIndexStatus: Codable, Sendable {
    public var indexed:Int
    public var pending:Int
    public var failed:Int
    public var chunks:Int
    public var statePending:Int
    public var stateFailed:Int
    public var stateCompleted:Int
    public var model:String
}

/// Native on-device sentence embeddings. No network provider or lexical fallback.
public enum LocalEmbedding {
    public static let revision = NLEmbedding.currentSentenceEmbeddingRevision(for: .english)
    public static var model:String { "apple-nl-sentence-en-r\(revision)" }
    public static func vector(_ text:String) throws -> [Float] {try vectors([text])[0]}
    static func vectors(_ texts:[String]) throws -> [[Float]] {
        guard let embedding=NLEmbedding.sentenceEmbedding(for:.english, revision:revision) else {
            throw MapleError.provider("The English on-device embedding model is unavailable.")
        }
        return try texts.map { text in
            guard let raw=embedding.vector(for:text),!raw.isEmpty else {throw MapleError.provider("The English on-device embedding model is unavailable.")}
            let norm=sqrt(raw.reduce(0){$0+$1*$1})
            guard norm.isFinite,norm>0 else {throw MapleError.provider("Invalid local embedding.")}
            return raw.map {Float($0/norm)}
        }
    }
    public static func chunks(_ text:String)->[String] {
        // Overlapping bounded windows; no truncation of long source documents.
        let words=text.split(whereSeparator:{$0.isWhitespace})
        guard !words.isEmpty else {return []}
        return stride(from:0,to:words.count,by:160).map { words[$0..<min($0+200,words.count)].joined(separator:" ") }
    }
    static func encode(_ vector:[Float])->String {
        vector.withUnsafeBytes {Data($0).base64EncodedString()}
    }
    static func decode(_ text:String)->[Float] {
        guard let data=Data(base64Encoded:text),data.count % 4 == 0 else {return []}
        return data.withUnsafeBytes { bytes in stride(from:0,to:bytes.count,by:4).map { bytes.loadUnaligned(fromByteOffset:$0,as:Float.self) } }
    }
}

extension KnowledgeStore {
    public func indexStatus() throws -> LocalIndexStatus {
        func count(_ sql:String)throws->Int {Int(try db.rows(sql).first?["n"] ?? "0") ?? 0}
        return try LocalIndexStatus(indexed:count("SELECT count(*) n FROM embedding_jobs WHERE status='done'"),pending:count("SELECT count(*) n FROM embedding_jobs WHERE status='pending'"),failed:count("SELECT count(*) n FROM embedding_jobs WHERE status='failed'"),chunks:count("SELECT count(*) n FROM semantic_chunks"),statePending:count("SELECT count(*) n FROM state_jobs WHERE status IN ('pending','running')"),stateFailed:count("SELECT count(*) n FROM state_jobs WHERE status='failed'"),stateCompleted:count("SELECT count(*) n FROM state_jobs WHERE status='done'"),model:LocalEmbedding.model)
    }
    /// Synchronous actor batch: no reentrancy between selecting and committing a source.
    public func indexBatch(limit:Int = 12) throws {
        try db.execute("UPDATE embedding_jobs SET status='pending' WHERE status='done' AND event_id IN (SELECT event_id FROM semantic_chunks WHERE model<>?)",[LocalEmbedding.model])
        let rows=try db.rows("SELECT e.json FROM embedding_jobs j JOIN events e ON e.id=j.event_id WHERE j.status='pending' ORDER BY e.received_at DESC LIMIT ?",[String(max(1,min(limit,32)))])
        for row in rows {
            let event=try JSONCodec.decode(Event.self,from:Data(row["json"]!.utf8))
            do {
                let vectors=try LocalEmbedding.chunks(event.content).map {try LocalEmbedding.vector($0)}
                try saveVectors(eventID:event.id,vectors:vectors,model:LocalEmbedding.model)
            } catch {
                try db.execute("UPDATE embedding_jobs SET status='failed',error='Local embedding failed; retry required' WHERE event_id=?",[event.id])
            }
        }
    }
    func saveVectors(eventID:String,vectors:[[Float]],model:String)throws {
        guard vectors.allSatisfy({!$0.isEmpty && $0.allSatisfy(\.isFinite) && $0.count==vectors.first?.count}) else {throw MapleError.invalid("Invalid vector batch.")}
        try db.transaction {
            try db.execute("DELETE FROM semantic_chunks WHERE event_id=?",[eventID])
            for (i,v) in vectors.enumerated() {
                try db.execute("INSERT INTO semantic_chunks VALUES (?,?,?,?,?)",[eventID,String(i),model,String(v.count),LocalEmbedding.encode(v)])
            }
            try db.execute("UPDATE embedding_jobs SET status='done',error=NULL WHERE event_id=?",[eventID])
        }
    }
    public func retryLocalIntelligence()throws {
        try retryFailedTaskExtractions()
        try db.execute("UPDATE task_reconciliation_clock SET checked_at=0")
        try db.execute("UPDATE task_reconciliation_jobs SET status='pending',error=NULL,created_at=0 WHERE status='failed'")
        try db.execute("UPDATE activity_discovery_jobs SET status='pending',error=NULL WHERE status='failed'")
        try db.transaction {
            try db.execute("UPDATE embedding_jobs SET status='pending',error=NULL WHERE status='failed'")
            try db.execute("UPDATE state_jobs SET status='pending',error=NULL,attempts=0 WHERE status='failed'")
        }
    }
    public func semanticSearch(_ query:String,limit:Int=6,before:Date = Date(),subjects:[String]?=nil)throws->[Event] {
        let vector=try LocalEmbedding.vector(String(query.prefix(4000)))
        return try nearest(vector,model:LocalEmbedding.model,limit:limit,before:before,subjects:subjects)
    }
    func nearest(_ query:[Float],model:String,limit:Int,before:Date,subjects:[String]?=nil)throws->[Event] {
        try nearestBatch([query],model:model,limit:limit,before:before,subjects:subjects)[0]
    }
    /// Reconciliation evaluates all node queries against one decoded candidate set.
    /// Eligibility is applied before ranking, rather than dropping top results afterward.
    func semanticSearchBatch(_ queries:[String],limit:Int,before:Date,after:[Date],connectors:[String])throws->[[Event]] {
        guard !queries.isEmpty else{return []}
        guard queries.count<=20,queries.count==after.count else{throw MapleError.invalid("Invalid semantic query batch.")}
        return try nearestBatch(LocalEmbedding.vectors(queries.map{String($0.prefix(4000))}),model:LocalEmbedding.model,limit:limit,before:before,after:after.map(Optional.some),connectors:connectors)
    }
    func nearestBatch(_ queries:[[Float]],model:String,limit:Int,before:Date,subjects:[String]?=nil,after:[Date?]?=nil,connectors:[String]?=nil)throws->[[Event]] {
        guard let dimension=queries.first?.count else{return []}
        guard queries.count<=20,dimension>0,queries.allSatisfy({$0.count==dimension && $0.allSatisfy(\.isFinite)}),after==nil || after!.count==queries.count else{throw MapleError.invalid("Invalid semantic query vectors.")}
        let empty=Array(repeating:[Event](),count:queries.count)
        var filter="",args:[String?]=[model,String(dimension),String(before.timeIntervalSince1970)]
        if let subjects {
            guard !subjects.isEmpty else{return empty}
            filter += " AND e.id IN (SELECT event_id FROM event_subjects WHERE subject IN (\(Array(repeating:"?",count:subjects.count).joined(separator:","))))"
            args += subjects
        }
        if let connectors {
            guard !connectors.isEmpty else{return empty}
            filter += " AND e.connector IN (\(Array(repeating:"?",count:connectors.count).joined(separator:",")))"
            args += connectors
        }
        if let after,after.allSatisfy({$0 != nil}),let earliest=after.compactMap({$0}).min() {
            filter += " AND e.occurred_at>=?";args.append(String(earliest.timeIntervalSince1970))
        }
        let rows=try db.rows("""
        SELECT c.event_id,c.vector,e.occurred_at FROM events e JOIN semantic_chunks c ON e.id=c.event_id
        WHERE c.model=? AND c.dimensions=? AND e.occurred_at<=? \(filter)
        AND json_extract(e.json,'$.type') NOT LIKE '%.unavailable'
        AND NOT EXISTS (SELECT 1 FROM connector_source_records r WHERE r.connector=e.connector AND r.id=e.external_id AND r.active=0)
        AND e.rowid=(SELECT n.rowid FROM events n INDEXED BY events_entity_received WHERE n.connector=e.connector AND n.account=e.account AND n.external_id=e.external_id AND n.occurred_at<=? ORDER BY n.received_at DESC,n.rowid DESC LIMIT 1)
        """,args+[String(before.timeIntervalSince1970)])
        var scores=Array(repeating:[String:Float](),count:queries.count)
        for row in rows {
            let vector=LocalEmbedding.decode(row["vector"]!)
            guard vector.count==dimension,let occurred=Double(row["occurred_at"]!) else{continue}
            for index in queries.indices {
                if let threshold=after?[index],occurred<threshold.timeIntervalSince1970 {continue}
                var score:Float=0
                vDSP_dotpr(vector,1,queries[index],1,&score,vDSP_Length(dimension))
                if score.isFinite {scores[index][row["event_id"]!]=max(scores[index][row["event_id"]!] ?? -.infinity,score)}
            }
        }
        var events=[String:Event]()
        return try scores.map { scores in
            try scores.sorted{$0.value == $1.value ? $0.key<$1.key:$0.value>$1.value}.prefix(max(1,min(limit,20))).compactMap { scored in
                if let cached=events[scored.key] {return cached}
                let value=try event(scored.key);events[scored.key]=value;return value
            }
        }
    }
}
