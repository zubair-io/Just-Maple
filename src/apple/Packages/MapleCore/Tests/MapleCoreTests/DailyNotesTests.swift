import Foundation
import Testing
@testable import MapleCore

struct DailyNotesTests {
    let day = "2026-09-27"
    let zone = "America/New_York"
    let now = Date(timeIntervalSince1970: 1_790_500_000)

    func create(_ store: KnowledgeStore, id: String = "fixture-block", day: String = "2026-09-27", kind: DailyBlockKind = .text, content: String = "Fixture daily writing") async throws -> DailyBlock {
        let result = try await store.mutateDailyBlock(DailyBlockMutation(kind: .create, blockID: id, expectedVersion: 0, requestID: "create-" + id, day: day, timeZone: zone, content: content, blockKind: kind), at: now)
        return try #require(result.blocks.first { $0.id == id })
    }
    func mutation(_ block: DailyBlock, _ kind: DailyBlockMutationKind, request: String = UUID().uuidString, content: String? = nil, target: String? = nil) -> DailyBlockMutation {
        DailyBlockMutation(kind: kind, blockID: block.id, expectedVersion: block.version, requestID: request, day: block.day, timeZone: zone, content: content, targetDay: target)
    }
    func event(_ revision: String, content: String, offset: TimeInterval = 0) -> Event {
        Event(type: "mail.received", source: Source(connector: "gmail", account: "fixture", externalID: "daily-source", revision: revision), occurredAt: now.addingTimeInterval(offset), receivedAt: now.addingTimeInterval(offset), subjects: ["person:self"], content: content)
    }

    @Test func allKindsPersistAcrossRestartAndAdditiveMigrationLeavesLegacyData() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let path = directory.appendingPathComponent("core.sqlite").path
        let store = try KnowledgeStore(path: path)
        var task = LifeTask(); task.title = "Fixture legacy task"
        _ = try await store.saveTask(task, expectedVersion: 0, requestID: "legacy", at: now)
        let source = event("1", content: "Fixture preserved original source")
        _ = try await store.ingest(source)
        for kind in DailyBlockKind.allCases { _ = try await create(store, id: kind.rawValue, kind: kind) }
        let reopened = try KnowledgeStore(path: path)
        let note = try await reopened.dailyNote(day: day, timeZone: zone)
        #expect(Set(note.blocks.map(\.id)) == Set(DailyBlockKind.allCases.map(\.rawValue)))
        #expect(try await reopened.tasks().first?.id == task.id)
        #expect(try await reopened.event(source.id)?.content == source.content)
        #expect(try await reopened.worldHistory().contains { $0.type == "task.created" })
    }
    @Test func retriesAreIdempotentAndPayloadCollisionsAndStaleEditsDoNotChangeHistory() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let original = try await create(store)
        let edit = mutation(original, .edit, request: "edit", content: "Fixture changed")
        let saved = try await store.mutateDailyBlock(edit, at: now)
        let retry = try await store.mutateDailyBlock(edit, at: now.addingTimeInterval(10))
        #expect(retry == saved)
        #expect(try await store.dailyBlockHistory(id: original.id).count == 2)
        var collision = edit; collision.content = "Conflicting reused request"
        await #expect(throws: Error.self) { try await store.mutateDailyBlock(collision, at: now) }
        await #expect(throws: Error.self) { try await store.mutateDailyBlock(mutation(original, .edit, content: "Stale"), at: now) }
        #expect(try await store.dailyNote(day: day, timeZone: zone).blocks.first?.content == "Fixture changed")
        #expect(try await store.dailyBlockHistory(id: original.id).count == 2)
    }
    @Test func clearRestoresWithoutCompletingLinkedTaskAndExplicitCompletionIsAtomic() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        var task = LifeTask(); task.title = "Fixture accepted task"
        let saved = try await store.saveTask(task, expectedVersion: 0, requestID: "task", at: now)
        let block = try await store.upsertDailyTask(taskID: saved.id, day: day, timeZone: zone, requestID: "project", at: now)
        let clear = try await store.mutateDailyBlock(mutation(block, .clear), at: now)
        #expect(clear.blocks.isEmpty && clear.cleared.count == 1)
        #expect(try await store.tasks().first?.status == .open)
        let restored = try await store.mutateDailyBlock(mutation(try #require(clear.cleared.first), .restore), at: now)
        let restoredBlock = try #require(restored.blocks.first)
        let done = try await store.mutateDailyBlock(mutation(restoredBlock, .complete), at: now)
        #expect(done.blocks.isEmpty && done.cleared.first?.completedAt == now)
        #expect(try await store.tasks().first?.status == .completed)
        let again = try await store.mutateDailyBlock(mutation(try #require(done.cleared.first), .restore), at: now)
        #expect(again.blocks.first?.completedAt == now)
        #expect(try await store.tasks().first?.status == .completed)
        let history = try await store.dailyBlockHistory(id: block.id)
        #expect(history.contains { $0.type == "daily.block.clear" && $0.before != nil && $0.after != nil })
    }
    @Test func canonicalTaskConflictRollsBackCompletionAndProjectionIsStable() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        var task = LifeTask(); task.title = "Fixture task"
        var saved = try await store.saveTask(task, expectedVersion: 0, requestID: "task", at: now)
        let block = try await store.upsertDailyTask(taskID: saved.id, day: day, timeZone: zone, requestID: "project", at: now)
        let unchanged = try await store.upsertDailyTask(taskID: saved.id, day: day, timeZone: zone, requestID: "project-repeat", at: now)
        #expect(unchanged == block)
        saved.title = "Fixture changed outside daily note"
        _ = try await store.saveTask(saved, expectedVersion: saved.version, requestID: "task-edit", at: now)
        await #expect(throws: Error.self) { try await store.mutateDailyBlock(mutation(block, .complete), at: now) }
        #expect(try await store.dailyNote(day: day, timeZone: zone).blocks.first == block)
        #expect(try await store.tasks().first?.status == .open)
        let updated = try await store.upsertDailyTask(taskID: saved.id, day: day, timeZone: zone, requestID: "project-new", at: now)
        #expect(updated.id == block.id && updated.version == 2 && updated.taskVersion == 2)
    }
    @Test func movesKeepIdentityAndFutureReadsNeverCarryAnything() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let block = try await create(store, kind: .task)
        #expect(try await store.dailyNote(day: "2026-09-28", timeZone: zone).blocks.isEmpty)
        #expect(try await store.dailyNote(day: day, timeZone: zone).blocks.first?.id == block.id)
        let move = mutation(block, .move, request: "move", target: "2026-09-28")
        let today = try await store.mutateDailyBlock(move, at: now)
        #expect(today.blocks.isEmpty)
        _ = try await store.mutateDailyBlock(move, at: now)
        let tomorrow = try await store.dailyNote(day: "2026-09-28", timeZone: zone)
        #expect(tomorrow.blocks.count == 1 && tomorrow.blocks.first?.id == block.id)
        let history = try await store.dailyBlockHistory(id: block.id)
        #expect(history.first?.before?.contains(day) == true && history.first?.after?.contains("2026-09-28") == true)
    }
    @Test func sourceUpdatesPreserveEditsMovesAndClearTombstonesAndNeverRegress() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let first = event("1", content: "Subject: Fixture\nSender: Alex\nBody:\nOriginal")
        _ = try await store.ingest(first)
        let block = try await store.upsertDailySource(eventID: first.id, day: day, timeZone: zone, kind: .email, requestID: "project1", at: now)
        let edited = try await store.mutateDailyBlock(mutation(block, .edit, content: "My own interpretation"), at: now)
        let cleared = try await store.mutateDailyBlock(mutation(try #require(edited.blocks.first), .clear), at: now)
        let second = event("2", content: "Subject: Fixture\nSender: Alex\nBody:\nChanged", offset: 10)
        _ = try await store.ingest(second)
        let update = try await store.upsertDailySource(eventID: second.id, day: "2026-09-28", timeZone: zone, kind: .email, requestID: "project2", at: now)
        #expect(update.content == "My own interpretation" && update.userEdited)
        #expect(update.clearedAt == cleared.cleared.first?.clearedAt && update.day == day)
        #expect(update.source?.eventID == second.id && update.id == block.id)
        let late = try await store.upsertDailySource(eventID: first.id, day: day, timeZone: zone, kind: .email, requestID: "project-old", at: now)
        #expect(late == update)
        #expect(try await store.dailyNote(day: day, timeZone: zone).blocks.isEmpty)
        await #expect(throws: Error.self) { try await store.mutateDailyBlock(mutation(update, .edit, content: "Bot replacement"), actor: .bot, at: now) }
    }
    @Test func automaticSourcesRequireLatestAttentionDecision() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let first = event("1", content: "Fixture old attention source")
        _ = try await store.ingest(first)
        #expect(try await store.upsertDailyAttentionSource(eventID: first.id, day: day, timeZone: zone, kind: .email, requestID: "auto", at: now) == nil)
        try await store.dailyFixtureDecision(eventID: first.id, route: .notify)
        let second = event("2", content: "Fixture revised pending source", offset: 10)
        _ = try await store.ingest(second)
        #expect(try await store.upsertDailyAttentionSource(eventID: first.id, day: day, timeZone: zone, kind: .email, requestID: "auto", at: now) == nil)
        try await store.dailyFixtureDecision(eventID: second.id, route: .retain)
        #expect(try await store.upsertDailyAttentionSource(eventID: first.id, day: day, timeZone: zone, kind: .email, requestID: "auto", at: now) == nil)
        #expect(try await store.dailyNote(day: day, timeZone: zone).blocks.isEmpty)
        let third = event("3", content: "Fixture revised actionable source", offset: 20)
        _ = try await store.ingest(third)
        try await store.dailyFixtureDecision(eventID: third.id, route: .askUser)
        let projected = try await store.upsertDailyAttentionSource(eventID: first.id, day: day, timeZone: zone, kind: .email, requestID: "auto", at: now)
        #expect(projected?.source?.eventID == third.id && projected?.content == third.content)
        try await store.dismiss("daily-fixture:" + third.id)
        #expect(try await store.upsertDailyAttentionSource(eventID: first.id, day: day, timeZone: zone, kind: .email, requestID: "after-dismissal", at: now) == nil)
    }
    @Test func externalTaskCompletionReconcilesExistingBlockWithoutImportingOtherCompletedTasks() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        var task = LifeTask(); task.title = "Fixture task"
        let saved = try await store.saveTask(task, expectedVersion: 0, requestID: "external-task", at: now)
        let block = try await store.upsertDailyTask(taskID: saved.id, day: day, timeZone: zone, requestID: "external-project", at: now)
        _ = try await store.applyTaskAction(nodeID: "task:" + saved.id, change: TaskActionChange(kind: "done", issuedAt: now), expectedVersion: saved.version, requestID: "external-complete", scope: "desktop", at: now)
        try await store.reconcileDailyTaskBlocks(day: day, timeZone: zone, at: now)
        let note = try await store.dailyNote(day: day, timeZone: zone)
        #expect(note.blocks.isEmpty && note.cleared.first?.id == block.id && note.cleared.first?.completedAt == now)
        try await store.reconcileDailyTaskBlocks(day: day, timeZone: zone, at: now)
        #expect(try await store.dailyNote(day: day, timeZone: zone) == note)
        var other = LifeTask(); other.title = "Fixture other terminal task"; other.status = .completed
        let terminal = try await store.saveTask(other, expectedVersion: 0, requestID: "terminal", at: now)
        await #expect(throws: Error.self) { try await store.upsertDailyTask(taskID: terminal.id, day: day, timeZone: zone, requestID: "terminal-projection", at: now) }
        #expect(try await store.dailyNote(day: day, timeZone: zone).cleared.count == 1)
    }
    @Test func concurrentEditsCommitOnlyOneVersion() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let block = try await create(store)
        let edits = [mutation(block, .edit, content: "Fixture editor A"), mutation(block, .edit, content: "Fixture editor B")]
        let successes = await withTaskGroup(of: Bool.self, returning: Int.self) { group in
            for edit in edits { group.addTask { (try? await store.mutateDailyBlock(edit)) != nil } }
            var count = 0
            for await succeeded in group { if succeeded { count += 1 } }
            return count
        }
        #expect(successes == 1)
        #expect(try await store.dailyNote(day: day, timeZone: zone).blocks.first?.version == 2)
        #expect(try await store.dailyBlockHistory(id: block.id).count == 2)
    }
    @Test func botCannotOverwriteUserTextAndUneditedProjectionCanRefresh() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let authored = try await create(store)
        await #expect(throws: Error.self) { try await store.mutateDailyBlock(mutation(authored, .edit, content: "Bot replacement"), actor: .bot, at: now) }
        let first = event("1", content: "Original source")
        _ = try await store.ingest(first)
        let source = try await store.upsertDailySource(eventID: first.id, day: day, timeZone: zone, kind: .email, requestID: "source1", at: now)
        let second = event("2", content: "Updated source", offset: 10)
        _ = try await store.ingest(second)
        let changed = try await store.upsertDailySource(eventID: second.id, day: day, timeZone: zone, kind: .email, requestID: "source2", at: now)
        #expect(changed.id == source.id && changed.content == second.content && changed.version == 2)
    }
    @Test func rolloverAcrossDSTCarriesOnlyUnfinishedTaskIDsOnce() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let oldDay = "2026-03-07", next = "2026-03-09"
        let task = try await create(store, id: "task", day: oldDay, kind: .task)
        _ = try await create(store, id: "writing", day: oldDay)
        let clear = try await create(store, id: "clear", day: oldDay, kind: .task)
        _ = try await store.mutateDailyBlock(mutation(clear, .clear), at: now)
        let done = try await create(store, id: "done", day: oldDay, kind: .task)
        _ = try await store.mutateDailyBlock(mutation(done, .complete), at: now)
        let result = try await store.carryForwardDailyBlocks(to: next, timeZone: zone, requestID: "rollover", at: now)
        #expect(result.blocks.map(\.id) == [task.id])
        #expect(try await store.carryForwardDailyBlocks(to: next, timeZone: zone, requestID: "rollover", at: now) == result)
        #expect(try await store.dailyNote(day: oldDay, timeZone: zone).blocks.map(\.id) == ["writing"])
        var due = DueSpec(); due.date = "2026-03-08"; due.timeZone = zone
        #expect(try due.boundary(endOfDay: true).timeIntervalSince(due.boundary()) == 23 * 3600)
    }
    @Test func automaticRolloverRechecksBackdatedTasksWithoutWritingEmptyCommands() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let instant = try #require(ISO8601DateFormatter().date(from: "2026-03-09T04:30:00Z"))
        let today = "2026-03-09"
        let first = try await store.refreshDailyCarryForward(to: today, timeZone: zone, at: instant)
        #expect(first.blocks.isEmpty)
        #expect(try await store.dailyFixtureCommandCount() == 0)
        _ = try await store.refreshDailyCarryForward(to: today, timeZone: zone, at: instant)
        #expect(try await store.dailyFixtureCommandCount() == 0)
        let task = try await create(store, id: "backdated-first", day: "2026-03-08", kind: .task)
        let carried = try await store.refreshDailyCarryForward(to: today, timeZone: zone, at: instant)
        #expect(carried.blocks.map(\.id) == [task.id])
        let count = try await store.dailyFixtureCommandCount()
        #expect(try await store.refreshDailyCarryForward(to: today, timeZone: zone, at: instant) == carried)
        #expect(try await store.dailyFixtureCommandCount() == count)
        let later = try await create(store, id: "backdated-later", day: "2026-03-07", kind: .task)
        let refreshed = try await store.refreshDailyCarryForward(to: today, timeZone: zone, at: instant)
        #expect(Set(refreshed.blocks.map(\.id)) == [task.id, later.id])
        #expect(try await store.dailyFixtureCommandCount() == count + 2)
        // This instant is still March 8 in Los Angeles: the named zone controls Today.
        await #expect(throws: Error.self) { try await store.refreshDailyCarryForward(to: today, timeZone: "America/Los_Angeles", at: instant) }
        await #expect(throws: Error.self) { try await store.refreshDailyCarryForward(to: "2026-03-10", timeZone: zone, at: instant) }
    }
    @Test func explicitEmptyRolloverRetriesDoNotAcquireLaterWork() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let original = try await store.carryForwardDailyBlocks(to: day, timeZone: zone, requestID: "explicit-empty", at: now)
        _ = try await create(store, id: "created-after-explicit", day: "2026-09-26", kind: .task)
        let replay = try await store.carryForwardDailyBlocks(to: day, timeZone: zone, requestID: "explicit-empty", at: now)
        #expect(replay == original && replay.blocks.isEmpty)
        #expect(try await store.dailyNote(day: "2026-09-26", timeZone: zone).blocks.count == 1)
    }
    @Test func invalidDatesPayloadsAndBotActorPayloadAreRejected() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        for invalid in ["2026-02-30", "2026-13-01", "2026-9-27", "2026/09/27", "0000-01-01"] {
            await #expect(throws: Error.self) { try await store.dailyNote(day: invalid, timeZone: zone) }
        }
        await #expect(throws: Error.self) { try await store.dailyNote(day: day, timeZone: "not-a-timezone") }
        var input = DailyBlockMutation(kind: .create, blockID: "fixture", expectedVersion: 0, requestID: "large", day: day, timeZone: zone, content: String(repeating: "a", count: 65_537), blockKind: .text)
        await #expect(throws: Error.self) { try await store.mutateDailyBlock(input) }
        input.content = "Allowed"; input.expectedVersion = -1
        await #expect(throws: Error.self) { try await store.mutateDailyBlock(input) }
        #expect(try await store.dailyNote(day: day, timeZone: zone).blocks.isEmpty)
    }
}

// Test-only labeled routing fixture. This tests projection storage policy independently
// from live model quality; production never substitutes this for a classifier response.
extension KnowledgeStore {
    fileprivate func dailyFixtureCommandCount() throws -> Int {
        Int(try db.rows("SELECT count(*) AS n FROM world_commands WHERE id LIKE 'daily:%'").first?["n"] ?? "0") ?? 0
    }
    fileprivate func dailyFixtureDecision(eventID: String, route: Route) throws {
        let context = try context(for: eventID)
        let assessment = Assessment(notify: 0, askUser: 0, reason: 0, summarize: 0, jobStage: .unchanged, stageConfidence: 0, model: "daily-test-fixture", provider: "test-fixture")
        let decision = Decision(eventID: eventID, route: route, assessment: assessment, context: context, explanation: ["Explicit synthetic test fixture"], policyVersion: "test-fixture", createdAt: Date())
        try db.execute("INSERT OR REPLACE INTO decisions VALUES (?,?,?)", [eventID, try JSONCodec.string(decision), "test-fixture"])
        if [.notify, .askUser].contains(route) { try db.execute("INSERT OR REPLACE INTO work_items VALUES (?,?,?,?)", ["daily-fixture:" + eventID, eventID, route.rawValue, "unread"]) }
    }
}
