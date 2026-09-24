import Foundation
import Testing
@testable import MapleCore

struct WorldTests {
    let now=Date(timeIntervalSince1970:1_790_000_000)
    func activity(_ name:String)->LifeActivity {var a=LifeActivity();a.name=name;return a}
    func task(_ title:String, tags:[String]=[])->LifeTask {var t=LifeTask();t.title=title;t.activityIDs=tags;return t}
    @Test func sharedTaskHasOneStatusHistoryAndRecoverableActivityArchive() async throws {
        let store=try KnowledgeStore(path:":memory:")
        let family=try await store.saveActivity(activity("Family"),expectedVersion:0,requestID:"family",at:now)
        let health=try await store.saveActivity(activity("Health"),expectedVersion:0,requestID:"health",at:now)
        var t=try await store.saveTask(task("Schedule pediatrician",tags:[family.id,health.id,family.id]),expectedVersion:0,requestID:"capture",at:now)
        #expect(t.activityIDs.count==2);#expect(try await store.tasks().count==1)
        t.status = .completed
        let done=try await store.saveTask(t,expectedVersion:1,requestID:"complete",at:now)
        #expect(try await store.saveTask(t,expectedVersion:1,requestID:"complete",at:now)==done)
        #expect(try await store.worldHistory().filter{$0.type=="task.completed"}.count==1)
        var archived=family;archived.lifecycle = .archived
        _ = try await store.saveActivity(archived,expectedVersion:1,requestID:"archive",at:now)
        #expect(try await store.tasks().first?.activityIDs.count==2)
        var reopened=done;reopened.status = .open;reopened.activityIDs=[health.id]
        _ = try await store.saveTask(reopened,expectedVersion:2,requestID:"reopen",at:now)
        #expect(try await store.tasks().count==1);#expect(try await store.tasks().first?.completedAt==nil)
        #expect(try await store.activities().first{$0.id==family.id}?.lifecycle == .archived)
    }
    @Test func staleEditsAndInvalidAssociationsRollBackWithoutHistory() async throws {
        let store=try KnowledgeStore(path:":memory:")
        let input=task("Untagged capture")
        let saved=try await store.saveTask(input,expectedVersion:0,requestID:"new",at:now)
        let before=try await store.worldSnapshot(at:now)
        var stale=saved;stale.title="Lost edit"
        do {_ = try await store.saveTask(stale,expectedVersion:0,requestID:"stale",at:now);Issue.record("Accepted stale edit")}catch{}
        stale.activityIDs=["missing"]
        do {_ = try await store.saveTask(stale,expectedVersion:1,requestID:"bad-tag",at:now);Issue.record("Accepted missing activity")}catch{}
        #expect(try await store.tasks().first==saved)
        #expect(try await store.worldSnapshot(at:now).revision==before.revision)
        var changed=input;changed.title="Different payload"
        do {_ = try await store.saveTask(changed,expectedVersion:0,requestID:"new",at:now);Issue.record("Reused request accepted")}catch{}
    }
    @Test func stateCorrectionExpiresAndConflictingObservationsRemainExplainable() async throws {
        let store=try KnowledgeStore(path:":memory:")
        let event=Event(type:"test.observed",source:Source(connector:"device",account:"local",externalID:"a",revision:"1"),occurredAt:now,receivedAt:now,subjects:["person:self"],content:"Home and Airport readings")
        _ = try await store.ingest(event)
        var c=WorldStateClaim();c.property="presence";c.value="Home";c.origin="observed";c.observedAt=now;c.validFrom=now;c.validUntil=now.addingTimeInterval(900);c.evidenceIDs=[event.id]
        _ = try await store.observeWorldState(c,requestID:"home",at:now)
        c.id=UUID().uuidString;c.value="Airport"
        _ = try await store.observeWorldState(c,requestID:"airport",at:now)
        #expect(try await store.worldStates(at:now).first{$0.property=="presence"}?.status=="conflicting")
        c.id=UUID().uuidString;c.value="Resting at home";c.validUntil=now.addingTimeInterval(3600)
        _ = try await store.correctWorldState(c,expectedRevision:3,requestID:"correction",at:now)
        #expect(try await store.worldStates(at:now.addingTimeInterval(1000)).first{$0.property=="presence"}?.value=="Resting at home")
        #expect(try await store.worldStates(at:now.addingTimeInterval(3601)).first{$0.property=="presence"}?.status=="stale")
        #expect(try await store.stateClaims().count==3)
    }
    @Test func mismatchAndSnoozeNeverChangeDueOrCompleteTask() async throws {
        let store=try KnowledgeStore(path:":memory:")
        var c=WorldStateClaim();c.property="presence";c.value="Airport";c.validFrom=now;c.validUntil=now.addingTimeInterval(900)
        _ = try await store.correctWorldState(c,expectedRevision:0,requestID:"airport",at:now)
        var t=task("School drop-off");var due=DueSpec();due.kind = .instant;due.instant=now.addingTimeInterval(600);t.due=due
        var condition=RelevanceCondition();condition.value="Home";t.conditions=[condition]
        let saved=try await store.saveTask(t,expectedVersion:0,requestID:"school",at:now)
        let item=try #require(try await store.attention(at:now).first)
        #expect(item.category=="context_mismatch")
        _ = try await store.acknowledgeAttention(id:item.id,until:now.addingTimeInterval(300),requestID:"snooze",at:now)
        #expect(try await store.attention(at:now).isEmpty)
        #expect(try await store.tasks().first==saved)
        #expect(try await store.attention(at:now.addingTimeInterval(1000)).first?.category=="uncertain")
    }
    @Test func suggestionsRequireReviewDeduplicateAndDoNotOverwriteEdits() async throws {
        let store=try KnowledgeStore(path:":memory:")
        let e=Event(type:"email.received",source:Source(connector:"gmail",account:"local",externalID:"message",revision:"1"),occurredAt:now,subjects:["person:self"],content:"Please return the form by Friday")
        _ = try await store.ingest(e)
        var s=TaskSuggestion();s.candidate=task("Return form");s.eventID=e.id;s.quote=e.content;s.provider="fixture-labeled"
        let proposed=try await store.offerTask(s,at:now)
        #expect(try await store.offerTask(s,at:now).id==proposed.id);#expect(try await store.tasks().isEmpty)
        let rejected=try await store.reviewSuggestion(id:proposed.id,action:"reject",edited:nil,expectedVersion:1,requestID:"reject",at:now)
        _ = try await store.reviewSuggestion(id:proposed.id,action:"undoReject",edited:nil,expectedVersion:rejected.version,requestID:"undo",at:now)
        let accepted=try await store.reviewSuggestion(id:proposed.id,action:"accept",edited:nil,expectedVersion:3,requestID:"accept",at:now)
        #expect(try await store.reviewSuggestion(id:proposed.id,action:"accept",edited:nil,expectedVersion:3,requestID:"double",at:now).acceptedTaskID==accepted.acceptedTaskID)
        #expect(try await store.tasks().count==1)
        let revised=Event(type:e.type,source:Source(connector:"gmail",account:"local",externalID:"message",revision:"2"),occurredAt:now,subjects:e.subjects,content:"Please return the form by Monday")
        _ = try await store.ingest(revised);s.id=UUID().uuidString;s.eventID=revised.id;s.quote=revised.content
        let update=try await store.offerTask(s,at:now)
        #expect(update.linkedTaskID==accepted.acceptedTaskID)
        do {_ = try await store.reviewSuggestion(id:update.id,action:"accept",edited:nil,expectedVersion:1,requestID:"unsafe",at:now);Issue.record("Overwrote task without version")}catch{}
        #expect(try await store.tasks().count==1)
    }
    @Test func recurringOccurrencesKeepLocalTimeAndCompleteIndependently() async throws {
        let store=try KnowledgeStore(path:":memory:")
        let before=ISO8601DateFormatter().date(from:"2026-03-01T12:00:00Z")!
        var series=TaskSeries();series.template=task("School run");series.timeZone="America/New_York";series.startDate="2026-03-01";series.localTime="07:45"
        let dates=try OccurrenceCalendar.dates(series,through:before.addingTimeInterval(15*86400))
        var cal=Calendar(identifier:.gregorian);cal.timeZone=TimeZone(identifier:series.timeZone)!
        #expect(dates.allSatisfy{cal.component(.hour,from:$0.1)==7 && cal.component(.minute,from:$0.1)==45})
        #expect(dates[1].1.timeIntervalSince(dates[0].1)==7*86400-3600)
        _ = try await store.saveSeries(series,expectedVersion:0,requestID:"series",at:before)
        let count=try await store.tasks().count
        try await store.materializeOccurrences(at:before)
        #expect(try await store.tasks().count==count)
        var first=try #require(try await store.tasks().first);first.status = .completed
        _ = try await store.saveTask(first,expectedVersion:1,requestID:"one",at:before)
        #expect(try await store.tasks().filter{$0.status == .completed}.count==1)
        #expect(try await store.tasks().filter{!$0.status.terminal}.count==count-1)
    }
    @Test func firstDayIsUnknownAndHealthHasNoInferredProperties() async throws {
        let store=try KnowledgeStore(path:":memory:");let world=try await store.worldSnapshot(at:now)
        #expect(world.tasks.isEmpty && world.activities.isEmpty && world.attention.isEmpty)
        #expect(world.states.allSatisfy{$0.status=="unknown"})
        #expect(!world.properties.contains{$0.lens=="Health"})
    }
}

struct WorldPersistenceTests {
    @Test func failedHistoryInsertRollsBackTaskAndIdempotencyRecord() async throws {
        let path=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
        defer {try? FileManager.default.removeItem(atPath:path)}
        let store=try KnowledgeStore(path:path),sql=try SQLite(path:path)
        try sql.execute("CREATE TRIGGER reject_history BEFORE INSERT ON world_history BEGIN SELECT RAISE(ABORT,'fixture write failure'); END")
        var t=LifeTask();t.title="Draft must survive"
        do {_ = try await store.saveTask(t,expectedVersion:0,requestID:"retry");Issue.record("Write unexpectedly succeeded")}catch{}
        #expect(try await store.tasks().isEmpty)
        #expect(try sql.rows("SELECT id FROM world_commands").isEmpty)
        try sql.execute("DROP TRIGGER reject_history")
        _ = try await store.saveTask(t,expectedVersion:0,requestID:"retry")
        #expect(try await store.tasks().count==1)
    }
    @Test func twoConnectionsCannotOverwriteSameTaskVersion() async throws {
        let path=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
        defer {try? FileManager.default.removeItem(atPath:path)}
        let first=try KnowledgeStore(path:path),second=try KnowledgeStore(path:path)
        var task=LifeTask();task.title="Shared"
        let saved=try await first.saveTask(task,expectedVersion:0,requestID:"new")
        let left:LifeTask={var t=saved;t.title="Left";return t}()
        let right:LifeTask={var t=saved;t.title="Right";return t}()
        async let a:LifeTask? = try? first.saveTask(left,expectedVersion:1,requestID:"left")
        async let b:LifeTask? = try? second.saveTask(right,expectedVersion:1,requestID:"right")
        let values=await [a,b]
        #expect(values.compactMap{$0}.count==1)
        #expect(try await first.tasks().first?.version==2)
    }
    @Test func dateOnlyDoesNotInventATimeAndRejectsInvalidDay() throws {
        var due=DueSpec();due.date="2026-02-30";due.timeZone="America/New_York"
        #expect(throws:MapleError.self){try due.boundary()}
        due.date="2026-03-08"
        #expect(try due.boundary(endOfDay:true).timeIntervalSince(due.boundary())==23*3600)
    }
    @Test func lateObservationDoesNotReverseNewerEffectiveState() {
        let property=StateProperty.catalog.first{$0.key=="presence"}!,now=Date()
        var recent=WorldStateClaim();recent.property="presence";recent.origin="observed";recent.value="Home";recent.sourceKey="phone";recent.observedAt=now;recent.validFrom=now.addingTimeInterval(-100);recent.validUntil=now.addingTimeInterval(100)
        var late=recent;late.id="late";late.value="Away";late.observedAt=now.addingTimeInterval(-50);late.ingestedAt=now.addingTimeInterval(1)
        #expect(StateResolver.resolve(subject:"person:self",property:property,claims:[recent,late],revision:1,at:now).value=="Home")
    }
}

struct WorldExtractionTests {
    @Test func invalidCandidateRollsBackWholeBatchAndExpiredLeaseCannotWrite() async throws {
        let store=try KnowledgeStore(path:":memory:")
        let event=Event(type:"mail",source:Source(connector:"gmail",account:"test",externalID:"mail-1",revision:"1"),occurredAt:Date(),subjects:["person:self"],content:"Please call Alex.")
        _ = try await store.ingest(event)
        try await store.requestTaskExtraction(eventID:event.id)
        let lease=try #require(await store.acquireTaskExtraction(at:Date()))
        var valid=TaskSuggestion();valid.eventID=event.id;valid.quote="Please call Alex.";valid.provider="fixture";valid.candidate.title="Call Alex"
        var invalid=valid;invalid.id="invalid";invalid.quote="Invented quote"
        do {try await store.commitTaskExtraction([valid,invalid],eventID:event.id,token:lease.1);Issue.record("Invalid batch accepted")} catch {}
        #expect(try await store.worldSnapshot().suggestions.isEmpty)
        do {try await store.commitTaskExtraction([valid],eventID:event.id,token:lease.1,at:Date().addingTimeInterval(601));Issue.record("Expired lease accepted")} catch {}
        #expect(try await store.worldSnapshot().suggestions.isEmpty)
        try await store.commitTaskExtraction([valid],eventID:event.id,token:lease.1)
        #expect(try await store.worldSnapshot().suggestions.count==1)
        #expect(try await store.tasks().isEmpty)
    }
    @Test func reasoningReceivesAcceptedTasksAndResolvedWorldState() async throws {
        let store=try KnowledgeStore(path:":memory:")
        var task=LifeTask();task.title="Call Alex"
        _ = try await store.saveTask(task,expectedVersion:0,requestID:"task")
        let event=Event(type:"note",source:Source(connector:"notes",account:"test",externalID:"note-1",revision:"1"),occurredAt:Date(),subjects:["person:self"],content:"Alex has an update")
        _ = try await store.ingest(event)
        let context=try await store.context(for:event.id)
        #expect(context.world?.tasks.first?.title=="Call Alex")
        #expect(context.world?.states.first{$0.property=="presence"}?.status=="unknown")
    }
}

struct ScopedStateTests {
    @Test func FutureCorrectionDoesNotEraseCurrentState() {
        let now=Date(),property=StateProperty.catalog.first{$0.key=="presence"}!
        var current=WorldStateClaim();current.property="presence";current.value="Home";current.validFrom=now.addingTimeInterval(-60);current.validUntil=now.addingTimeInterval(3600)
        var future=current;future.id="future";future.value="Away";future.supersedes=current.id;future.validFrom=now.addingTimeInterval(60)
        #expect(StateResolver.resolve(subject:"person:self",property:property,claims:[current,future],revision:1,at:now).value=="Home")
        #expect(StateResolver.resolve(subject:"person:self",property:property,claims:[current,future],revision:1,at:now.addingTimeInterval(120)).value=="Away")
    }
}
