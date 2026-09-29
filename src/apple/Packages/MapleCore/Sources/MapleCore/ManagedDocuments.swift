import Foundation
import CryptoKit
import MapleNotebooks

public struct ManagedDocumentRecord: Codable, Sendable {
    public var documentID: String
    public var notebookID: String
    public var path: String
    public var day: String?
    public var timeZone: String
    public var revision: String?
}
public struct DocumentMutationRecord: Codable, Sendable {
    public var commandID: String
    public var documentID: String
    public var expectedRevision: String?
    public var targetRevision: String
    public var before: String?
    public var after: String
    public var state: String
    public var createdAt: Date
}
public struct TodayDocumentSnapshot: Codable, Sendable {
    public var schemaVersion = 1
    public var documentID: String
    public var notebookID: String
    public var path: String
    public var day: String
    public var timeZone: String
    public var content: String
    public var revision: String
    public var draft: NotebookDocument?
    public var readOnly: Bool
    public var warning: String?
    public var indexingPending: Bool
    public var legacyMigrationAvailable: Bool
    public var capabilities: [String: Bool] = ["taskActions":true,"sourceReferences":true]
    public var blocks: [DocumentBlockRecord] = []
    public var cleared: [DocumentBlockRecord] = []
    public var commandID: String?
    public var state: String?
}

/// Minimal reserved grammar validation. This never rewrites user Markdown or frontmatter.
public enum ManagedMarkdown {
    /// Use the connector, not the event type: Gmail and Messages both emit message.received.
    static func referenceKind(connector:String) -> String {
        let connector=connector.lowercased()
        return connector.contains("mail") ? "email":connector.contains("message") ? "message":connector.contains("calendar") ? "calendar":connector.contains("home") ? "home":connector.contains("recording") ? "recording":"source"
    }
    public static func hash(_ text: String) -> String { SHA256.hash(data: Data(text.utf8)).map { String(format:"%02x",$0) }.joined() }
    public static func day(at date: Date = Date(), timeZone: String = TimeZone.current.identifier) throws -> String {
        guard let zone=TimeZone(identifier:timeZone) else { throw MapleError.invalid("Choose a valid time zone.") }
        let f=DateFormatter();f.locale=Locale(identifier:"en_US_POSIX");f.calendar=Calendar(identifier:.gregorian);f.timeZone=zone;f.dateFormat="yyyy-MM-dd"
        return f.string(from:date)
    }
    public static func validateDay(_ day:String,timeZone:String) throws {
        guard day.count==10,day.range(of:#"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"#,options:.regularExpression) != nil,!day.hasPrefix("0000"),let zone=TimeZone(identifier:timeZone) else {throw MapleError.invalid("Choose a valid YYYY-MM-DD date and time zone.")}
        let f=DateFormatter();f.locale=Locale(identifier:"en_US_POSIX");f.calendar=Calendar(identifier:.gregorian);f.timeZone=zone;f.dateFormat="yyyy-MM-dd";f.isLenient=false
        guard let date=f.date(from:day),f.string(from:date)==day else {throw MapleError.invalid("Choose a valid calendar date.")}
    }
    public static func documentID(_ content:String)->String? {
        guard content.hasPrefix("---\n"),let end=content.dropFirst(4).range(of:"\n---") else{return nil}
        let front=String(content[content.index(content.startIndex,offsetBy:4)..<end.lowerBound])
        guard let regex=try? NSRegularExpression(pattern:#"(?m)^maple:\n  format: 1\n  document: "([^"]+)"(?:\n|$)"#) else{return nil}
        let ns=front as NSString,matches=regex.matches(in:front,range:NSRange(location:0,length:ns.length))
        guard matches.count==1 else{return nil}
        let value=ns.substring(with:matches[0].range(at:1));return UUID(uuidString:value)==nil ? nil:value
    }
    public static func header(documentID:String,day:String,timeZone:String)->String {
        "---\nmaple:\n  format: 1\n  document: \"\(documentID)\"\n  day: \"\(day)\"\n  timezone: \"\(timeZone)\"\n---\n\n"
    }
    public static func marker(_ fields:[String:String]) throws -> String {
        var object:[String:Any]=fields;object["v"]=1
        let data=try JSONSerialization.data(withJSONObject:object,options:.sortedKeys)
        let json=String(decoding:data,as:UTF8.self).replacingOccurrences(of:"<",with:"\\u003c").replacingOccurrences(of:">",with:"\\u003e")
        return "<!-- maple:block \(json) -->\n"
    }
    public static func validate(_ content:String,documentID:String) throws {
        guard content.utf8.count<=256000 else {throw MapleError.invalid("Notes are limited to 256 KB. Your draft is kept.")}
        guard self.documentID(content)==documentID else {throw MapleError.invalid("Managed document metadata changed or is unsupported. Preserve the original metadata in source mode.")}
        var ids=Set<String>()
        let pattern = #"<!-- maple:(?:block|item) (.*?) -->"#
        let ns=content as NSString
        let matches=try outsideFences(content,pattern:pattern)
        let reservedCount=try outsideFences(content,pattern:#"<!-- maple:(?:block|item) "#).count
        guard matches.count==reservedCount else {throw MapleError.invalid("Reserved block metadata is malformed. Review it in source mode before saving.")}
        for match in matches {
            guard let data=ns.substring(with:match.range(at:1)).data(using:.utf8),let object=try? JSONSerialization.jsonObject(with:data) as? [String:Any],object["v"] as? Int==1,let id=object["id"] as? String,!id.isEmpty,id.utf8.count<=256,ids.insert(id).inserted else {throw MapleError.invalid("A block identity is malformed, duplicated, or unsupported. Resolve it in source mode before saving.")}
        }
    }
}

extension SQLite {
    func migrateManagedDocuments() throws {
        try transaction {
            try execute("CREATE TABLE IF NOT EXISTS managed_documents (id TEXT PRIMARY KEY,notebook_id TEXT NOT NULL,path TEXT NOT NULL,day TEXT,time_zone TEXT NOT NULL,revision TEXT,json TEXT NOT NULL,UNIQUE(notebook_id,path))")
            try execute("CREATE UNIQUE INDEX IF NOT EXISTS managed_daily_date ON managed_documents(notebook_id,day) WHERE day IS NOT NULL")
            try execute("CREATE TABLE IF NOT EXISTS document_mutations (command_id TEXT PRIMARY KEY,document_id TEXT NOT NULL,payload_hash TEXT NOT NULL,state TEXT NOT NULL,json TEXT NOT NULL)")
            try execute("CREATE INDEX IF NOT EXISTS document_mutations_document ON document_mutations(document_id,state)")
            try execute("CREATE TABLE IF NOT EXISTS document_revisions (document_id TEXT NOT NULL,revision TEXT NOT NULL,command_id TEXT NOT NULL,content TEXT NOT NULL,created_at REAL NOT NULL,PRIMARY KEY(document_id,revision))")
            try execute("CREATE TABLE IF NOT EXISTS document_outbox (command_id TEXT PRIMARY KEY,event_json TEXT NOT NULL,delivered INTEGER NOT NULL DEFAULT 0)")
            try execute("CREATE TABLE IF NOT EXISTS document_legacy_imports (day TEXT PRIMARY KEY,document_id TEXT NOT NULL,snapshot_json TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1)")
            try migrateDocumentOperations()
            try execute("CREATE TABLE IF NOT EXISTS document_auto_insertions (block_id TEXT PRIMARY KEY,document_id TEXT NOT NULL,day TEXT NOT NULL)")
            try execute("CREATE INDEX IF NOT EXISTS document_auto_day ON document_auto_insertions(document_id)")
            try execute("CREATE INDEX IF NOT EXISTS events_auto_recent ON events(received_at,occurred_at)")
            try execute("CREATE INDEX IF NOT EXISTS events_auto_entity_latest ON events(connector,account,external_id,received_at)")
            try execute("CREATE INDEX IF NOT EXISTS document_blocks_task ON document_block_index(json_extract(json,'$.taskID'))")
            try execute("CREATE TABLE IF NOT EXISTS document_task_schedule (task_id TEXT PRIMARY KEY,boundary REAL)")
            try execute("CREATE INDEX IF NOT EXISTS document_task_boundary ON document_task_schedule(boundary)")
            for row in try rows("SELECT t.id,t.json FROM life_tasks t WHERE NOT EXISTS (SELECT 1 FROM document_task_schedule s WHERE s.task_id=t.id)") {
                let task=try JSONCodec.decode(LifeTask.self,from:Data(row["json"]!.utf8))
                let boundary=(task.scheduled ?? task.due).flatMap{try? $0.boundary()}
                try execute("INSERT INTO document_task_schedule VALUES (?,?)",[task.id,boundary.map{String($0.timeIntervalSince1970)}])
            }
        }
    }
}
extension KnowledgeStore {
    public func managedDocument(id:String) throws -> ManagedDocumentRecord? {
        try db.rows("SELECT json FROM managed_documents WHERE id=?",[id]).first.map{try JSONCodec.decode(ManagedDocumentRecord.self,from:Data($0["json"]!.utf8))}
    }
    public func managedDocument(notebookID:String,path:String) throws -> ManagedDocumentRecord? {
        try db.rows("SELECT json FROM managed_documents WHERE notebook_id=? AND path=?",[notebookID,path]).first.map{try JSONCodec.decode(ManagedDocumentRecord.self,from:Data($0["json"]!.utf8))}
    }
    public func managedDailyDocument(notebookID:String,day:String) throws -> ManagedDocumentRecord? {
        try db.rows("SELECT json FROM managed_documents WHERE notebook_id=? AND day=?",[notebookID,day]).first.map{try JSONCodec.decode(ManagedDocumentRecord.self,from:Data($0["json"]!.utf8))}
    }
    public func isManagedDocument(notebookID:String,path:String) throws -> Bool {try managedDocument(notebookID:notebookID,path:path) != nil}
    public func isManagedDailyDay(_ day:String) throws -> Bool {try !db.rows("SELECT id FROM managed_documents WHERE day=? LIMIT 1",[day]).isEmpty}
    public func registerManagedDocument(_ document:ManagedDocumentRecord,initialContent:String?=nil,initialBefore:String?=nil,legacySnapshot:DailyNoteSnapshot?=nil) throws {
        if let existing=try managedDocument(id:document.documentID) {
            guard existing.notebookID==document.notebookID,existing.path==document.path else{throw MapleError.invalid("This document identity belongs to another path. Import the copy with new identities.")}
            if existing.day==nil,document.day != nil {
                try db.execute("UPDATE managed_documents SET day=?,time_zone=?,json=? WHERE id=?",[document.day,document.timeZone,try JSONCodec.string(document),document.documentID])
            }
            return
        }
        try db.transaction {
            try db.execute("INSERT INTO managed_documents VALUES (?,?,?,?,?,?,?)",[document.documentID,document.notebookID,document.path,document.day,document.timeZone,document.revision,try JSONCodec.string(document)])
            if let legacy=legacySnapshot {
                try db.execute("INSERT INTO document_legacy_imports(day,document_id,snapshot_json) VALUES (?,?,?)",[legacy.day,document.documentID,try JSONCodec.string(legacy)])
                for block in legacy.blocks+legacy.cleared {
                    let snapshot=DailyNoteSnapshot(day:legacy.day,timeZone:legacy.timeZone,blocks:[block],cleared:[],revision:legacy.revision)
                    let header=ManagedMarkdown.header(documentID:document.documentID,day:legacy.day,timeZone:legacy.timeZone)
                    let content=String(try TodayDocumentCoordinator.export(snapshot,documentID:document.documentID).dropFirst(header.count))
                    try putDocumentBlock(DocumentBlockRecord(blockID:block.id,documentID:document.documentID,version:block.version,kind:block.kind.rawValue,eventID:block.source?.eventID,taskID:block.taskNodeID,taskVersion:block.taskVersion,taskStatus:nil,content:content,state:block.clearedAt == nil ? "active":"cleared",userEdited:block.userEdited))
                }
            }
            if let content=initialContent {
                try ManagedMarkdown.validate(content,documentID:document.documentID)
                let mutation=DocumentMutationRecord(commandID:"create:"+document.documentID,documentID:document.documentID,expectedRevision:document.revision,targetRevision:ManagedMarkdown.hash(content),before:initialBefore,after:content,state:"prepared",createdAt:Date())
                try validateManagedBlockOwnership(documentID:document.documentID,content:content)
                try reserveDocumentIdentities(documentID:document.documentID,content:content,commandID:mutation.commandID)
                let payload=ManagedMarkdown.hash(try JSONCodec.string([document.documentID,document.revision ?? "",content]))
                try db.execute("INSERT INTO document_mutations VALUES (?,?,?,?,?)",[mutation.commandID,mutation.documentID,payload,mutation.state,try JSONCodec.string(mutation)])
            }
        }
    }
    public func documentMutation(_ commandID:String) throws -> DocumentMutationRecord? {
        try db.rows("SELECT json FROM document_mutations WHERE command_id=?",[commandID]).first.map{try JSONCodec.decode(DocumentMutationRecord.self,from:Data($0["json"]!.utf8))}
    }
    public func documentHistory(documentID:String) throws -> [DocumentMutationRecord] {
        try db.rows("SELECT json FROM document_mutations WHERE document_id=? ORDER BY rowid DESC LIMIT 100",[documentID]).map{try JSONCodec.decode(DocumentMutationRecord.self,from:Data($0["json"]!.utf8))}
    }
    public func pendingDocumentMutations(documentID:String) throws -> [DocumentMutationRecord] {
        try db.rows("SELECT json FROM document_mutations WHERE document_id=? AND state='prepared' ORDER BY rowid",[documentID]).map{try JSONCodec.decode(DocumentMutationRecord.self,from:Data($0["json"]!.utf8))}
    }
    public func prepareDocumentMutation(_ mutation:DocumentMutationRecord) throws -> DocumentMutationRecord {
        guard !mutation.commandID.isEmpty,mutation.commandID.utf8.count<=256 else {throw MapleError.invalid("A bounded command identity is required.")}
        let payload=ManagedMarkdown.hash(try JSONCodec.string([mutation.documentID,mutation.expectedRevision ?? "",mutation.after]))
        return try db.transaction {
            if let row=try db.rows("SELECT payload_hash,json FROM document_mutations WHERE command_id=?",[mutation.commandID]).first {
                guard row["payload_hash"]==payload else {throw MapleError.invalid("This command identity was already used for different content.")}
                return try JSONCodec.decode(DocumentMutationRecord.self,from:Data(row["json"]!.utf8))
            }
            guard try db.rows("SELECT command_id FROM document_mutations WHERE document_id=? AND state IN ('prepared','operationPrepared')",[mutation.documentID]).isEmpty else {throw MapleError.invalid("This document has an interrupted save. Reopen it to recover before saving.")}
            try validateManagedBlockOwnership(documentID:mutation.documentID,content:mutation.after)
            try reserveDocumentIdentities(documentID:mutation.documentID,content:mutation.after,commandID:mutation.commandID)
            try db.execute("INSERT INTO document_mutations VALUES (?,?,?,?,?)",[mutation.commandID,mutation.documentID,payload,mutation.state,try JSONCodec.string(mutation)])
            return mutation
        }
    }
    public func markDocumentConflict(_ mutation:DocumentMutationRecord) throws {
        var value=mutation;value.state="conflict"
        try db.execute("UPDATE document_mutations SET state='conflict',json=? WHERE command_id=? AND state='prepared'",[try JSONCodec.string(value),value.commandID])
        try db.execute("DELETE FROM document_identity_reservations WHERE command_id=?",[mutation.commandID])
    }
    public func finalizeDocumentMutation(_ mutation:DocumentMutationRecord) throws {
        try db.transaction {try finalizeDocumentMutationInTransaction(mutation)}
    }
    func finalizeDocumentMutationInTransaction(_ mutation:DocumentMutationRecord) throws {
            guard var document=try managedDocument(id:mutation.documentID) else {throw MapleError.invalid("Document no longer registered.")}
            guard let current=try documentMutation(mutation.commandID),["prepared","operationPrepared"].contains(current.state) else{return}
            document.revision=mutation.targetRevision
            try db.execute("UPDATE managed_documents SET revision=?,json=? WHERE id=?",[document.revision,try JSONCodec.string(document),document.documentID])
            var completed=current;completed.state="committed"
            try db.execute("UPDATE document_mutations SET state='committed',json=? WHERE command_id=?",[try JSONCodec.string(completed),mutation.commandID])
            try db.execute("INSERT OR IGNORE INTO document_revisions VALUES (?,?,?,?,?)",[document.documentID,mutation.targetRevision,mutation.commandID,mutation.after,String(mutation.createdAt.timeIntervalSince1970)])
            let event=Event(id:"document:"+ManagedMarkdown.hash(document.documentID+mutation.targetRevision),type:"note.updated",source:Source(connector:"notes",account:document.notebookID,externalID:document.documentID,revision:mutation.targetRevision,timeZone:document.timeZone),occurredAt:mutation.createdAt,receivedAt:mutation.createdAt,subjects:["person:self"],content:mutation.after)
            try db.execute("INSERT OR IGNORE INTO document_outbox(command_id,event_json) VALUES (?,?)",[mutation.commandID,try JSONCodec.string(event)])
            try indexManagedBlocks(documentID:mutation.documentID,content:mutation.after)
            try db.execute("DELETE FROM document_identity_reservations WHERE command_id=?",[mutation.commandID])
    }
    public func drainDocumentOutbox() throws {
        for row in try db.rows("SELECT command_id,event_json FROM document_outbox WHERE delivered=0 ORDER BY rowid LIMIT 100") {
            let event=try JSONCodec.decode(Event.self,from:Data(row["event_json"]!.utf8))
            _ = try ingest(event)
            // An interruption between ingest and receipt is safe: immutable event identity
            // deduplicates replay while ingest keeps its event + processing queue atomic.
            try db.execute("UPDATE document_outbox SET delivered=1 WHERE command_id=?",[row["command_id"]])
        }
    }
    public func documentIndexingPending(documentID:String) throws -> Bool {
        try !db.rows("SELECT 1 FROM document_outbox o JOIN document_mutations m ON m.command_id=o.command_id WHERE m.document_id=? AND o.delivered=0 LIMIT 1",[documentID]).isEmpty
    }
    public func legacyDailyImportDocument(day:String) throws -> ManagedDocumentRecord? {
        guard let id=try db.rows("SELECT document_id FROM document_legacy_imports WHERE day=?",[day]).first?["document_id"] else{return nil}
        guard let record=try managedDocument(id:id) else {throw MapleError.invalid("This day's legacy import record needs recovery. The original import will not be duplicated.")}
        return record
    }
    public func recordDailyDocumentImport(_ snapshot:DailyNoteSnapshot,documentID:String) throws {
        try db.execute("INSERT OR IGNORE INTO document_legacy_imports(day,document_id,snapshot_json) VALUES (?,?,?)",[snapshot.day,documentID,try JSONCodec.string(snapshot)])
    }
}

public struct DocumentRecoveryIssue:Codable,Sendable {
    public var documentID:String
    public var path:String
    public var message:String
}
public struct DocumentRecoveryReport:Codable,Sendable {
    public var recoveredCount:Int
    public var issues:[DocumentRecoveryIssue]
    public var hasMore:Bool
}
extension KnowledgeStore {
    public func pendingManagedDocuments(limit:Int=101) throws -> [ManagedDocumentRecord] {
        try db.rows("SELECT d.json FROM managed_documents d WHERE EXISTS (SELECT 1 FROM document_mutations m WHERE m.document_id=d.id AND m.state IN ('prepared','operationPrepared')) ORDER BY d.id LIMIT ?",[String(max(1,min(101,limit)))]).map{try JSONCodec.decode(ManagedDocumentRecord.self,from:Data($0["json"]!.utf8))}
    }
}
