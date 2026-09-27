import Foundation
import CryptoKit

extension SQLite {
    /// Additive feature migration: existing Markdown, events, tasks and history remain untouched.
    func migrateDailyNotes() throws {
        try transaction {
            try execute("CREATE TABLE IF NOT EXISTS daily_notes (day TEXT PRIMARY KEY, time_zone TEXT NOT NULL, created_at REAL NOT NULL)")
            try execute("CREATE TABLE IF NOT EXISTS daily_blocks (id TEXT PRIMARY KEY, day TEXT NOT NULL REFERENCES daily_notes(day), position INTEGER NOT NULL, version INTEGER NOT NULL, source_key TEXT UNIQUE, json TEXT NOT NULL)")
            try execute("CREATE INDEX IF NOT EXISTS daily_blocks_day_order ON daily_blocks(day,position,id)")
        }
    }
}

extension KnowledgeStore {
    /// Calendar dates are local labels, never UTC slices or intervals of 86,400 seconds.
    private func validateDailyDay(_ day: String, timeZone: String) throws {
        guard day.utf8.count == 10, day.utf8.enumerated().allSatisfy({ index, value in
            (index == 4 || index == 7) ? value == 45 : (48...57).contains(value)
        }), !day.hasPrefix("0000"), TimeZone(identifier: timeZone) != nil else { throw MapleError.invalid("Use a valid YYYY-MM-DD date and named time zone.") }
        var due = DueSpec(); due.date = day; due.timeZone = timeZone
        _ = try due.boundary()
    }
    private func validateDailyInstant(_ at: Date) throws {
        guard at.timeIntervalSince1970.isFinite else { throw MapleError.invalid("Invalid daily note timestamp.") }
    }
    private func dailyCommandID(_ requestID: String, category: String) throws -> String {
        try validateText(requestID, max: 256, required: true)
        return "daily:" + category + ":" + SHA256.hash(data: Data(requestID.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    private func ensureDailyNote(_ day: String, timeZone: String, at: Date) throws {
        try db.execute("INSERT OR IGNORE INTO daily_notes VALUES (?,?,?)", [day, timeZone, String(at.timeIntervalSince1970)])
    }
    private func dailyCapacity(_ day: String) throws {
        let count = Int(try db.rows("SELECT count(*) AS n FROM daily_blocks WHERE day=?", [day]).first?["n"] ?? "0") ?? 0
        guard count < 500 else { throw MapleError.invalid("This day has reached its 500-block limit. Choose another day.") }
    }
    private func nextDailyPosition(_ day: String) throws -> Int {
        (Int(try db.rows("SELECT coalesce(max(position),-1) AS n FROM daily_blocks WHERE day=?", [day]).first?["n"] ?? "-1") ?? -1) + 1
    }
    private func dailyBlock(_ id: String) throws -> DailyBlock? { try record("daily_blocks", id: id, as: DailyBlock.self) }
    private func dailySourceBlock(_ key: String) throws -> DailyBlock? {
        guard let json = try db.rows("SELECT json FROM daily_blocks WHERE source_key=?", [key]).first?["json"] else { return nil }
        return try JSONCodec.decode(DailyBlock.self, from: Data(json.utf8))
    }
    private func writeDailyBlock(_ block: DailyBlock, sourceKey: String? = nil) throws {
        try db.execute("INSERT INTO daily_blocks (id,day,position,version,source_key,json) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET day=excluded.day,position=excluded.position,version=excluded.version,json=excluded.json", [block.id, block.day, String(block.position), String(block.version), sourceKey, try JSONCodec.string(block)])
    }
    private func dailyRecord(_ before: DailyBlock?, _ after: DailyBlock, kind: String, requestID: String, actor: DailyBlockActor, at: Date) throws {
        _ = try history(subjects: [after.id, "daily:" + after.day] + (before.map { $0.day == after.day ? [] : ["daily:" + $0.day] } ?? []), type: "daily.block." + kind, before: before, after: after, command: requestID, at: at, actor: actor.rawValue)
    }
    public func dailyNote(day: String, timeZone: String, at: Date = Date()) throws -> DailyNoteSnapshot {
        try validateDailyDay(day, timeZone: timeZone); try validateDailyInstant(at)
        let blocks = try db.rows("SELECT json FROM daily_blocks WHERE day=? ORDER BY position,id", [day]).map { try JSONCodec.decode(DailyBlock.self, from: Data($0["json"]!.utf8)) }
        return DailyNoteSnapshot(day: day, timeZone: timeZone, blocks: blocks.filter { $0.clearedAt == nil }, cleared: blocks.filter { $0.clearedAt != nil }, revision: try worldRevision())
    }
    public func dailyBlockHistory(id: String, before: Int64? = nil) throws -> [WorldHistory] {
        try validateText(id, max: 256, required: true)
        return try worldHistory(before: before, subjects: [id]).filter { $0.type.hasPrefix("daily.block.") }
    }
    public func mutateDailyBlock(_ input: DailyBlockMutation, actor: DailyBlockActor = .user, at: Date = Date()) throws -> DailyNoteSnapshot {
        try validateDailyDay(input.day, timeZone: input.timeZone); try validateDailyInstant(at)
        try validateText(input.blockID, max: 256, required: true)
        guard input.expectedVersion >= 0, input.position.map({ (0...1_000_000).contains($0) }) ?? true else { throw MapleError.invalid("Invalid block version or position.") }
        if let content = input.content { try validateText(content, max: 65_536) }
        if let target = input.targetDay { try validateDailyDay(target, timeZone: input.timeZone) }
        guard input.targetDay == nil || input.kind == .move,
              (input.content == nil && input.blockKind == nil && input.position == nil) || input.kind == .create || input.kind == .edit else { throw MapleError.invalid("Unexpected fields for this block action.") }
        let key = try dailyCommandID(input.requestID, category: "mutation")
        return try command(key, payload: JSONCodec.string(["input": try JSONCodec.string(input), "actor": actor.rawValue])) {
            let before = try dailyBlock(input.blockID)
            guard (before?.version ?? 0) == input.expectedVersion else { throw MapleError.invalid("This block changed. Your draft is preserved; reload before saving.") }
            var block: DailyBlock
            if input.kind == .create {
                guard before == nil, let content = input.content, let kind = input.blockKind else { throw MapleError.invalid("A new block needs content and a type.") }
                try dailyCapacity(input.day); try ensureDailyNote(input.day, timeZone: input.timeZone, at: at)
                block = DailyBlock(id: input.blockID, day: input.day, kind: kind, content: content, position: try input.position ?? nextDailyPosition(input.day), createdAt: at, updatedAt: at, actor: actor, userEdited: actor == .user)
            } else {
                guard let existing = before, existing.day == input.day else { throw MapleError.invalid("This block is no longer on this day. Reload before applying the change.") }
                block = existing
                switch input.kind {
                case .edit:
                    guard existing.clearedAt == nil, input.content != nil || input.blockKind != nil || input.position != nil else { throw MapleError.invalid("Restore this block before editing it.") }
                    guard actor != .bot || !existing.userEdited else { throw MapleError.invalid("Automatic updates cannot overwrite your edited block.") }
                    if let kind = input.blockKind {
                        guard existing.taskNodeID == nil || kind == .task else { throw MapleError.invalid("A linked task must keep its task type.") }
                        block.kind = kind
                    }
                    if let content = input.content { block.content = content }
                    if let position = input.position { block.position = position }
                    if actor == .user { block.userEdited = true }
                case .clear:
                    guard existing.clearedAt == nil else { throw MapleError.invalid("This block is already cleared.") }
                    block.clearedAt = at
                case .restore:
                    guard existing.clearedAt != nil else { throw MapleError.invalid("This block is already visible.") }
                    block.clearedAt = nil
                case .move:
                    guard existing.clearedAt == nil, let target = input.targetDay, target != existing.day else { throw MapleError.invalid("Choose another day for this visible block.") }
                    try dailyCapacity(target); try ensureDailyNote(target, timeZone: input.timeZone, at: at)
                    block.day = target; block.position = try nextDailyPosition(target)
                case .complete:
                    guard existing.kind == .task, existing.clearedAt == nil, existing.completedAt == nil else { throw MapleError.invalid("Only an unfinished visible task can be completed.") }
                    if let nodeID = existing.taskNodeID, let version = existing.taskVersion {
                        let result = try applyTaskActionInTransaction(nodeID: nodeID, change: TaskActionChange(kind: "done", issuedAt: at), expectedVersion: version, requestID: key, scope: "daily-note", at: at)
                        block.taskVersion = result.version
                    }
                    block.completedAt = at; block.clearedAt = at
                case .create: break
                }
                block.version += 1; block.updatedAt = at; block.actor = actor
            }
            try writeDailyBlock(block)
            try dailyRecord(before, block, kind: input.kind.rawValue, requestID: key, actor: actor, at: at)
            return try dailyNote(day: input.day, timeZone: input.timeZone, at: at)
        }
    }
    private func dailyCarryCandidates(before day: String) throws -> [DailyBlock] {
        let older = try db.rows("SELECT json FROM daily_blocks WHERE day<? AND json_extract(json,'$.kind')='task' AND json_extract(json,'$.clearedAt') IS NULL AND json_extract(json,'$.completedAt') IS NULL ORDER BY day,position,id", [day]).map { try JSONCodec.decode(DailyBlock.self, from: Data($0["json"]!.utf8)) }
        return try older.filter { block in
            // A task resolved elsewhere must not be carried as unfinished.
            if let nodeID = block.taskNodeID, let task = try taskNode(nodeID), task.status.terminal { return false }
            return true
        }
    }
    /// Automatic reads recheck current-day carry-forward without recording empty commands.
    /// Explicit carry requests retain their original, durable replay behavior below.
    public func refreshDailyCarryForward(to day: String, timeZone: String, at: Date = Date()) throws -> DailyNoteSnapshot {
        try validateDailyDay(day, timeZone: timeZone); try validateDailyInstant(at)
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian); formatter.timeZone = TimeZone(identifier: timeZone); formatter.dateFormat = "yyyy-MM-dd"
        guard day == formatter.string(from: at) else { throw MapleError.invalid("Automatic carry-forward is only available for Today.") }
        let candidates = try dailyCarryCandidates(before: day)
        guard !candidates.isEmpty else { return try dailyNote(day: day, timeZone: timeZone, at: at) }
        let identity = try JSONCodec.string(["day": day, "timeZone": timeZone, "blocks": try JSONCodec.string(candidates.map { [$0.id, String($0.version)] })])
        let requestID = "automatic-carry:" + SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
        return try carryForwardDailyBlocks(to: day, timeZone: timeZone, requestID: requestID, at: at)
    }
    public func carryForwardDailyBlocks(to day: String, timeZone: String, requestID: String, at: Date = Date()) throws -> DailyNoteSnapshot {
        try validateDailyDay(day, timeZone: timeZone); try validateDailyInstant(at)
        let key = try dailyCommandID(requestID, category: "carry")
        return try command(key, payload: JSONCodec.string(["day": day, "timeZone": timeZone])) {
            let older = try dailyCarryCandidates(before: day)
            try ensureDailyNote(day, timeZone: timeZone, at: at)
            for old in older {
                try dailyCapacity(day)
                var block = old; block.day = day; block.position = try nextDailyPosition(day); block.version += 1; block.updatedAt = at; block.actor = .bot
                try writeDailyBlock(block); try dailyRecord(old, block, kind: "carried", requestID: key, actor: .bot, at: at)
            }
            return try dailyNote(day: day, timeZone: timeZone, at: at)
        }
    }
}

extension KnowledgeStore {
    private func dailyProjectionID(_ key: String) -> String {
        "daily-source:" + SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    private func dailyExcerpt(_ content: String) -> String {
        if content.utf8.count <= 65_536 { return content }
        var result = String(decoding: content.utf8.prefix(65_500), as: UTF8.self)
        while result.utf8.count > 65_500 { result.removeLast() }
        return result + "\n… [Open source for full text]"
    }
    private func dailyProvenance(_ event: Event, key: String) -> DailyBlockSource {
        let headers = event.content.components(separatedBy: "\n").prefix(16)
        func field(_ names: [String]) -> String? {
            for name in names {
                if let line = headers.first(where: { $0.hasPrefix(name + ": ") }) { return String(line.dropFirst(name.count + 2).prefix(240)) }
            }
            return nil
        }
        return DailyBlockSource(key: key, eventID: event.id, connector: event.source.connector, title: field(["Subject", "Title"]), sender: field(["Sender", "From"]))
    }
    /// Project an already-ingested observation. Its immutable evidence is never edited.
    /// Caller selects actionable sources; revision delivery order cannot regress a block.
    public func upsertDailySource(eventID: String, day: String, timeZone: String, kind: DailyBlockKind, requestID: String, at: Date = Date()) throws -> DailyBlock {
        // This path is an explicit projection. Automatic arrivals use the attention-only API below.
        try projectDailySource(eventID: eventID, day: day, timeZone: timeZone, kind: kind, requestID: requestID, at: at)
    }
    public func upsertDailyAttentionSource(eventID: String, day: String, timeZone: String, kind: DailyBlockKind, requestID: String, at: Date = Date()) throws -> DailyBlock? {
        try validateDailyDay(day, timeZone: timeZone); try validateDailyInstant(at)
        try validateText(eventID, max: 1024, required: true)
        guard let requested = try event(eventID) else { throw MapleError.invalid("Source evidence is unavailable.") }
        let row = try db.rows("SELECT id FROM events WHERE connector=? AND account=? AND external_id=? ORDER BY received_at DESC,rowid DESC LIMIT 1", [requested.source.connector, requested.source.account, requested.source.externalID]).first!
        guard let decision = try decision(eventID: row["id"]!), [.notify, .askUser].contains(decision.route),
              try !db.rows("SELECT id FROM work_items WHERE event_id=? AND status='unread' AND kind IN ('notify','ask_user') LIMIT 1", [row["id"]!]).isEmpty else { return nil }
        // KnowledgeStore isolation is held across this synchronous check and transaction.
        // A pending/retain latest revision cannot be accidentally surfaced by an older decision.
        return try projectDailySource(eventID: eventID, day: day, timeZone: timeZone, kind: kind, requestID: requestID, at: at)
    }
    private func projectDailySource(eventID: String, day: String, timeZone: String, kind: DailyBlockKind, requestID: String, at: Date) throws -> DailyBlock {
        try validateDailyDay(day, timeZone: timeZone); try validateDailyInstant(at)
        try validateText(eventID, max: 1024, required: true)
        guard [.email, .message, .text, .code].contains(kind) else { throw MapleError.invalid("Sources cannot silently create task completion state.") }
        guard let requested = try event(eventID) else { throw MapleError.invalid("Source evidence is unavailable.") }
        let key = try dailyCommandID(requestID, category: "source")
        return try command(key, payload: JSONCodec.string(["eventID": eventID, "day": day, "timeZone": timeZone, "kind": kind.rawValue])) {
            let row = try db.rows("SELECT json FROM events WHERE connector=? AND account=? AND external_id=? ORDER BY received_at DESC,rowid DESC LIMIT 1", [requested.source.connector, requested.source.account, requested.source.externalID]).first!
            let event = try JSONCodec.decode(Event.self, from: Data(row["json"]!.utf8))
            let sourceKey = "event:" + (try JSONCodec.string([event.source.connector, event.source.account, event.source.externalID]))
            let before = try dailySourceBlock(sourceKey)
            if let before, before.source?.eventID == event.id { return before }
            var block: DailyBlock
            if let old = before {
                block = old
                if !old.userEdited { block.content = dailyExcerpt(event.content); block.kind = kind }
                // Do not move or resurrect an item because its source received another revision.
                block.source = dailyProvenance(event, key: sourceKey); block.version += 1; block.updatedAt = at; block.actor = .bot
            } else {
                try dailyCapacity(day); try ensureDailyNote(day, timeZone: timeZone, at: at)
                block = DailyBlock(id: dailyProjectionID(sourceKey), day: day, kind: kind, content: dailyExcerpt(event.content), position: try nextDailyPosition(day), createdAt: at, updatedAt: at, actor: .bot, source: dailyProvenance(event, key: sourceKey))
            }
            try writeDailyBlock(block, sourceKey: sourceKey)
            try dailyRecord(before, block, kind: before == nil ? "arrived" : "sourceUpdated", requestID: key, actor: .bot, at: at)
            return block
        }
    }
    /// Existing accepted/canonical tasks retain their identity; suggestions are not promoted.
    public func upsertDailyTask(taskID: String, day: String, timeZone: String, requestID: String, at: Date = Date()) throws -> DailyBlock {
        try validateDailyDay(day, timeZone: timeZone); try validateDailyInstant(at)
        try validateText(taskID, max: 256, required: true)
        let key = try dailyCommandID(requestID, category: "task")
        return try command(key, payload: JSONCodec.string(["taskID": taskID, "day": day, "timeZone": timeZone])) {
            guard let task = try record("life_tasks", id: taskID, as: LifeTask.self) else { throw MapleError.invalid("The canonical task is unavailable.") }
            let sourceKey = "task:" + task.id
            let before = try dailySourceBlock(sourceKey)
            if let before, before.taskVersion == task.version { return before }
            guard before != nil || !task.status.terminal else { throw MapleError.invalid("Resolved tasks do not create new daily blocks.") }
            let content = task.title + (task.description.isEmpty ? "" : "\n\n" + task.description)
            var block: DailyBlock
            if let old = before {
                block = old
                if !old.userEdited { block.content = dailyExcerpt(content) }
                block.version += 1; block.updatedAt = at; block.actor = .bot
            } else {
                try dailyCapacity(day); try ensureDailyNote(day, timeZone: timeZone, at: at)
                block = DailyBlock(id: dailyProjectionID(sourceKey), day: day, kind: .task, content: dailyExcerpt(content), position: try nextDailyPosition(day), createdAt: at, updatedAt: at, actor: .bot)
            }
            block.taskNodeID = sourceKey; block.taskVersion = task.version
            if task.status.terminal {
                block.clearedAt = block.clearedAt ?? at
                block.completedAt = task.status == .completed ? (task.completedAt ?? at) : block.completedAt
            }
            if let evidenceID = task.evidenceIDs.first, let evidence = try event(evidenceID) { block.source = dailyProvenance(evidence, key: sourceKey) }
            try writeDailyBlock(block, sourceKey: sourceKey)
            try dailyRecord(before, block, kind: before == nil ? "taskLinked" : "taskUpdated", requestID: key, actor: .bot, at: at)
            return block
        }
    }
}

extension KnowledgeStore {
    /// Refresh already-linked blocks, including tasks resolved outside this page.
    /// This never creates a block for a newly encountered terminal task.
    public func reconcileDailyTaskBlocks(day: String, timeZone: String, at: Date = Date()) throws {
        try validateDailyDay(day, timeZone: timeZone); try validateDailyInstant(at)
        let blocks = try db.rows("SELECT json FROM daily_blocks WHERE day=? AND json_extract(json,'$.taskNodeID') IS NOT NULL", [day]).map { try JSONCodec.decode(DailyBlock.self, from: Data($0["json"]!.utf8)) }
        for block in blocks {
            guard let nodeID = block.taskNodeID, nodeID.hasPrefix("task:"), let task = try record("life_tasks", id: String(nodeID.dropFirst(5)), as: LifeTask.self), task.version != block.taskVersion else { continue }
            let identity = try JSONCodec.string(["task": task.id, "version": String(task.version), "day": day, "zone": timeZone])
            let requestID = "reconcile:" + SHA256.hash(data: Data(identity.utf8)).map { String(format: "%02x", $0) }.joined()
            _ = try upsertDailyTask(taskID: task.id, day: day, timeZone: timeZone, requestID: requestID, at: at)
        }
    }
}
