import Foundation
import Testing
@testable import MapleCore

struct TaskRebuildTests {
    func seed(_ store: KnowledgeStore, id: String = "fixture", age: TimeInterval = 0) async throws -> TaskSuggestion {
        let event = Event(type: "message.received", source: Source(connector: "gmail", account: "fixture", externalID: id, revision: "1"), occurredAt: Date().addingTimeInterval(-age), subjects: ["person:self", "thread:gmail:fixture"], content: "Direction: incoming\nBody:\nPlease send the form.")
        try await store.ingest(event)
        var suggestion = TaskSuggestion(); suggestion.eventID = event.id; suggestion.provider = "fixture"; suggestion.quote = "Please send the form."
        suggestion.obligation = "user_action"; suggestion.actorID = "person:self"; suggestion.candidate.title = "Send the form"
        return try await store.offerTask(suggestion)
    }
    @Test func planPreservesActionsAndCanonicalTasksAndExcludesOldAI() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let fresh = try await seed(store), old = try await seed(store, id: "old", age: 31*86400)
        let deferred = try await seed(store, id: "later")
        _ = try await store.applyTaskAction(nodeID: "source:" + deferred.id, change: .init(kind: "later", issuedAt: Date(), resurfaceAt: Date().addingTimeInterval(3600)), expectedVersion: deferred.version, requestID: "defer", scope: "fixture")
        var manual = LifeTask(); manual.title = "Manual task"
        _ = try await store.saveTask(manual, expectedVersion: 0, requestID: "manual")
        let plan = try await store.planTaskRebuild()
        #expect(Set(plan.archive.map(\.id)) == Set([fresh.id, old.id]))
        #expect(plan.sources.map(\.eventID) == [fresh.eventID])
        #expect(plan.protected.contains { $0.id == deferred.id })
        #expect(plan.canonicalTaskCount == 1)
    }
    @Test func applyRetryAndRollbackPreserveRawEvidence() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let suggestion = try await seed(store), plan = try await store.planTaskRebuild()
        let count = try await store.eventCount()
        let decoded = try JSONCodec.decode(TaskRebuildPlan.self, from: JSONCodec.encode(plan))
        #expect(decoded == plan)
        let first = try await store.applyTaskRebuild(decoded)
        let second = try await store.applyTaskRebuild(plan)
        #expect(first.afterRevision == second.afterRevision)
        #expect(try await store.rebuildSuggestion(suggestion.id)?.reviewStatus == "superseded")
        #expect(try await store.eventCount() == count)
        try await store.rollbackTaskRebuild(planID: plan.id)
        try await store.rollbackTaskRebuild(planID: plan.id)
        #expect(try await store.rebuildSuggestion(suggestion.id)?.reviewStatus == "pending")
        #expect(try await store.taskExtractionQueue().isEmpty)
    }
    @Test func newerUserActionInvalidatesPlanAndRollback() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let source = try await seed(store), plan = try await store.planTaskRebuild()
        _ = try await store.applyTaskAction(nodeID: "source:" + source.id, change: .init(kind: "done", issuedAt: Date()), expectedVersion: source.version, requestID: "done", scope: "fixture")
        await #expect(throws: Error.self) { try await store.applyTaskRebuild(plan) }
        #expect(try await store.rebuildSuggestion(source.id)?.candidate.status == .completed)
        let other = try await seed(store, id: "other"), next = try await store.planTaskRebuild()
        _ = try await store.applyTaskRebuild(next)
        _ = try #require(await store.acquireTaskExtraction(at: Date(), eventIDs: [other.eventID]))
        await #expect(throws: Error.self) { try await store.rollbackTaskRebuild(planID: next.id) }
    }
    @Test func promotionIsAtomicReusesSameFingerprintAndSupportsEmptyBatches() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let source = try await seed(store), removed = try await seed(store, id: "empty"), plan = try await store.planTaskRebuild()
        var replacement = source; replacement.candidate.description = "Rebuilt concrete instructions"
        let batches = [TaskRebuildBatch(eventID: source.eventID, candidates: [replacement]), .init(eventID: removed.eventID, candidates: [])]
        await #expect(throws: Error.self) { try await store.promoteTaskRebuild(plan, batches: Array(batches.prefix(1))) }
        #expect(try await store.rebuildSuggestion(source.id)?.reviewStatus == "pending")
        let result = try await store.promoteTaskRebuild(plan, batches: batches)
        let retry = try await store.promoteTaskRebuild(plan, batches: batches)
        #expect(result.candidates.count == 1 && retry.candidates.first?.id == source.id)
        #expect(result.candidates.first?.candidate.description == "Rebuilt concrete instructions")
        #expect(try await store.rebuildSuggestion(removed.id)?.reviewStatus == "superseded")
    }
    @Test func exportRequiresEverySourceToSucceedAndInvalidPromotionRollsBack() async throws {
        let staging = try KnowledgeStore(path: ":memory:")
        let source = try await seed(staging), plan = try await staging.planTaskRebuild()
        _ = try await staging.applyTaskRebuild(plan)
        await #expect(throws: Error.self) { try await staging.exportTaskRebuild(plan) }
        let (_, token) = try #require(await staging.acquireTaskExtraction(at: Date(), eventIDs: [source.eventID]))
        try await staging.commitTaskExtraction([], eventID: source.eventID, token: token)
        let batches = try await staging.exportTaskRebuild(plan)
        #expect(batches.count == 1 && batches[0].candidates.isEmpty)
        let live = try KnowledgeStore(path: ":memory:")
        var invalid = try await seed(live); let livePlan = try await live.planTaskRebuild()
        invalid.quote = "Unsupported source text"
        await #expect(throws: Error.self) { try await live.promoteTaskRebuild(livePlan, batches: [.init(eventID: invalid.eventID, candidates: [invalid])]) }
        #expect(try await live.rebuildSuggestion(invalid.id)?.reviewStatus == "pending")
        #expect(try await live.taskExtractionQueue().isEmpty)
    }
    @Test func pureMachineRelationsAreRebuiltButUserLinkedRelationsAreProtected() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let first = try await seed(store, id: "first"), second = try await seed(store, id: "second")
        try await store.seedRebuildRelation(first.id, second.id)
        let plan = try await store.planTaskRebuild()
        #expect(plan.archive.count == 2 && plan.machineRelations.count == 1)
        _ = try await store.applyTaskRebuild(plan)
        #expect(try await store.taskRelations().isEmpty)
        try await store.rollbackTaskRebuild(planID: plan.id)
        #expect(try await store.taskRelations().count == 1)
        await #expect(throws: Error.self) { try await store.applyTaskRebuild(plan) }
        try await store.seedRebuildEdit(first.id)
        let protected = try await store.planTaskRebuild()
        #expect(protected.archive.isEmpty && protected.protected.count == 2)
    }

    @Test func stagedRelationsPromoteAtomicallyWithMappedIDsAndVisibleRootEvidence() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let live = try KnowledgeStore(path: folder.appendingPathComponent("live.sqlite").path)
        let first = try await seed(live, id: "first"), second = try await seed(live, id: "second")
        let plan = try await live.planTaskRebuild()
        let stagingPath = folder.appendingPathComponent("staging.sqlite").path
        try await live.copyRebuildFixture(to: stagingPath)
        let staging = try KnowledgeStore(path: stagingPath)
        _ = try await staging.applyTaskRebuild(plan)
        for original in [first, second] {
            let (_, token) = try #require(await staging.acquireTaskExtraction(at: Date(), eventIDs: [original.eventID]))
            try await staging.commitTaskExtraction([original], eventID: original.eventID, token: token)
        }
        let batches = try await staging.exportTaskRebuild(plan)
        let candidates = batches.flatMap(\.candidates)
        let versions = Dictionary(uniqueKeysWithValues: candidates.map { ("source:" + $0.id, $0.version) })
        let job = try await staging.prepareStageReconciliation(runID: "fixture-reconcile", nodeVersions: versions)
        let response: [String: Any] = ["progress": [], "duplicates": [[
            "firstID": "source:" + first.id, "secondID": "source:" + second.id,
            "firstEventID": first.eventID, "secondEventID": second.eventID,
            "firstQuote": first.quote, "secondQuote": second.quote,
            "reason": "Synthetic equivalent form requests", "confidence": 0.99
        ]]]
        let raw = String(decoding: try JSONSerialization.data(withJSONObject: response), as: UTF8.self)
        let reconciliation = try await staging.finishStageReconciliation(job, response: raw)
        let promoted = try await live.promoteTaskRebuild(plan, batches: batches, reconciliation: reconciliation)
        #expect(promoted.candidateIDMap[first.id] == first.id)
        #expect(promoted.candidateIDMap[second.id] == second.id)
        let relation = try #require(await live.taskRelations().first)
        let root = try #require(await live.rebuildSuggestion(String(relation.primaryID.dropFirst(7))))
        #expect(Set(root.candidate.evidenceIDs) == Set([first.eventID, second.eventID]))
        #expect(try await live.eventCount() == 2)
        _ = try await live.promoteTaskRebuild(plan, batches: batches, reconciliation: reconciliation)
        #expect(try await live.taskRelations().count == 1)
    }

    @Test func matchingResolvedIdentityCannotMutateProtectedEvidenceDuringPromotion() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let original = try await seed(store)
        _ = try await store.reviewSuggestion(id: original.id, action: "reject", edited: nil, expectedVersion: original.version, requestID: "dismiss-fixture")
        let before = try #require(await store.rebuildRawSuggestion(original.id))
        let event = Event(type: "message.received", source: Source(connector: "gmail", account: "fixture", externalID: "fixture", revision: "2"), occurredAt: Date(), receivedAt: Date().addingTimeInterval(1), subjects: ["person:self", "thread:gmail:fixture"], content: "Direction: incoming\nBody:\nPlease send the form.")
        try await store.ingest(event)
        var pending = original; pending.id = UUID().uuidString; pending.eventID = event.id; pending.candidate.title = "Review the form"
        pending = try await store.offerTask(pending)
        let plan = try await store.planTaskRebuild()
        #expect(plan.archive.map(\.id) == [pending.id])
        var incoming = pending; incoming.candidate.title = original.candidate.title
        await #expect(throws: Error.self) { try await store.promoteTaskRebuild(plan, batches: [.init(eventID: event.id, candidates: [incoming])]) }
        #expect(try await store.rebuildRawSuggestion(original.id) == before)
        #expect(try await store.rebuildSuggestion(pending.id)?.reviewStatus == "pending")
        #expect(try await store.taskExtractionQueue().isEmpty)
    }
    @Test func rawProtectedFieldsSurviveRebuildAndOwnershipCannotChangeReviewedStatus() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let protected = try await seed(store, id: "protected")
        try await store.seedRebuildEdit(protected.id)
        try await store.addUnknownProtectedFixtureField(protected.id)
        let raw = try #require(await store.rebuildRawSuggestion(protected.id))
        let source = try await seed(store), plan = try await store.planTaskRebuild()
        #expect(plan.protected.first(where: { $0.id == protected.id })?.json == raw)
        var inconsistent = source; inconsistent.candidate.status = .waiting
        await #expect(throws: Error.self) { try await store.promoteTaskRebuild(plan, batches: [.init(eventID: source.eventID, candidates: [inconsistent])]) }
        _ = try await store.promoteTaskRebuild(plan, batches: [.init(eventID: source.eventID, candidates: [source])])
        #expect(try await store.rebuildRawSuggestion(protected.id) == raw)
    }

    @Test func userMetadataCorrectionSurvivesEmptyReextractionAndHistoricalBackfill() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let source = try await seed(store)
        try await store.seedRebuildEdit(source.id)
        try await store.rebuildUserProtectionFixtureIndex()
        try await store.requestTaskExtraction(eventID: source.eventID)
        let (_, token) = try #require(await store.acquireTaskExtraction(at: Date()))
        try await store.commitTaskExtraction([], eventID: source.eventID, token: token)
        #expect(try await store.rebuildSuggestion(source.id)?.reviewStatus == "pending")
    }
    @Test(arguments: [false, true]) func stagingRepairAcceptsOnlyExactAutomaticRetirement(tampered: Bool) async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let protected = try await seed(store, id: "protected")
        try await store.seedRebuildEdit(protected.id)
        let before = try #require(await store.rebuildRawSuggestion(protected.id))
        let source = try await seed(store), plan = try await store.planTaskRebuild()
        _ = try await store.applyTaskRebuild(plan)
        let (_, token) = try #require(await store.acquireTaskExtraction(at: Date(), eventIDs: [source.eventID]))
        try await store.commitTaskExtraction([], eventID: source.eventID, token: token)
        try await store.seedLegacyProtectedRetirement(protected.id, tampered: tampered)
        if tampered {
            await #expect(throws: Error.self) { try await store.repairTaskRebuildRetirements(plan) }
            #expect(try await store.rebuildSuggestion(protected.id)?.candidate.title == "Changed after review")
        } else {
            #expect(try await store.repairTaskRebuildRetirements(plan) == 1)
            #expect(try await store.rebuildRawSuggestion(protected.id) == before)
            #expect(try await store.exportTaskRebuild(plan).count == 1)
        }
    }

}
extension KnowledgeStore {
    func rebuildUserProtectionFixtureIndex() throws {
        try db.execute("DROP TRIGGER task_user_history_subjects_insert")
        try db.execute("DROP TABLE task_user_history_subjects")
        try db.migrateTaskUserProtection()
    }
    func seedLegacyProtectedRetirement(_ id: String, tampered: Bool) throws {
        let original = try record("task_suggestions", id: id, as: TaskSuggestion.self)!
        var updated = original; updated.reviewStatus = "superseded"; updated.version += 1
        if tampered { updated.candidate.title = "Changed after review" }
        try db.execute("UPDATE task_suggestions SET json=? WHERE id=?", [try JSONCodec.string(updated), id])
        try history(subjects: [id], type: "suggestion.reprocessed", before: original, after: updated, command: "legacy-fixture", at: Date(), actor: "extraction")
    }
    func rebuildRawSuggestion(_ id: String) throws -> String? { try db.rows("SELECT json FROM task_suggestions WHERE id=?", [id]).first?["json"] }
    func addUnknownProtectedFixtureField(_ id: String) throws {
        let original = try rebuildRawSuggestion(id)!
        var json = try JSONSerialization.jsonObject(with: Data(original.utf8)) as! [String: Any]
        json["futureFixtureField"] = "Preserve exact bytes"
        let raw = String(decoding: try JSONSerialization.data(withJSONObject: json, options: [.sortedKeys]), as: UTF8.self)
        try db.execute("UPDATE task_suggestions SET json=? WHERE id=?", [raw, id])
    }
    func copyRebuildFixture(to path: String) throws { try db.execute("VACUUM INTO ?", [path]) }
    func seedRebuildRelation(_ primary: String, _ duplicate: String) throws {
        let relation = TaskRelation(duplicateID: "source:" + duplicate, primaryID: "source:" + primary, reason: "Synthetic duplicate", evidenceIDs: [])
        try db.execute("INSERT INTO task_relations VALUES (?,?)", [relation.duplicateID, try JSONCodec.string(relation)])
    }
    func seedRebuildEdit(_ id: String) throws {
        try history(subjects: [id], type: "task.updated", before: Optional<String>.none, after: "Synthetic user title edit", command: "fixture-edit", at: Date())
    }
    func rebuildSuggestion(_ id: String) throws -> TaskSuggestion? { try record("task_suggestions", id: id, as: TaskSuggestion.self) }
}
