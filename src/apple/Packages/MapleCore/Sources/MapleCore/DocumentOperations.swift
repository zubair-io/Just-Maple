import Foundation

public struct DocumentBlockRecord: Codable, Sendable {
    public var blockID:String
    public var documentID:String
    public var version:Int
    public var kind:String
    public var eventID:String?
    public var taskID:String?
    public var taskVersion:Int?
    public var taskStatus:String?
    public var content:String
    public var state:String
    public var userEdited:Bool?
}
public struct ManagedSourceBacklink:Codable,Sendable {
    public var documentID:String
    public var path:String
    public var day:String?
    public var blockID:String
    public var revision:String?
}
public struct DocumentBlockMutation:Codable,Sendable {
    public var commandID:String
    public var documentID:String
    public var expectedRevision:String
    public var blockID:String
    public var expectedBlockVersion:Int
    public var kind:String
    public var targetDay:String?
    public var expectedTaskVersion:Int?
    public init(commandID:String,documentID:String,expectedRevision:String,blockID:String,expectedBlockVersion:Int,kind:String,targetDay:String?=nil,expectedTaskVersion:Int?=nil) {
        self.commandID=commandID;self.documentID=documentID;self.expectedRevision=expectedRevision;self.blockID=blockID;self.expectedBlockVersion=expectedBlockVersion;self.kind=kind;self.targetDay=targetDay;self.expectedTaskVersion=expectedTaskVersion
    }
}
public struct DocumentOperation:Codable,Sendable {
    public var input:DocumentBlockMutation
    public var files:[DocumentMutationRecord]
    public var taskID:String?
    public var state:String
}
struct ManagedBlockSegment {
    var id:String
    var metadata:[String:Any]
    var content:String
    var range:NSRange
    var eventID:String?
}
extension ManagedMarkdown {
    static func segments(_ content:String) throws -> [ManagedBlockSegment] {
        let ns=content as NSString, matches=try outsideFences(content,pattern:#"(?m)^<!-- maple:block (.*?) -->\r?$"#)
        return try matches.enumerated().map { index,match in
            guard let data=ns.substring(with:match.range(at:1)).data(using:.utf8),let metadata=try JSONSerialization.jsonObject(with:data) as? [String:Any],let id=metadata["id"] as? String else {throw MapleError.invalid("Malformed block metadata.")}
            let end=index+1<matches.count ? matches[index+1].range.location:ns.length
            let range=NSRange(location:match.range.location,length:end-match.range.location)
            let text=ns.substring(with:range)
            var eventID:String?
            let body=String(text.dropFirst(ns.substring(with:match.range).count)).trimmingCharacters(in:.whitespacesAndNewlines)
            if body.hasPrefix("```maple-ref\n"),let start=body.range(of:"```maple-ref\n"),let end=body[start.upperBound...].range(of:"\n```") {
                let data=Data(body[start.upperBound..<end.lowerBound].utf8)
                eventID=(try? JSONSerialization.jsonObject(with:data) as? [String:Any])?["eventID"] as? String
            }
            return ManagedBlockSegment(id:id,metadata:metadata,content:text,range:range,eventID:eventID)
        }
    }
}
extension SQLite {
    func migrateDocumentOperations() throws {
        try execute("CREATE TABLE IF NOT EXISTS document_block_index (block_id TEXT PRIMARY KEY,document_id TEXT NOT NULL,version INTEGER NOT NULL,content_hash TEXT NOT NULL,state TEXT NOT NULL,event_id TEXT,json TEXT NOT NULL)")
        try execute("CREATE INDEX IF NOT EXISTS document_blocks_owner ON document_block_index(document_id,state)")
        try execute("CREATE INDEX IF NOT EXISTS document_blocks_event ON document_block_index(event_id,state)")
        try execute("CREATE TABLE IF NOT EXISTS document_identities (block_id TEXT PRIMARY KEY,document_id TEXT NOT NULL)")
        try execute("CREATE TABLE IF NOT EXISTS document_identity_reservations (block_id TEXT PRIMARY KEY,document_id TEXT NOT NULL,command_id TEXT NOT NULL)")
        try execute("CREATE TABLE IF NOT EXISTS document_operations (command_id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,state TEXT NOT NULL,json TEXT NOT NULL)")
        try execute("CREATE TABLE IF NOT EXISTS task_mutation_reservations (task_id TEXT PRIMARY KEY,command_id TEXT NOT NULL,expected_version INTEGER NOT NULL)")
        // Guards every SQL writer, including extraction and legacy paths. Finalization releases
        // only its own reservation inside the same transaction as the canonical task action.
        for (table,prefix) in [("life_tasks","task:"),("task_suggestions","source:")] {
            for action in ["INSERT","UPDATE","DELETE"] {
                let row=action=="INSERT" ? "NEW":"OLD"
                try execute("CREATE TRIGGER IF NOT EXISTS reserved_\(table)_\(action.lowercased()) BEFORE \(action) ON \(table) WHEN EXISTS (SELECT 1 FROM task_mutation_reservations WHERE task_id='\(prefix)' || \(row).id) BEGIN SELECT RAISE(ABORT,'Task has a pending document action; recover it on the Mac.'); END")
            }
        }
        try execute("CREATE TRIGGER IF NOT EXISTS reserved_task_relation_old BEFORE UPDATE ON task_relations WHEN EXISTS (SELECT 1 FROM task_mutation_reservations WHERE task_id=OLD.duplicate_id OR task_id=json_extract(OLD.json,'$.primaryID')) BEGIN SELECT RAISE(ABORT,'Task has a pending document action; recover it on the Mac.'); END")
        try execute("CREATE TRIGGER IF NOT EXISTS reserved_task_relation_replace BEFORE INSERT ON task_relations WHEN EXISTS (SELECT 1 FROM task_relations r JOIN task_mutation_reservations t ON t.task_id=json_extract(r.json,'$.primaryID') WHERE r.duplicate_id=NEW.duplicate_id) BEGIN SELECT RAISE(ABORT,'Task has a pending document action; recover it on the Mac.'); END")
        for action in ["INSERT","UPDATE","DELETE"] {
            let row=action=="DELETE" ? "OLD":"NEW"
            try execute("CREATE TRIGGER IF NOT EXISTS reserved_task_relation_\(action.lowercased()) BEFORE \(action) ON task_relations WHEN EXISTS (SELECT 1 FROM task_mutation_reservations WHERE task_id=\(row).duplicate_id OR task_id=json_extract(\(row).json,'$.primaryID')) BEGIN SELECT RAISE(ABORT,'Task has a pending document action; recover it on the Mac.'); END")
        }
    }
}
extension KnowledgeStore {
    func validateManagedBlockOwnership(documentID:String,content:String) throws {
        for id in try ManagedMarkdown.identities(content) {
            if let owner=try db.rows("SELECT document_id FROM document_identities WHERE block_id=?",[id]).first?["document_id"] {
                guard owner==documentID else {throw MapleError.invalid("A block or list-item identity belongs to another document. Use Copy or Move.")}
            }
            if let owner=try db.rows("SELECT document_id FROM document_identity_reservations WHERE block_id=?",[id]).first?["document_id"] {
                guard owner==documentID else {throw MapleError.invalid("A block identity is reserved by another pending document save.")}
            }
        }
        for segment in try ManagedMarkdown.segments(content) {
            if let row=try db.rows("SELECT document_id,state FROM document_block_index WHERE block_id=?",[segment.id]).first {
                guard row["document_id"]==documentID else {throw MapleError.invalid("A block identity belongs to another document. Copy with a new identity or use Move.")}
                guard row["state"] != "cleared" else {throw MapleError.invalid("A cleared block cannot be refreshed back into the note. Restore it explicitly.")}
            }
        }
    }
    func indexManagedBlocks(documentID:String,content:String) throws {
        for id in try ManagedMarkdown.identities(content) {try db.execute("INSERT INTO document_identities VALUES (?,?) ON CONFLICT(block_id) DO UPDATE SET document_id=excluded.document_id",[id,documentID])}
        let segments=try ManagedMarkdown.segments(content),ids=Set(segments.map(\.id))
        for old in try documentBlocks(documentID:documentID) where old.state=="active" && !ids.contains(old.blockID) {
            var removed=old;removed.state="removed";removed.version += 1;try putDocumentBlock(removed)
        }
        for segment in segments {
            let prior=try documentBlock(id:segment.id)
            let changed=prior.map{$0.content != segment.content || $0.documentID != documentID || $0.state != "active"} ?? true
            let taskID=segment.metadata["taskID"] as? String
            let value=DocumentBlockRecord(blockID:segment.id,documentID:documentID,version:(prior?.version ?? 0)+(changed ? 1:0),kind:taskID != nil ? "task":(segment.eventID != nil ? "source":segment.metadata["kind"] as? String ?? "text"),eventID:segment.eventID,taskID:taskID,taskVersion:taskID.flatMap{try? nodeVersion($0)},taskStatus:taskID.flatMap{try? taskNode($0)?.status.rawValue},content:segment.content,state:"active",userEdited:changed ? true:prior?.userEdited)
            try putDocumentBlock(value)
        }
    }
    func putDocumentBlock(_ block:DocumentBlockRecord) throws {
        try db.execute("INSERT INTO document_block_index VALUES (?,?,?,?,?,?,?) ON CONFLICT(block_id) DO UPDATE SET document_id=excluded.document_id,version=excluded.version,content_hash=excluded.content_hash,state=excluded.state,event_id=excluded.event_id,json=excluded.json",[block.blockID,block.documentID,String(block.version),ManagedMarkdown.hash(block.content),block.state,block.eventID,try JSONCodec.string(block)])
    }
    public func documentBlock(id:String) throws -> DocumentBlockRecord? {
        try db.rows("SELECT json FROM document_block_index WHERE block_id=?",[id]).first.map{try JSONCodec.decode(DocumentBlockRecord.self,from:Data($0["json"]!.utf8))}
    }
    public func documentBlocks(documentID:String) throws -> [DocumentBlockRecord] {
        try db.rows("SELECT json FROM document_block_index WHERE document_id=? ORDER BY rowid",[documentID]).map { row in
            var block=try JSONCodec.decode(DocumentBlockRecord.self,from:Data(row["json"]!.utf8))
            if let task=block.taskID {block.taskVersion=try nodeVersion(task);block.taskStatus=try taskNode(task)?.status.rawValue}
            return block
        }
    }
    public func managedSourceBacklinks(eventID:String) throws -> [ManagedSourceBacklink] {
        try db.rows("SELECT b.block_id,d.id,d.path,d.day,d.revision FROM document_block_index b JOIN managed_documents d ON d.id=b.document_id WHERE b.event_id=? AND b.state='active' ORDER BY d.day DESC LIMIT 100",[eventID]).map{ManagedSourceBacklink(documentID:$0["id"]!,path:$0["path"]!,day:$0["day"],blockID:$0["block_id"]!,revision:$0["revision"])}
    }
    public func documentOperation(commandID:String) throws -> DocumentOperation? {
        try db.rows("SELECT json FROM document_operations WHERE command_id=?",[commandID]).first.map{try JSONCodec.decode(DocumentOperation.self,from:Data($0["json"]!.utf8))}
    }
    public func pendingDocumentOperations(documentID:String) throws -> [DocumentOperation] {
        try db.rows("SELECT json FROM document_operations WHERE state IN ('prepared','conflict') ORDER BY rowid").map{try JSONCodec.decode(DocumentOperation.self,from:Data($0["json"]!.utf8))}.filter{$0.files.contains(where:{$0.documentID==documentID})}
    }
    public func prepareDocumentOperation(_ operation:DocumentOperation) throws -> DocumentOperation {
        let input=operation.input,hash=ManagedMarkdown.hash(try JSONCodec.string(input))
        return try db.transaction {
            if let row=try db.rows("SELECT payload_hash,json FROM document_operations WHERE command_id=?",[input.commandID]).first {
                guard row["payload_hash"]==hash else{throw MapleError.invalid("This command identity was reused for another action.")}
                return try JSONCodec.decode(DocumentOperation.self,from:Data(row["json"]!.utf8))
            }
            guard let block=try documentBlock(id:input.blockID),block.documentID==input.documentID,block.version==input.expectedBlockVersion else {throw MapleError.invalid("This block changed. Reopen the note before applying this action.")}
            for file in operation.files {
                guard try db.rows("SELECT command_id FROM document_mutations WHERE document_id=? AND state IN ('prepared','operationPrepared')",[file.documentID]).isEmpty else {throw MapleError.invalid("A document has unfinished work. Recover it before this action.")}
                try ManagedMarkdown.validate(file.after,documentID:file.documentID)
                try reserveDocumentIdentities(documentID:file.documentID,content:file.after,commandID:file.commandID,allowedOwner:input.kind=="move" ? input.documentID:nil)
                let payload=ManagedMarkdown.hash(try JSONCodec.string([file.documentID,file.expectedRevision ?? "",file.after]))
                try db.execute("INSERT INTO document_mutations VALUES (?,?,?,?,?)",[file.commandID,file.documentID,payload,"operationPrepared",try JSONCodec.string(file)])
            }
            if let task=operation.taskID {
                guard ["complete","reopen"].contains(input.kind),let expected=input.expectedTaskVersion,try nodeVersion(task)==expected,let value=try taskNode(task) else {throw MapleError.invalid("The linked task changed. Refresh its current state.")}
                if input.kind=="complete" {guard !value.status.terminal else{throw MapleError.invalid("This linked task is already complete.")}}
                else {guard value.status == .completed,value.actionState?.lastMutationScope=="managed-document",value.actionState?.lastAction=="done" else {throw MapleError.invalid("Only the latest unchanged completion from this managed document can be reopened here.")}}
                try db.execute("INSERT INTO task_mutation_reservations VALUES (?,?,?)",[task,input.commandID,String(expected)])
            }
            try db.execute("INSERT INTO document_operations VALUES (?,?,?,?)",[input.commandID,hash,"prepared",try JSONCodec.string(operation)])
            return operation
        }
    }
    public func markDocumentOperationConflict(_ operation:DocumentOperation) throws {
        var current=operation;current.state="conflict"
        try db.execute("UPDATE document_operations SET state='conflict',json=? WHERE command_id=?",[try JSONCodec.string(current),operation.input.commandID])
    }
    public func finalizeDocumentOperation(_ operation:DocumentOperation) throws {
        try db.transaction {
            guard var current=try documentOperation(commandID:operation.input.commandID),current.state != "committed" else{return}
            if let task=operation.taskID,let expected=operation.input.expectedTaskVersion {
                guard try db.rows("SELECT command_id FROM task_mutation_reservations WHERE task_id=?",[task]).first?["command_id"]==operation.input.commandID else{throw MapleError.invalid("This task action lost its reservation and needs recovery.")}
                let undoTarget=operation.input.kind=="reopen" ? try taskNode(task)?.actionState?.lastMutationID:nil
                try db.execute("DELETE FROM task_mutation_reservations WHERE task_id=? AND command_id=?",[task,operation.input.commandID])
                _ = try applyTaskActionInTransaction(nodeID:task,change:TaskActionChange(kind:operation.input.kind=="reopen" ? "undo":"done",issuedAt:operation.files[0].createdAt,targetMutationID:undoTarget),expectedVersion:expected,requestID:operation.input.commandID,scope:"managed-document",at:operation.files[0].createdAt)
            }
            for file in current.files {try finalizeDocumentMutationInTransaction(file)}
            if current.input.kind=="clear",var block=try documentBlock(id:current.input.blockID) {block.state="cleared";try putDocumentBlock(block)}
            current.state="committed"
            try db.execute("UPDATE document_operations SET state='committed',json=? WHERE command_id=?",[try JSONCodec.string(current),current.input.commandID])
        }
    }
}

extension KnowledgeStore {
    public func documentOperationHistory(documentID:String) throws -> [DocumentOperation] {
        try db.rows("SELECT json FROM document_operations ORDER BY rowid DESC LIMIT 500").map{try JSONCodec.decode(DocumentOperation.self,from:Data($0["json"]!.utf8))}.filter{$0.files.contains(where:{$0.documentID==documentID})}
    }
    public func abandonDocumentOperation(commandID:String) throws {
        try db.transaction {
            guard var operation=try documentOperation(commandID:commandID),["prepared","conflict"].contains(operation.state) else {throw MapleError.invalid("Only pending document actions can be abandoned.")}
            // Explicit compensation cancels only the unapplied canonical effect. Never overwrite
            // any participating file; every before/after artifact remains in mutation history.
            try db.execute("DELETE FROM task_mutation_reservations WHERE command_id=?",[commandID])
            for var file in operation.files {
                file.state="abandoned"
                try db.execute("DELETE FROM document_identity_reservations WHERE command_id=?",[file.commandID])
                try db.execute("UPDATE document_mutations SET state='abandoned',json=? WHERE command_id=?",[try JSONCodec.string(file),file.commandID])
            }
            operation.state="abandoned"
            try db.execute("UPDATE document_operations SET state='abandoned',json=? WHERE command_id=?",[try JSONCodec.string(operation),commandID])
        }
    }
}

extension ManagedMarkdown {
    static func remapCopiedIdentities(_ content:String,commandID:String) throws -> String {
        var result=content
        let ns=content as NSString
        for match in try outsideFences(content,pattern:#"<!-- maple:(block|item) (.*?) -->"#).reversed() {
            let kind=ns.substring(with:match.range(at:1))
            guard var object=try JSONSerialization.jsonObject(with:Data(ns.substring(with:match.range(at:2)).utf8)) as? [String:Any],let id=object["id"] as? String else{throw MapleError.invalid("This block cannot be copied without valid identities.")}
            object["id"]="copy-"+hash(commandID+":"+id)
            // A copied request/reply is content, never an instruction to rerun or a second run.
            object.removeValue(forKey:"taskCommandID")
            if object["kind"] as? String=="maple-request" {object["requestID"]=UUID().uuidString.lowercased()}
            let json=String(decoding:try JSONSerialization.data(withJSONObject:object,options:.sortedKeys),as:UTF8.self).replacingOccurrences(of:"<",with:"\\u003c").replacingOccurrences(of:">",with:"\\u003e")
            result=(result as NSString).replacingCharacters(in:match.range,with:"<!-- maple:"+kind+" "+json+" -->")
        }
        return result
    }
}

extension ManagedMarkdown {
    static func identities(_ content:String) throws -> [String] {
        let ns=content as NSString
        return try outsideFences(content,pattern:#"<!-- maple:(?:block|item) (.*?) -->"#).map { match in
            guard let object=try JSONSerialization.jsonObject(with:Data(ns.substring(with:match.range(at:1)).utf8)) as? [String:Any],let id=object["id"] as? String else {throw MapleError.invalid("Invalid block identity.")};return id
        }
    }
}
extension KnowledgeStore {
    func reserveDocumentIdentities(documentID:String,content:String,commandID:String,allowedOwner:String?=nil) throws {
        for id in try ManagedMarkdown.identities(content) {
            if let owner=try db.rows("SELECT document_id FROM document_identities WHERE block_id=?",[id]).first?["document_id"] {
                guard owner==documentID || owner==allowedOwner else{throw MapleError.invalid("A block identity belongs to another document.")}
            }
            if let reserved=try db.rows("SELECT document_id,command_id FROM document_identity_reservations WHERE block_id=?",[id]).first {
                guard reserved["command_id"]==commandID else{throw MapleError.invalid("A block identity has a pending save in another command.")}
            } else {try db.execute("INSERT INTO document_identity_reservations VALUES (?,?,?)",[id,documentID,commandID])}
        }
    }
}

extension ManagedMarkdown {
    /// Reserved comments inside fenced code are literal code, not document authority.
    static func outsideFences(_ content:String,pattern:String) throws -> [NSTextCheckingResult] {
        let ns=content as NSString,regex=try NSRegularExpression(pattern:pattern)
        let fenceRegex=try NSRegularExpression(pattern:#"^[ \t]*(`{3,}|~{3,})(.*)$"#)
        var fencedLines:[NSRange]=[],offset=0,fence:Character?,width=0
        for line in content.components(separatedBy:"\n") {
            let lineNS=line as NSString,length=lineNS.length
            let match=fenceRegex.firstMatch(in:line,range:NSRange(location:0,length:length))
            if let active=fence {
                fencedLines.append(NSRange(location:offset,length:length+1))
                if let match {
                    let delimiter=lineNS.substring(with:match.range(at:1)),suffix=lineNS.substring(with:match.range(at:2))
                    if delimiter.first==active,delimiter.count>=width,suffix.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty {fence=nil;width=0}
                }
            } else if let match {
                let delimiter=lineNS.substring(with:match.range(at:1));fence=delimiter.first;width=delimiter.count
                fencedLines.append(NSRange(location:offset,length:length+1))
            }
            offset += length+1
        }
        return regex.matches(in:content,range:NSRange(location:0,length:ns.length)).filter { match in !fencedLines.contains(where:{NSLocationInRange(match.range.location,$0)}) }
    }
}
