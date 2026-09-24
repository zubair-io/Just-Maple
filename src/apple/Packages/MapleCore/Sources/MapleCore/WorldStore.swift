import Foundation
import CryptoKit

extension SQLite {
    func migrateWorld() throws {
        guard !["7", "8"].contains(try rows("PRAGMA user_version").first?["user_version"] ?? "0") else { return }
        try transaction {
            for sql in [
                "CREATE TABLE IF NOT EXISTS life_activities (id TEXT PRIMARY KEY, version INTEGER NOT NULL, json TEXT NOT NULL)",
                "CREATE TABLE IF NOT EXISTS life_tasks (id TEXT PRIMARY KEY, version INTEGER NOT NULL, json TEXT NOT NULL)",
                "CREATE TABLE IF NOT EXISTS task_activities (task_id TEXT REFERENCES life_tasks(id), activity_id TEXT REFERENCES life_activities(id), origin TEXT NOT NULL, created_at REAL NOT NULL, PRIMARY KEY(task_id,activity_id))",
                "CREATE TABLE IF NOT EXISTS world_states (id TEXT PRIMARY KEY, subject TEXT NOT NULL, property TEXT NOT NULL, json TEXT NOT NULL)",
                "CREATE INDEX IF NOT EXISTS world_state_lookup ON world_states(subject,property)",
                "CREATE TABLE IF NOT EXISTS world_history (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, json TEXT NOT NULL)",
                "CREATE TABLE IF NOT EXISTS world_commands (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL)",
                "CREATE TABLE IF NOT EXISTS task_suggestions (id TEXT PRIMARY KEY, fingerprint TEXT UNIQUE NOT NULL, source_key TEXT NOT NULL, json TEXT NOT NULL)",
                "CREATE TABLE IF NOT EXISTS task_series (id TEXT PRIMARY KEY, version INTEGER NOT NULL, json TEXT NOT NULL)",
                "CREATE TABLE IF NOT EXISTS task_occurrences (series_id TEXT REFERENCES task_series(id), occurrence_key TEXT NOT NULL, task_id TEXT UNIQUE REFERENCES life_tasks(id), PRIMARY KEY(series_id,occurrence_key))",
                "CREATE TABLE IF NOT EXISTS attention_ack (id TEXT PRIMARY KEY, until_at REAL)",
                "CREATE TABLE IF NOT EXISTS task_extraction_jobs (event_id TEXT PRIMARY KEY REFERENCES events(id), status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, error TEXT, lease_token TEXT, lease_until REAL)"
            ] { try execute(sql) }
            try execute("PRAGMA user_version = 7")
        }
    }
}

extension KnowledgeStore {
    func records<T: Decodable>(_ table: String, as type: T.Type) throws -> [T] {
        try db.rows("SELECT json FROM \(table) ORDER BY rowid").map { try JSONCodec.decode(type, from: Data($0["json"]!.utf8)) }
    }
    func record<T: Decodable>(_ table: String, id: String, as type: T.Type) throws -> T? {
        guard let json = try db.rows("SELECT json FROM \(table) WHERE id=?",[id]).first?["json"] else { return nil }
        return try JSONCodec.decode(type, from: Data(json.utf8))
    }
    func worldRevision() throws -> Int64 { Int64(try db.rows("SELECT coalesce(max(sequence),0) AS n FROM world_history").first?["n"] ?? "0") ?? 0 }
    @discardableResult
    func history<T: Encodable>(subjects:[String], type:String, before:T?, after:T?, command:String, at:Date, actor:String = "user", effectiveAt:Date? = nil) throws -> WorldHistory {
        let entry = WorldHistory(subjects: subjects, type: type, effectiveAt: effectiveAt ?? at, recordedAt: at, actor: actor,
            before: try before.map { try JSONCodec.string($0) }, after: try after.map { try JSONCodec.string($0) }, correlationID: command)
        try db.execute("INSERT INTO world_history(id,json) VALUES (?,?)",[entry.id,try JSONCodec.string(entry)])
        return entry
    }
    func command<T: Codable>(_ id:String, payload:String, body:() throws -> T) throws -> T {
        guard !id.isEmpty, id.utf8.count<=256 else { throw MapleError.invalid("A bounded request ID is required.") }
        let hash = SHA256.hash(data:Data(payload.utf8)).map { String(format:"%02x",$0) }.joined()
        return try db.transaction {
            if let row = try db.rows("SELECT fingerprint,result FROM world_commands WHERE id=?",[id]).first {
                guard row["fingerprint"] == hash else { throw MapleError.invalid("Request ID was reused for a different change.") }
                return try JSONCodec.decode(T.self,from:Data(row["result"]!.utf8))
            }
            let value = try body()
            try db.execute("INSERT INTO world_commands VALUES (?,?,?)",[id,hash,try JSONCodec.string(value)])
            return value
        }
    }
    func validateText(_ text:String, max:Int = 4096, required:Bool = false) throws {
        guard text.utf8.count<=max, !required || !text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty else { throw MapleError.invalid("A required field is empty or too long.") }
    }
    public func activities() throws -> [LifeActivity] { try records("life_activities",as:LifeActivity.self) }
    public func tasks() throws -> [LifeTask] { try records("life_tasks",as:LifeTask.self) }
    public func saveActivity(_ input:LifeActivity, expectedVersion:Int, requestID:String, at:Date = Date()) throws -> LifeActivity {
        try command(requestID,payload:JSONCodec.string(["activity":JSONCodec.string(input),"version":String(expectedVersion)])) {
            try validateText(input.id,max:256,required:true);try validateText(input.name,max:256,required:true);try validateText(input.purpose)
            let old = try record("life_activities",id:input.id,as:LifeActivity.self)
            guard (old?.version ?? 0) == expectedVersion else { throw MapleError.invalid("This activity changed. Your draft is preserved; reload the latest version before saving.") }
            var activity = input;activity.version = expectedVersion+1;activity.createdAt = old?.createdAt ?? at;activity.updatedAt = at
            try db.execute("INSERT INTO life_activities VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,json=excluded.json",[activity.id,String(activity.version),try JSONCodec.string(activity)])
            try history(subjects:[activity.id],type:old == nil ? "activity.created":"activity.updated",before:old,after:activity,command:requestID,at:at)
            return activity
        }
    }
    func validateTask(_ task:LifeTask) throws {
        try validateText(task.id,max:256,required:true);try validateText(task.title,max:512,required:true);try validateText(task.description)
        try validateText(task.assignee,max:512);try validateText(task.place,max:1024);try validateText(task.waitingReason,max:1024)
        guard (0...3).contains(task.priority), task.activityIDs.count<=50,task.people.count<=50,task.conditions.count<=10,task.evidenceIDs.count<=50 else { throw MapleError.invalid("Task context exceeds the supported limits.") }
        guard task.status != .waiting || !task.waitingReason.isEmpty || !task.assignee.isEmpty else { throw MapleError.invalid("Waiting tasks need a reason or a responsible person.") }
        for id in Set(task.activityIDs) { guard try record("life_activities",id:id,as:LifeActivity.self) != nil else { throw MapleError.invalid("An associated activity is unavailable.") } }
        for id in task.evidenceIDs { guard try event(id) != nil else { throw MapleError.invalid("Task evidence is unavailable.") } }
        for person in task.people { try validateText(person,max:512,required:true) }
        for condition in task.conditions {
            guard StateProperty.catalog.contains(where:{$0.key==condition.property}) else { throw MapleError.invalid("Unsupported state condition.") }
            try validateText(condition.subject,max:256,required:true);try validateText(condition.value,max:512,required:true)
        }
        _ = try task.due?.boundary();_ = try task.scheduled?.boundary()
    }
    func writeTask(_ task:LifeTask, at:Date) throws {
        try db.execute("INSERT INTO life_tasks VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,json=excluded.json",[task.id,String(task.version),try JSONCodec.string(task)])
        let existing = Set(try db.rows("SELECT activity_id FROM task_activities WHERE task_id=?",[task.id]).compactMap{$0["activity_id"]})
        for id in existing.subtracting(task.activityIDs) { try db.execute("DELETE FROM task_activities WHERE task_id=? AND activity_id=?",[task.id,id]) }
        for id in Set(task.activityIDs).subtracting(existing) { try db.execute("INSERT INTO task_activities VALUES (?,?,?,?)",[task.id,id,"user",String(at.timeIntervalSince1970)]) }
    }
    public func saveTask(_ input:LifeTask, expectedVersion:Int, requestID:String, at:Date = Date()) throws -> LifeTask {
        try command(requestID,payload:JSONCodec.string(["task":JSONCodec.string(input),"version":String(expectedVersion)])) {
            try validateTask(input)
            let old = try record("life_tasks",id:input.id,as:LifeTask.self)
            guard (old?.version ?? 0)==expectedVersion else { throw MapleError.invalid("This task changed. Your draft is preserved; reload the latest version before saving.") }
            var task = input;task.activityIDs = Array(Set(input.activityIDs)).sorted();task.version = expectedVersion+1
            task.createdAt = old?.createdAt ?? at;task.updatedAt = at
            task.seriesID = old?.seriesID;task.occurrenceKey = old?.occurrenceKey
            if let old,old.status != task.status {
                try db.execute("INSERT OR REPLACE INTO task_inference_corrections VALUES (?,'status')",["task:"+task.id])
                try db.execute("DELETE FROM task_progress_evidence WHERE id=?",["task:"+task.id])
            }
            task.completedAt = task.status == .completed ? (old?.completedAt ?? at) : nil
            try writeTask(task,at:at)
            try history(subjects:[task.id]+task.activityIDs,type:old == nil ? "task.created":old?.status != task.status ? "task.\(task.status.rawValue)":"task.updated",before:old,after:task,command:requestID,at:at)
            return task
        }
    }
    public func worldHistory(before:Int64? = nil, subjects:[String] = [], limit:Int = 100) throws -> [WorldHistory] {
        // Cursor orders committed records, independent of delayed effective event time.
        var result:[WorldHistory] = []
        for row in try db.rows("SELECT sequence,json FROM world_history WHERE sequence<? ORDER BY sequence DESC",[String(before ?? Int64.max)]) {
            var entry = try JSONCodec.decode(WorldHistory.self,from:Data(row["json"]!.utf8));entry.sequence = Int64(row["sequence"]!)!
            if subjects.isEmpty || !Set(subjects).isDisjoint(with:entry.subjects) { result.append(entry) }
            if result.count>=min(max(limit,1),200) { break }
        }
        return result
    }
}
