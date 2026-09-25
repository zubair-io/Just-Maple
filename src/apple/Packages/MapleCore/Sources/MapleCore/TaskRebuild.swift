import Foundation

public struct TaskRebuildRow: Codable, Sendable, Equatable {
    public let id: String
    public let json: String
}
public struct TaskRebuildSource: Codable, Sendable, Equatable {
    public let eventID: String
    public let eventJSON: String
    public let queue: [String: String]?
}
public struct TaskRebuildProtection: Codable, Sendable, Equatable {
    public let id: String
    public let reason: String
    public let json: String
}
/// Contains private local snapshots; callers should display counts/IDs, not log its JSON.
public struct TaskRebuildPlan: Codable, Sendable, Equatable {
    public let id: String
    public let createdAt: Date
    public let worldRevision: Int64
    public let canonicalTaskCount: Int
    public let archive: [TaskRebuildRow]
    public let machineRelations: [TaskRebuildRow]
    public let protected: [TaskRebuildProtection]
    public let sources: [TaskRebuildSource]
}
public struct TaskRebuildResult: Codable, Sendable {
    public let plan: TaskRebuildPlan
    public let afterRevision: Int64
    public let archived: [TaskRebuildRow]
    public let queues: [TaskRebuildSource]
}

extension KnowledgeStore {
    public func planTaskRebuild(at: Date = Date()) throws -> TaskRebuildPlan {
        try makeTaskRebuildPlan(id: UUID().uuidString, at: at)
    }
    private func makeTaskRebuildPlan(id: String, at: Date) throws -> TaskRebuildPlan {
        let suggestionRows = try db.rows("SELECT id,json FROM task_suggestions ORDER BY id")
        let rawSuggestions = Dictionary(uniqueKeysWithValues: suggestionRows.map { ($0["id"]!, $0["json"]!) })
        let suggestions = try suggestionRows.map { try JSONCodec.decode(TaskSuggestion.self, from: Data($0["json"]!.utf8)) }
        let relations = try taskRelations()
        let userHistory = try recordsHistoryForRebuild()
        let correctionNodes = Set(try db.rows("SELECT id FROM task_inference_corrections").compactMap { $0["id"] })
        let actionNodes = Set(try db.rows("SELECT node_id FROM task_action_mutations").compactMap { $0["node_id"] })
        var protectedNodes = correctionNodes.union(actionNodes).union(userHistory)
        for id in userHistory { protectedNodes.insert("source:" + id); protectedNodes.insert("task:" + id) }
        for suggestion in suggestions where ["accepted", "rejected"].contains(suggestion.reviewStatus) || suggestion.acceptedTaskID != nil || suggestion.linkedTaskID != nil || suggestion.candidate.status.terminal || suggestion.candidate.actionState != nil || suggestion.provider.isEmpty || suggestion.provider == "user" {
            protectedNodes.insert("source:" + suggestion.id)
        }
        for task in try tasks() { protectedNodes.insert("task:" + task.id) }
        var changed = true
        while changed {
            changed = false
            for relation in relations where protectedNodes.contains(relation.duplicateID) || protectedNodes.contains(relation.primaryID) {
                if protectedNodes.insert(relation.duplicateID).inserted { changed = true }
                if protectedNodes.insert(relation.primaryID).inserted { changed = true }
            }
        }
        var archive: [TaskRebuildRow] = [], protected: [TaskRebuildProtection] = []
        var sourceScopes = Set<String>()
        func scope(_ event: Event) throws -> String { try JSONCodec.string([event.source.connector, event.source.account, event.source.externalID]) }
        for suggestion in suggestions.sorted(by: { $0.id < $1.id }) {
            let node = "source:" + suggestion.id
            let reason: String?
            if suggestion.reviewStatus != "pending" { reason = "Previously reviewed or archived" }
            else if suggestion.provider.isEmpty || suggestion.provider == "user" { reason = "Manual or unknown origin" }
            else if suggestion.acceptedTaskID != nil || suggestion.linkedTaskID != nil { reason = "Linked to a reviewed or combined task" }
            else if suggestion.candidate.status.terminal || suggestion.candidate.actionState != nil { reason = "Completed, dismissed or explicitly deferred" }
            else if protectedNodes.contains(node) { reason = "Explicit user action or correction" }
            else { reason = nil }
            if let reason { protected.append(.init(id: suggestion.id, reason: reason, json: rawSuggestions[suggestion.id]!)); continue }
            // Unknown/missing source cannot safely be rebuilt.
            guard let event = try event(suggestion.eventID), ["gmail", "imessage"].contains(event.source.connector) else {
                protected.append(.init(id: suggestion.id, reason: "Outside message rebuild scope", json: rawSuggestions[suggestion.id]!)); continue
            }
            archive.append(.init(id: suggestion.id, json: rawSuggestions[suggestion.id]!))
            sourceScopes.insert(try scope(event))
        }
        let latest = try db.rows("""
            SELECT e.json FROM events e WHERE e.connector IN ('gmail','imessage')
            AND NOT EXISTS (SELECT 1 FROM events n WHERE n.connector=e.connector AND n.account=e.account
              AND n.external_id=e.external_id AND (n.received_at>e.received_at OR (n.received_at=e.received_at AND n.rowid>e.rowid)))
            ORDER BY e.id
            """).map { try JSONCodec.decode(Event.self, from: Data($0["json"]!.utf8)) }
        var sources: [TaskRebuildSource] = []
        for event in latest where AIProcessingWindow.includes(event.occurredAt, at: at) && event.occurredAt <= at {
            guard sourceScopes.contains(try scope(event)), !event.type.hasSuffix("unavailable"),
                  !(event.source.connector == "gmail" && TaskEvidenceRules.isOutgoing(event)) else { continue }
            sources.append(.init(eventID: event.id, eventJSON: try JSONCodec.string(event),
                                 queue: try db.rows("SELECT * FROM task_extraction_jobs WHERE event_id=?", [event.id]).first))
        }
        let archiveNodes = Set(archive.map { "source:" + $0.id })
        let machineRelations = try relations.filter { archiveNodes.contains($0.duplicateID) || archiveNodes.contains($0.primaryID) }
            .sorted { $0.duplicateID < $1.duplicateID }.map { TaskRebuildRow(id: $0.duplicateID, json: try JSONCodec.string($0)) }
        return .init(id: id, createdAt: Date(timeIntervalSince1970: at.timeIntervalSince1970), worldRevision: try worldRevision(), canonicalTaskCount: try tasks().count,
                     archive: archive, machineRelations: machineRelations, protected: protected, sources: sources)
    }
    private func recordsHistoryForRebuild() throws -> Set<String> {
        let rows = try db.rows("SELECT json FROM world_history WHERE json_extract(json,'$.actor')='user'")
        return Set(try rows.flatMap { try JSONCodec.decode(WorldHistory.self, from: Data($0["json"]!.utf8)).subjects })
    }
    /// Intended first for an isolated database copy. No model calls and no source/index/fact writes.
    public func applyTaskRebuild(_ plan: TaskRebuildPlan, at: Date = Date()) throws -> TaskRebuildResult {
        guard try db.rows("SELECT id FROM world_commands WHERE id=?", ["task-rebuild-rollback:" + plan.id]).isEmpty else {
            throw MapleError.invalid("This rebuild was rolled back. Create a new plan.")
        }
        return try command("task-rebuild:" + plan.id, payload: JSONCodec.string(plan)) {
            try applyTaskRebuildInTransaction(plan, at: at)
        }
    }
    private func applyTaskRebuildInTransaction(_ plan: TaskRebuildPlan, at: Date) throws -> TaskRebuildResult {
            guard try makeTaskRebuildPlan(id: plan.id, at: plan.createdAt) == plan else {
                throw MapleError.invalid("Task rebuild plan changed. Review a fresh plan before applying.")
            }
            guard plan.sources.allSatisfy({ AIProcessingWindow.includes((try? JSONCodec.decode(Event.self, from: Data($0.eventJSON.utf8)).occurredAt) ?? .distantPast, at: at) }) else {
                throw MapleError.invalid("Task rebuild sources expired. Review a fresh plan.")
            }
            // No worker can commit an old candidate across this maintenance boundary.
            guard try db.rows("SELECT event_id FROM task_extraction_jobs WHERE status='processing' AND lease_until>? LIMIT 1", [String(at.timeIntervalSince1970)]).isEmpty,
                  try db.rows("SELECT id FROM task_reconciliation_jobs WHERE status='running' AND lease_until>? LIMIT 1", [String(at.timeIntervalSince1970)]).isEmpty else {
                throw MapleError.invalid("Pause task workers and let active requests finish before rebuilding.")
            }
            for relation in plan.machineRelations { try db.execute("DELETE FROM task_relations WHERE duplicate_id=?", [relation.id]) }
            var archived: [TaskRebuildRow] = []
            for row in plan.archive {
                let before = try JSONCodec.decode(TaskSuggestion.self, from: Data(row.json.utf8))
                var after = before; after.reviewStatus = "superseded"; after.version += 1
                let json = try JSONCodec.string(after)
                try db.execute("UPDATE task_suggestions SET json=? WHERE id=?", [json, row.id])
                try history(subjects: [row.id], type: "suggestion.rebuild_archived", before: before, after: after, command: plan.id, at: at, actor: "task-rebuild")
                archived.append(.init(id: row.id, json: json))
            }
            var queues: [TaskRebuildSource] = []
            for source in plan.sources {
                try db.execute("""
                    INSERT INTO task_extraction_jobs(event_id) VALUES (?) ON CONFLICT(event_id) DO UPDATE SET
                    status='pending',attempts=0,error=NULL,lease_token=NULL,lease_until=NULL,error_code=NULL,next_attempt_at=0
                    """, [source.eventID])
                queues.append(.init(eventID: source.eventID, eventJSON: source.eventJSON,
                                    queue: try db.rows("SELECT * FROM task_extraction_jobs WHERE event_id=?", [source.eventID]).first))
            }
            return .init(plan: plan, afterRevision: try worldRevision(), archived: archived, queues: queues)
    }
    /// Rollback is safe only before subsequent extraction or user work changes this snapshot.
    /// History is retained; this does not restore a whole database over newer user changes.
    public func rollbackTaskRebuild(planID: String, at: Date = Date()) throws {
        let _: String = try command("task-rebuild-rollback:" + planID, payload: planID) {
            guard let json = try db.rows("SELECT result FROM world_commands WHERE id=?", ["task-rebuild:" + planID]).first?["result"] else { throw MapleError.invalid("Unknown task rebuild.") }
            let result = try JSONCodec.decode(TaskRebuildResult.self, from: Data(json.utf8))
            guard try worldRevision() == result.afterRevision else { throw MapleError.invalid("Tasks changed after rebuild; rollback would overwrite newer work.") }
            for row in result.archived {
                guard try db.rows("SELECT json FROM task_suggestions WHERE id=?", [row.id]).first?["json"] == row.json else { throw MapleError.invalid("Rebuilt task changed; rollback refused.") }
            }
            for source in result.queues {
                guard try db.rows("SELECT * FROM task_extraction_jobs WHERE event_id=?", [source.eventID]).first == source.queue else { throw MapleError.invalid("Rebuild processing started; rollback refused.") }
            }
            for relation in result.plan.machineRelations {
                guard try db.rows("SELECT duplicate_id FROM task_relations WHERE duplicate_id=?", [relation.id]).isEmpty else { throw MapleError.invalid("Rebuild relations changed; rollback refused.") }
                try db.execute("INSERT INTO task_relations(duplicate_id,json) VALUES (?,?)", [relation.id, relation.json])
            }
            for row in result.plan.archive { try db.execute("UPDATE task_suggestions SET json=? WHERE id=?", [row.json, row.id]) }
            for source in result.plan.sources {
                try db.execute("DELETE FROM task_extraction_jobs WHERE event_id=?", [source.eventID])
                if let row = source.queue {
                    let columns = ["event_id", "status", "attempts", "error", "lease_token", "lease_until", "next_attempt_at", "error_code"]
                    try db.execute("INSERT INTO task_extraction_jobs(\(columns.joined(separator: ","))) VALUES (?,?,?,?,?,?,?,?)", columns.map { row[$0] })
                }
            }
            try history(subjects: result.plan.archive.map(\.id), type: "tasks.rebuild_rolled_back", before: Optional<String>.none, after: planID, command: planID, at: at, actor: "task-rebuild")
            return planID
        }
    }
}

public struct TaskRebuildBatch: Codable, Sendable {
    public let eventID: String
    public let candidates: [TaskSuggestion]
    public init(eventID: String, candidates: [TaskSuggestion]) { self.eventID = eventID; self.candidates = candidates }
}
public struct TaskRebuildPromotion: Codable, Sendable {
    public let snapshot: TaskRebuildResult
    public let candidates: [TaskSuggestion]
    public let candidateIDMap: [String: String]
    public let reconciliation: StageReconciliationResult?
}
extension KnowledgeStore {
    /// Export only after every planned source completed successfully in the isolated copy.
    /// Empty successful batches are meaningful and must be preserved.
    public func exportTaskRebuild(_ plan: TaskRebuildPlan) throws -> [TaskRebuildBatch] {
        guard let json = try db.rows("SELECT result FROM world_commands WHERE id=?", ["task-rebuild:" + plan.id]).first?["result"],
              try JSONCodec.decode(TaskRebuildResult.self, from: Data(json.utf8)).plan == plan else {
            throw MapleError.invalid("This staging database has not applied the exact rebuild plan.")
        }
        for row in plan.protected {
            guard try db.rows("SELECT json FROM task_suggestions WHERE id=?", [row.id]).first?["json"] == row.json else { throw MapleError.invalid("Staging modified a protected task; export refused.") }
        }
        let protectedIDs = Set(plan.protected.map(\.id))
        return try plan.sources.map { source in
            guard try db.rows("SELECT status FROM task_extraction_jobs WHERE event_id=?", [source.eventID]).first?["status"] == "succeeded" else {
                throw MapleError.invalid("Rebuild is incomplete. Every planned source must succeed before export.")
            }
            let rows = try db.rows("SELECT json FROM task_suggestions WHERE json_extract(json,'$.eventID')=?", [source.eventID])
            let candidates = try rows.map { try JSONCodec.decode(TaskSuggestion.self, from: Data($0["json"]!.utf8)) }
                .filter { $0.reviewStatus == "pending" && !protectedIDs.contains($0.id) }
                .sorted { $0.id < $1.id }
            return .init(eventID: source.eventID, candidates: candidates)
        }
    }
    /// Atomic promotion onto the original snapshot: partial/failed staging never replaces the list.
    public func promoteTaskRebuild(_ plan: TaskRebuildPlan, batches: [TaskRebuildBatch], reconciliation: StageReconciliationResult? = nil, at: Date = Date()) throws -> TaskRebuildPromotion {
        let payload = try JSONCodec.string(plan) + JSONCodec.string(batches) + JSONCodec.string(reconciliation)
        return try command("task-rebuild-promote:" + plan.id, payload: payload) {
            guard batches.count == plan.sources.count, Set(batches.map(\.eventID)) == Set(plan.sources.map(\.eventID)) else {
                throw MapleError.invalid("Promotion requires one complete batch for every planned source.")
            }
            if let reconciliation { try validateStageReconciliationPromotion(reconciliation, batches: batches, at: at) }
            let canonicalBefore = try db.rows("SELECT id,json FROM life_tasks ORDER BY id")
            let snapshot = try applyTaskRebuildInTransaction(plan, at: at)
            var saved: [TaskSuggestion] = []
            var candidateIDMap: [String: String] = [:]
            guard Set(batches.flatMap { $0.candidates.map(\.id) }).count == batches.reduce(0, { $0 + $1.candidates.count }) else { throw MapleError.invalid("Rebuild candidate IDs must be unique.") }
            for batch in batches {
                guard batch.candidates.count <= 3, let source = try event(batch.eventID) else { throw MapleError.invalid("Invalid rebuild batch.") }
                for var suggestion in batch.candidates {
                    guard suggestion.eventID == source.id, suggestion.reviewStatus == "pending", suggestion.acceptedTaskID == nil,
                          suggestion.candidate.actionState == nil, !suggestion.candidate.status.terminal else { throw MapleError.invalid("Rebuild candidate contains reviewed user state.") }
                    let stageID = suggestion.id
                    suggestion.id = UUID().uuidString; suggestion.version = 0
                    suggestion.linkedTaskID = nil; suggestion.possibleDuplicateIDs = []
                    try TaskEvidenceRules.validateTitle(suggestion.candidate.title)
                    let reviewedStatus = suggestion.candidate.status
                    guard try TaskEvidenceRules.configureOwnership(&suggestion, obligation: suggestion.obligation, actorID: suggestion.actorID, event: source),
                          suggestion.candidate.status == reviewedStatus else { throw MapleError.invalid("Staged obligation ownership or status changed before promotion.") }
                    let actual = try offerTaskInTransaction(suggestion, at: at)
                    candidateIDMap[stageID] = actual.id
                    saved.append(actual)
                }
                try db.execute("UPDATE task_extraction_jobs SET status='succeeded',lease_token=NULL,lease_until=NULL,error=NULL,error_code=NULL WHERE event_id=?", [batch.eventID])
            }
            if let reconciliation {
                let protectedIDs = Set(plan.protected.map(\.id))
                var relations = try taskRelations()
                for staged in reconciliation.relations {
                    guard staged.duplicateID.hasPrefix("source:"), staged.primaryID.hasPrefix("source:"),
                          let duplicate = candidateIDMap[String(staged.duplicateID.dropFirst(7))],
                          let primary = candidateIDMap[String(staged.primaryID.dropFirst(7))],
                          !protectedIDs.contains(duplicate), !protectedIDs.contains(primary) else { throw MapleError.invalid("Staged relation cannot change protected or unknown tasks.") }
                    if duplicate == primary { continue }
                    let relation = TaskRelation(duplicateID: "source:" + duplicate, primaryID: "source:" + primary, reason: staged.reason, evidenceIDs: staged.evidenceIDs)
                    guard reconciliationRoot(relation.primaryID, relations: relations) != relation.duplicateID else { throw MapleError.invalid("Staged relation would create a cycle.") }
                    try db.execute("INSERT INTO task_relations(duplicate_id,json) VALUES (?,?)", [relation.duplicateID, try JSONCodec.string(relation)])
                    relations.append(relation)
                    try history(subjects: [primary, duplicate], type: "task.sources_combined", before: Optional<TaskRelation>.none, after: relation, command: plan.id, at: at, actor: "staged-reconciliation")
                }
                // Persist all component provenance on the visible root as well as the relation.
                for id in Set(candidateIDMap.values).sorted() {
                    let node = "source:" + id
                    guard reconciliationRoot(node, relations: relations) == node,
                          var root = try record("task_suggestions", id: id, as: TaskSuggestion.self) else { continue }
                    let members = saved.filter { reconciliationRoot("source:" + $0.id, relations: relations) == node }
                    let evidence = Set(root.candidate.evidenceIDs).union(members.flatMap { $0.candidate.evidenceIDs })
                    if evidence != Set(root.candidate.evidenceIDs) {
                        let before = root; root.candidate.evidenceIDs = evidence.sorted(); root.version += 1
                        try db.execute("UPDATE task_suggestions SET json=? WHERE id=?", [try JSONCodec.string(root), root.id])
                        try history(subjects: [root.id], type: "obligation.evidence_retained", before: before, after: root, command: plan.id, at: at, actor: "staged-reconciliation")
                    }
                }
                saved = try Set(candidateIDMap.values).sorted().compactMap { try record("task_suggestions", id: $0, as: TaskSuggestion.self) }
            }
            // Existing identity handling may retain evidence on a resolved record.
            // A rebuild promises exact preservation, so even that normally useful
            // side effect must abort the entire promotion instead of changing it.
            for row in plan.protected {
                guard try db.rows("SELECT json FROM task_suggestions WHERE id=?", [row.id]).first?["json"] == row.json else {
                    throw MapleError.invalid("Promotion would modify a protected task. Review the conflicting candidate before retrying.")
                }
            }
            guard try db.rows("SELECT id,json FROM life_tasks ORDER BY id") == canonicalBefore else {
                throw MapleError.invalid("Promotion would modify a manual or accepted task; no changes were applied.")
            }
            try history(subjects: saved.map(\.id), type: "tasks.rebuild_promoted", before: Optional<String>.none, after: plan.id, command: plan.id, at: at, actor: "task-rebuild")
            return .init(snapshot: snapshot, candidates: saved, candidateIDMap: candidateIDMap, reconciliation: reconciliation)
        }
    }
}

extension KnowledgeStore {
    /// Narrow staging repair for the historical extractor bug that retired a
    /// user-edited pending suggestion. Never accepts a user edit or arbitrary diff.
    public func repairTaskRebuildRetirements(_ plan: TaskRebuildPlan, at: Date = Date()) throws -> Int {
        try command("task-rebuild-repair:" + plan.id, payload: JSONCodec.string(plan)) {
            guard let json = try db.rows("SELECT result FROM world_commands WHERE id=?", ["task-rebuild:" + plan.id]).first?["result"],
                  try JSONCodec.decode(TaskRebuildResult.self, from: Data(json.utf8)).plan == plan,
                  try db.rows("SELECT id FROM world_history WHERE sequence>? AND json_extract(json,'$.actor')='user' LIMIT 1", [String(plan.worldRevision)]).isEmpty else {
                throw MapleError.invalid("Protected-task repair requires the unchanged isolated staging run.")
            }
            for source in plan.sources {
                guard try db.rows("SELECT status FROM task_extraction_jobs WHERE event_id=?", [source.eventID]).first?["status"] == "succeeded" else {
                    throw MapleError.invalid("Finish staged reviews before repairing protected task retirements.")
                }
            }
            var count = 0
            for row in plan.protected {
                guard let current = try db.rows("SELECT json FROM task_suggestions WHERE id=?", [row.id]).first?["json"] else { throw MapleError.invalid("Protected task is missing; repair refused.") }
                if current == row.json { continue }
                let original = try JSONCodec.decode(TaskSuggestion.self, from: Data(row.json.utf8))
                var expected = original; expected.reviewStatus = "superseded"; expected.version += 1
                let changes = try db.rows("""
                    SELECT h.json FROM world_history h WHERE h.sequence>? AND EXISTS
                    (SELECT 1 FROM json_each(h.json,'$.subjects') j WHERE j.value IN (?,?)) ORDER BY h.sequence
                    """, [String(plan.worldRevision), row.id, "source:" + row.id])
                    .map { try JSONCodec.decode(WorldHistory.self, from: Data($0["json"]!.utf8)) }
                guard original.reviewStatus == "pending", try JSONCodec.string(expected) == current, changes.count == 1,
                      let change = changes.first, change.actor == "extraction", change.type == "suggestion.reprocessed",
                      change.before == (try JSONCodec.string(original)), change.after == current else {
                    throw MapleError.invalid("Protected task has changes beyond automatic retirement; repair refused.")
                }
                try db.execute("UPDATE task_suggestions SET json=? WHERE id=?", [row.json, row.id])
                try history(subjects: [row.id], type: "suggestion.rebuild_protected_restored", before: expected, after: original,
                            command: plan.id, at: at, actor: "task-rebuild")
                count += 1
            }
            return count
        }
    }
}
