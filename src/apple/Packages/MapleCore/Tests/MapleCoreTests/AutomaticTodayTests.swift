import Foundation
import Testing
import MapleNotebooks
@testable import MapleCore

struct AutomaticTodayTests {
    let now=ISO8601DateFormatter().date(from:"2026-10-30T16:00:00Z")!
    func event(_ key:String,revision:String="1",at:Date?=nil,connector:String="mail") -> Event {
        let date=at ?? now.addingTimeInterval(-30)
        return Event(type:"message.received",source:Source(connector:connector,account:"test-fixture",externalID:key,revision:revision),occurredAt:date,receivedAt:date,subjects:["person:self"],content:"Subject: Fixture "+key+"\nExplicit synthetic fixture; not a live model result.")
    }
    @Test func onlySuccessfulSelectedRecentEvidenceAppearsAndTaskLinksAreCanonical() async throws {
        let (root,_,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let initial=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"America/New_York")
        let selected=event("selected"),quiet=event("quiet"),failed=event("failed"),old=event("history",at:now.addingTimeInterval(-3*86400)),sensor=event("sensor",connector:"homeassistant"),selfNote=event("own",connector:"notes")
        for source in [selected,quiet,failed,old,sensor,selfNote] {_ = try await store.ingest(source)}
        for (source,route,success) in [(selected,Route.notify,true),(quiet,.retain,true),(failed,.notify,false),(old,.notify,true),(selfNote,.notify,true)] {try await store.automaticFixtureDecision(source.id,route:route,success:success,at:now)}
        var task=LifeTask();task.title="Follow up on selected email";task.evidenceIDs=[selected.id]
        task=try await store.saveTask(task,expectedVersion:0,requestID:"fixture-task",at:now)
        let projected=try await coordinator.refreshAutomatic(documentID:initial.documentID,at:now)
        #expect(projected.blocks.filter{$0.eventID != nil}.isEmpty)
        #expect(projected.blocks.filter{$0.taskID != nil}.map(\.taskID)==["task:"+task.id])
        #expect(projected.content.contains("## Action items"))
        #expect(!projected.content.contains("\"kind\":\"task\""))
        let again=try await coordinator.refreshAutomatic(documentID:initial.documentID,at:now)
        #expect(again.revision==projected.revision)
    }
    @Test func latestPendingRevisionAndDeactivatedSourcesSuppressOldAttention() async throws {
        let (root,_,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let initial=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"UTC")
        let older=event("revised",at:now.addingTimeInterval(-60)),latest=event("revised",revision:"2",at:now.addingTimeInterval(-10)),inactive=event("inactive")
        for source in [older,latest,inactive] {_ = try await store.ingest(source)}
        try await store.automaticFixtureDecision(older.id,route:.notify,at:now)
        try await store.automaticFixtureDecision(inactive.id,route:.askUser,at:now)
        try await store.automaticFixtureDeactivate(inactive)
        #expect(try await coordinator.refreshAutomatic(documentID:initial.documentID,at:now).revision==initial.revision)
        try await store.automaticFixtureDecision(latest.id,route:.retain,at:now)
        #expect(try await coordinator.refreshAutomatic(documentID:initial.documentID,at:now).revision==initial.revision)
    }
    @Test func editsClearRemovalAndMoveStaySuppressedAcrossEntityRevisions() async throws {
        let (root,_,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        var current=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"UTC")
        for key in ["edit","clear","remove","move"] {let source=event(key);_ = try await store.ingest(source);try await store.automaticFixtureDecision(source.id,route:.notify,at:now)}
        current=try await coordinator.refreshAutomatic(documentID:current.documentID,at:now)
        let sources=current.blocks.filter{$0.eventID != nil}
        let edited=try #require(sources.first(where:{$0.content.contains("Fixture edit")}))
        current=try await coordinator.commit(documentID:current.documentID,expectedRevision:current.revision,content:current.content.replacingOccurrences(of:"Fixture edit",with:"My revised label"),commandID:"edit-auto")
        let clear=try #require(current.blocks.first(where:{$0.content.contains("Fixture clear")}))
        current=try await coordinator.mutateBlock(.init(commandID:"clear-auto",documentID:current.documentID,expectedRevision:current.revision,blockID:clear.blockID,expectedBlockVersion:clear.version,kind:"clear"))
        let removed=try #require(current.blocks.first(where:{$0.content.contains("Fixture remove")}))
        current=try await coordinator.commit(documentID:current.documentID,expectedRevision:current.revision,content:current.content.replacingOccurrences(of:removed.content,with:""),commandID:"remove-auto")
        let move=try #require(current.blocks.first(where:{$0.content.contains("Fixture move")}))
        _ = try await coordinator.open(notebookID:id,day:"2026-10-31",timeZone:"UTC")
        current=try await coordinator.mutateBlock(.init(commandID:"move-auto",documentID:current.documentID,expectedRevision:current.revision,blockID:move.blockID,expectedBlockVersion:move.version,kind:"move",targetDay:"2026-10-31"))
        for key in ["edit","clear","remove","move"] {let source=event(key,revision:"2",at:now);_ = try await store.ingest(source);try await store.automaticFixtureDecision(source.id,route:.notify,at:now)}
        let result=try await coordinator.refreshAutomatic(documentID:current.documentID,at:now)
        #expect(result.revision==current.revision);#expect(result.content.contains("My revised label"))
        #expect(result.blocks.contains{$0.blockID==edited.blockID})
        #expect(try await store.documentBlock(id:move.blockID)?.documentID != current.documentID)
    }
    @Test func draftsWaitAndRetryAfterUserSaveWithoutLosingText() async throws {
        let (root,library,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let initial=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"UTC")
        let source=event("draft");_ = try await store.ingest(source);try await store.automaticFixtureDecision(source.id,route:.notify,at:now)
        let draft=initial.content+"My unsaved thought\n"
        try await coordinator.draft(documentID:initial.documentID,revision:initial.revision,content:draft)
        let waiting=try await coordinator.refreshAutomatic(documentID:initial.documentID,at:now)
        #expect(waiting.revision==initial.revision);#expect(waiting.warning?.contains("waiting")==true)
        #expect(try await library.readDraft(notebookID:id,path:initial.path)?.content==draft)
        #expect(try await store.automaticFixtureCount(initial.documentID)==0)
        _ = try await coordinator.commit(documentID:initial.documentID,expectedRevision:initial.revision,content:draft,commandID:"save-draft")
        let after=try await coordinator.refreshAutomatic(documentID:initial.documentID,at:now)
        #expect(after.content.contains("My unsaved thought"));#expect(after.blocks.contains{$0.eventID==source.id})
    }
    @Test func boundedDailyCapacityAndRecoveryKeepLedgerAtomic() async throws {
        let (root,library,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        var current=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"UTC")
        for number in 0..<70 {let source=event("batch-\(number)");_ = try await store.ingest(source);try await store.automaticFixtureDecision(source.id,route:.notify,at:now)}
        current=try await coordinator.refreshAutomatic(documentID:current.documentID,at:now)
        #expect(try await store.automaticFixtureCount(current.documentID)==32)
        let candidates=try await store.automaticTodayCandidates(documentID:current.documentID,content:current.content,at:now)
        let content=current.content+"\n"+candidates.map(\.markdown).joined(separator:"\n")
        let mutation=DocumentMutationRecord(commandID:"fixture-auto-crash",documentID:current.documentID,expectedRevision:current.revision,targetRevision:ManagedMarkdown.hash(content),before:current.content,after:content,state:"prepared",createdAt:now)
        _ = try await store.prepareDocumentMutation(mutation)
        #expect(try await store.automaticFixtureCount(current.documentID)==32)
        _ = try await library.save(notebookID:id,path:current.path,content:content,expectedRevision:current.revision)
        let recovered=try await TodayDocumentCoordinator(store:store,library:library).refreshAutomatic(documentID:current.documentID,at:now)
        #expect(try await store.automaticFixtureCount(current.documentID)==64)
        #expect(recovered.blocks.filter{$0.eventID != nil}.count==64)
        #expect(try await coordinator.refreshAutomatic(documentID:current.documentID,at:now).revision==recovered.revision)
    }
    @Test func futureTaskBacklogCannotHideDueWorkAndScheduleCacheTracksEdits() async throws {
        let (root,_,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let initial=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"UTC")
        var future=DueSpec();future.date="2030-01-01";future.timeZone="UTC"
        for number in 0..<260 {var task=LifeTask();task.title="Future fixture \(number)";task.scheduled=future;task.priority=3;_ = try await store.saveTask(task,expectedVersion:0,requestID:"future-\(number)",at:now)}
        var due=DueSpec();due.date="2026-10-30";due.timeZone="UTC"
        var task=LifeTask();task.title="Cache changes";task.due=due
        task=try await store.saveTask(task,expectedVersion:0,requestID:"cache-create",at:now)
        task.scheduled=future;task=try await store.saveTask(task,expectedVersion:task.version,requestID:"cache-future",at:now)
        #expect(try await coordinator.refreshAutomatic(documentID:initial.documentID,at:now).revision==initial.revision)
        task.scheduled=nil;task=try await store.saveTask(task,expectedVersion:task.version,requestID:"cache-due",at:now)
        let result=try await coordinator.refreshAutomatic(documentID:initial.documentID,at:now)
        #expect(result.blocks.compactMap(\.taskID)==["task:"+task.id])
    }
    @Test func automaticSectionsStayStableAndRemovedHeadingsAreNotRecreated() async throws {
        let (root,_,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        var current=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"UTC")
        for number in 0..<2 {
            let source=event("section-\(number)");_ = try await store.ingest(source);try await store.automaticFixtureDecision(source.id,route:.notify,at:now)
            current=try await coordinator.refreshAutomatic(documentID:current.documentID,at:now)
        }
        #expect(current.content.components(separatedBy:"## FYI").count==2)
        let heading=try #require(current.blocks.first(where:{$0.blockID.hasPrefix("auto-heading:")}))
        current=try await coordinator.commit(documentID:current.documentID,expectedRevision:current.revision,content:current.content.replacingOccurrences(of:heading.content,with:""),commandID:"remove-heading")
        let source=event("after-removed-heading");_ = try await store.ingest(source);try await store.automaticFixtureDecision(source.id,route:.notify,at:now)
        current=try await coordinator.refreshAutomatic(documentID:current.documentID,at:now)
        #expect(!current.content.contains("## FYI"));#expect(current.blocks.contains{$0.eventID==source.id})
    }
    @Test func scheduledAcceptedTasksAppearWithoutOldRawEventBackfillAndFutureWins() async throws {
        let (root,_,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let initial=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"America/New_York")
        var due=DueSpec();due.date="2026-10-29";due.timeZone="America/New_York"
        var future=DueSpec();future.date="2026-10-31";future.timeZone="America/New_York"
        var dueInstant=DueSpec();dueInstant.kind = .instant;dueInstant.instant=now.addingTimeInterval(86400)
        for name in ["overdue","futureScheduled","futureInstant","waiting","completed","undated"] {
            var task=LifeTask();task.id=name;task.title=name
            if name != "undated" {task.due=due}
            if name=="futureScheduled" {task.scheduled=future}
            if name=="futureInstant" {task.due=dueInstant}
            if name=="waiting" {task.status = .waiting;task.waitingReason="Awaiting fixture response"};if name=="completed" {task.status = .completed}
            _ = try await store.saveTask(task,expectedVersion:0,requestID:"fixture-"+name,at:now.addingTimeInterval(-86400*10))
        }
        let result=try await coordinator.refreshAutomatic(documentID:initial.documentID,at:now)
        #expect(result.blocks.compactMap(\.taskID)==["task:overdue"])
        let historical=try await coordinator.open(notebookID:id,day:"2026-10-29",timeZone:"America/New_York")
        #expect(try await coordinator.refreshAutomatic(documentID:historical.documentID,at:now).revision==historical.revision)
    }
}

// Explicit synthetic routing fixture tests storage policy, never live model quality.
extension KnowledgeStore {
    fileprivate func automaticFixtureDecision(_ eventID:String,route:Route,success:Bool=true,at:Date) throws {
        let context=try context(for:eventID)
        let assessment=Assessment(notify:0,askUser:0,reason:0,summarize:0,jobStage:.unchanged,stageConfidence:0,model:"automatic-today-test-fixture",provider:"test-fixture")
        let decision=Decision(eventID:eventID,route:route,assessment:assessment,context:context,explanation:["Explicit synthetic test fixture"],policyVersion:"test-fixture",createdAt:at)
        try db.execute("INSERT OR REPLACE INTO decisions VALUES (?,?,?)",[eventID,try JSONCodec.string(decision),"test-fixture"])
        try db.execute("UPDATE processing_jobs SET status=? WHERE event_id=?",[success ? "succeeded":"failed",eventID])
        if [.notify,.askUser].contains(route) {try db.execute("INSERT OR REPLACE INTO work_items VALUES (?,?,?,'unread')",["auto-fixture:"+eventID,eventID,route.rawValue])}
    }
    fileprivate func automaticFixtureDeactivate(_ event:Event) throws {try db.execute("INSERT OR REPLACE INTO connector_source_records VALUES (?,?,?,?,0)",[event.source.connector,event.source.externalID,"{}",event.id])}
    fileprivate func automaticFixtureCount(_ documentID:String) throws -> Int {Int(try db.rows("SELECT COUNT(*) AS n FROM document_auto_insertions WHERE document_id=?",[documentID]).first?["n"] ?? "0") ?? 0}
}
