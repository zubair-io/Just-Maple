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
            let source=event("section-\(number)");_ = try await store.ingest(source);try await store.automaticFixtureDecision(source.id,route:.summarize,at:now)
            current=try await coordinator.refreshAutomatic(documentID:current.documentID,at:now)
        }
        #expect(current.content.components(separatedBy:"## FYI").count==2)
        let heading=try #require(current.blocks.first(where:{$0.blockID.hasPrefix("auto-heading:")}))
        current=try await coordinator.commit(documentID:current.documentID,expectedRevision:current.revision,content:current.content.replacingOccurrences(of:heading.content,with:""),commandID:"remove-heading")
        let source=event("after-removed-heading");_ = try await store.ingest(source);try await store.automaticFixtureDecision(source.id,route:.summarize,at:now)
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
    func automaticFixtureDecision(_ eventID:String,route:Route,success:Bool=true,at:Date) throws {
        let context=try context(for:eventID)
        let assessment=Assessment(notify:0,askUser:0,reason:0,summarize:0,jobStage:.unchanged,stageConfidence:0,model:"automatic-today-test-fixture",provider:"test-fixture")
        let decision=Decision(eventID:eventID,route:route,assessment:assessment,context:context,explanation:["Explicit synthetic test fixture"],policyVersion:"test-fixture",createdAt:at)
        try db.execute("INSERT OR REPLACE INTO decisions VALUES (?,?,?)",[eventID,try JSONCodec.string(decision),"test-fixture"])
        try db.execute("UPDATE processing_jobs SET status=? WHERE event_id=?",[success ? "succeeded":"failed",eventID])
        if [.notify,.askUser,.summarize].contains(route) {try db.execute("INSERT OR REPLACE INTO work_items VALUES (?,?,?,?)",["auto-fixture:"+eventID,eventID,route.rawValue,route == .summarize ? "proposed":"unread"])}
    }
    fileprivate func automaticFixtureDeactivate(_ event:Event) throws {try db.execute("INSERT OR REPLACE INTO connector_source_records VALUES (?,?,?,?,0)",[event.source.connector,event.source.externalID,"{}",event.id])}
    fileprivate func automaticFixtureCount(_ documentID:String) throws -> Int {Int(try db.rows("SELECT COUNT(*) AS n FROM document_auto_insertions WHERE document_id=?",[documentID]).first?["n"] ?? "0") ?? 0}
}

extension AutomaticTodayTests {
    @Test func emailMessageHomeAndRecordingFlowIntoTheRealDocumentAndSurviveReopen() async throws {
        let (root,library,store,coordinator,id)=try await ManagedDocumentTests().fixture()
        defer {try? FileManager.default.removeItem(at:root)}
        let initial=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"UTC")
        let email=event("reply",connector:"gmail"),message=event("update",connector:"imessage"),recording=event("transcript",connector:"recording")
        for (source,route) in [(email,Route.askUser),(message,.summarize),(recording,.summarize)] {
            _ = try await store.ingest(source)
            try await store.automaticFixtureDecision(source.id,route:route,at:now)
        }
        let home=ConnectorSourceRecord(id:"light.fixture",name:"Fixture lamp",content:"Home Assistant entity: light.fixture\nName: Fixture lamp\nState: on")
        _ = try await store.ingestSourceSnapshot([home],connector:"home_assistant",now:now)
        let batchID=try #require(await store.sourceList(query:SourceQuery(types:["home.batch"]),now:now).items.first?.id)
        try await store.automaticFixtureDecision(batchID,route:.summarize,at:now)
        let written=try await coordinator.commit(documentID:initial.documentID,expectedRevision:initial.revision,content:initial.content+"My own writing stays here.\n",commandID:"fixture-writing")
        let result=try await coordinator.refreshAutomatic(documentID:written.documentID,at:now)
        #expect(result.content.contains("My own writing stays here."))
        #expect(Set(result.blocks.compactMap(\.eventID)) == Set([email.id,message.id,recording.id,batchID]))
        let action=try #require(result.content.range(of:"## Action items")),fyi=try #require(result.content.range(of:"## FYI")),emailPosition=try #require(result.content.range(of:email.id))
        #expect(action.lowerBound < emailPosition.lowerBound && emailPosition.lowerBound < fyi.lowerBound)
        for source in [message,recording] {#expect(try #require(result.content.range(of:source.id)).lowerBound > fyi.lowerBound)}
        #expect(result.blocks.compactMap(\.taskID).isEmpty)
        #expect(result.content.contains("\"kind\":\"recording\""))
        let reopened=try await TodayDocumentCoordinator(store:store,library:library).refreshAutomatic(documentID:result.documentID,at:now)
        #expect(reopened.revision == result.revision)
        #expect(reopened.blocks.compactMap(\.eventID) == result.blocks.compactMap(\.eventID))
    }

    @Test func summaryRequiresSuccessfulProposedRecentSourceAndClearingDoesNotResurrectIt() async throws {
        let (root,_,store,coordinator,id)=try await ManagedDocumentTests().fixture()
        defer {try? FileManager.default.removeItem(at:root)}
        var current=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"UTC")
        for (key,route,success,connector) in [("eligible",Route.summarize,true,"gmail"),("dismissed",.summarize,true,"gmail"),("failed",.summarize,false,"imessage"),("reason",.reason,true,"gmail"),("own-note",.summarize,true,"notes")] {
            let source=event(key,connector:connector);_ = try await store.ingest(source)
            try await store.automaticFixtureDecision(source.id,route:route,success:success,at:now)
            if key == "dismissed" {try await store.automaticFixtureDismiss(source.id)}
        }
        current=try await coordinator.refreshAutomatic(documentID:current.documentID,at:now)
        let block=try #require(current.blocks.first { $0.eventID != nil })
        #expect(current.blocks.filter { $0.eventID != nil }.count == 1)
        #expect(block.content.contains("Fixture eligible"))
        current=try await coordinator.mutateBlock(.init(commandID:"clear-fyi",documentID:current.documentID,expectedRevision:current.revision,blockID:block.blockID,expectedBlockVersion:block.version,kind:"clear"))
        #expect(try await coordinator.refreshAutomatic(documentID:current.documentID,at:now).revision == current.revision)
        let next=try await coordinator.open(notebookID:id,day:"2026-10-31",timeZone:"UTC")
        #expect(try await coordinator.refreshAutomatic(documentID:next.documentID,at:now.addingTimeInterval(13*3600)).blocks.filter { $0.eventID != nil }.isEmpty)
    }
}

private extension KnowledgeStore {
    func automaticFixtureDismiss(_ id:String) throws {try db.execute("UPDATE work_items SET status='dismissed' WHERE event_id=?",[id])}
}

extension AutomaticTodayTests {
    func calendarFixture(_ key:String,start:String,end:String,allDay:Bool=false,zone:String="UTC") -> Event {
        Event(type:"calendar.snapshot",source:.init(connector:"google_calendar",account:"fixture",externalID:key,revision:"1"),occurredAt:now,receivedAt:now,subjects:["calendar:fixture"],content:"Google Calendar source record\nTitle: Fixture \(key)\nCalendar: Work\nStart: \(start)\nEnd: \(end)\nAll day: \(allDay)\nTime zone: \(zone)\nLocation: Studio\nNotes: Bring sketches")
    }
    @Test func calendarUsesScheduledDayRatherThanImportDateAndRepairsOnlyUntouchedAutoCards() async throws {
        let (root,_,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        var current=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"America/New_York")
        let today=calendarFixture("today",start:"2026-10-30T18:00:00Z",end:"2026-10-30T19:00:00Z")
        let future=calendarFixture("future",start:"2026-11-30T18:00:00Z",end:"2026-11-30T19:00:00Z")
        let edited=calendarFixture("edited",start:"2026-11-30T18:00:00Z",end:"2026-11-30T19:00:00Z")
        for event in [today,future,edited] {_ = try await store.ingest(event);try await store.automaticFixtureDecision(event.id,route:.summarize,at:now)}
        let eligible=try await store.automaticTodayCandidates(documentID:current.documentID,content:current.content,at:now)
        #expect(eligible.count == 1 && eligible[0].markdown.contains(today.id))
        let wrong=try await store.automaticSourceMarkdown(future,id:"auto-source:fixture-wrong")
        let userEdited=try await store.automaticSourceMarkdown(edited,id:"auto-source:fixture-edited")
        current=try await coordinator.commit(documentID:current.documentID,expectedRevision:current.revision,content:current.content+wrong+"\n"+userEdited+"My annotation about this event.\n",commandID:"fixture-old-insertion")
        try await coordinator.draft(documentID:current.documentID,revision:current.revision,content:current.content+"Unsaved thought")
        #expect(try await coordinator.refreshAutomatic(documentID:current.documentID,at:now).revision == current.revision)
        current=try await coordinator.commit(documentID:current.documentID,expectedRevision:current.revision,content:current.content+"Unsaved thought",commandID:"fixture-save")
        let repaired=try await coordinator.refreshAutomatic(documentID:current.documentID,at:now)
        #expect(!repaired.blocks.contains {$0.eventID == future.id})
        #expect(repaired.blocks.contains {$0.eventID == edited.id})
        #expect(repaired.blocks.contains {$0.eventID == today.id})
        #expect(repaired.content.contains("My annotation about this event."))
        #expect(repaired.content.contains("Unsaved thought"))
        #expect(try await store.documentBlock(id:"auto-source:fixture-wrong")?.state == "removed")
        #expect(try await coordinator.refreshAutomatic(documentID:current.documentID,at:now).revision == repaired.revision)
    }
    @Test func calendarOverlapHandlesExclusiveEndsAllDayZonesAndMissingDates() throws {
        let allDay=calendarFixture("all-day",start:"2026-10-30T00:00:00Z",end:"2026-10-31T00:00:00Z",allDay:true)
        let value=try #require(CalendarSourcePresentation(allDay))
        #expect(try value.overlaps(day:"2026-10-30",timeZone:"America/Los_Angeles"))
        #expect(try !value.overlaps(day:"2026-10-29",timeZone:"America/Los_Angeles"))
        #expect(try !value.overlaps(day:"2026-10-31",timeZone:"America/Los_Angeles"))
        let overnight=try #require(CalendarSourcePresentation(calendarFixture("overnight",start:"2026-10-29T23:30:00Z",end:"2026-10-30T01:00:00Z")))
        #expect(try overnight.overlaps(day:"2026-10-30",timeZone:"UTC"))
        let ended=try #require(CalendarSourcePresentation(calendarFixture("ended",start:"2026-10-29T23:00:00Z",end:"2026-10-30T00:00:00Z")))
        #expect(try !ended.overlaps(day:"2026-10-30",timeZone:"UTC"))
        #expect(CalendarSourcePresentation(event("missing",connector:"google_calendar")) == nil)
    }
}

extension AutomaticTodayTests {
    @Test func liveProposalIsReadOnlyAndNormalCommitConsumesStableIdentities() async throws {
        let (root,library,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let initial=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"UTC",collaborative:true)
        let source=event("live");_ = try await store.ingest(source);try await store.automaticFixtureDecision(source.id,route:.summarize,at:now)
        let draft=initial.content+"I am still typing.\n"
        try await coordinator.draft(documentID:initial.documentID,revision:initial.revision,content:draft)
        let proposal=try await coordinator.automaticProposal(documentID:initial.documentID,at:now)
        #expect(proposal.groups.count == 1 && proposal.groups[0].title == "FYI")
        #expect(proposal.groups[0].createHeading)
        #expect(try await library.read(notebookID:id,path:initial.path).content == initial.content)
        #expect(try await library.readDraft(notebookID:id,path:initial.path)?.content == draft)
        #expect(try await store.automaticFixtureCount(initial.documentID) == 0)
        #expect(try await coordinator.automaticProposal(documentID:initial.documentID,at:now).groups[0].blocks[0].blockID == proposal.groups[0].blocks[0].blockID)
        let group=proposal.groups[0]
        let content=draft+"\n"+(try ManagedMarkdown.marker(["id":group.headingID]))+"## FYI\n\n"+group.blocks.map(\.markdown).joined(separator:"\n")
        let saved=try await coordinator.commit(documentID:initial.documentID,expectedRevision:initial.revision,content:content,commandID:"fixture-live-save")
        #expect(saved.content.contains("I am still typing."))
        #expect(try await store.automaticFixtureCount(initial.documentID) == 1)
        #expect(try await coordinator.automaticProposal(documentID:initial.documentID,at:now).groups.isEmpty)
    }

    @Test func activeSessionDefersBackgroundWritesUntilReleasedAndExpires() async throws {
        let (root,_,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let initial=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"UTC",collaborative:true)
        #expect(await coordinator.hasEditorSession(documentID:initial.documentID))
        let source=event("session");_ = try await store.ingest(source);try await store.automaticFixtureDecision(source.id,route:.notify,at:now)
        #expect(try await coordinator.refreshAutomatic(documentID:initial.documentID,at:now).revision == initial.revision)
        try await coordinator.setEditorSession(documentID:initial.documentID,active:false)
        #expect(!((await coordinator.hasEditorSession(documentID:initial.documentID))))
        let saved=try await coordinator.refreshAutomatic(documentID:initial.documentID,at:now)
        #expect(saved.blocks.contains{$0.eventID == source.id})
        try await coordinator.setEditorSession(documentID:initial.documentID,active:true,at:now)
        #expect(await coordinator.hasEditorSession(documentID:initial.documentID,at:now.addingTimeInterval(29)))
        #expect(!((await coordinator.hasEditorSession(documentID:initial.documentID,at:now.addingTimeInterval(31)))))
    }

    @Test func liveReplyProposalWaitsForDurableCommitAndPreservesWriting() async throws {
        let (root,library,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        var initial=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"UTC",collaborative:true)
        let content=initial.content+(try ManagedMarkdown.marker(["id":"fixture-request"]))+"@maple Find emails\n\n"
        initial=try await coordinator.commit(documentID:initial.documentID,expectedRevision:initial.revision,content:content,commandID:"fixture-request-save")
        let request=InlineMapleRequest(commandID:"fixture-live-run",documentID:initial.documentID,requestBlockID:"fixture-request",expectedRevision:initial.revision,text:"Find emails")
        let queued=try await store.queueInlineMaple(request,provider:"synthetic-test-fixture")
        _ = try await store.startInlineMaple(queued.runID)
        let run=try await store.completeInlineMaple(queued.runID,text:"Explicit fixture response.",eventIDs:[],total:0,coverage:"Fixture coverage")
        let proposal=try await coordinator.inlineResponseProposal(runID:run.runID)
        #expect(proposal.blocks.count == 2 && proposal.blocks[0].blockID == run.replyBlockID)
        #expect(try await store.inlineMapleRun(run.runID).status == "unapplied")
        #expect(try await library.read(notebookID:id,path:initial.path).content == initial.content)
        let saved=try await coordinator.commit(documentID:initial.documentID,expectedRevision:initial.revision,content:initial.content+proposal.blocks.map(\.markdown).joined(separator:"\n")+"\n"+(try ManagedMarkdown.marker(["id":"my-later-writing"]))+"Typing while Maple responds.\n",commandID:"fixture-save-live-response")
        #expect(saved.content.contains("Typing while Maple responds."))
        #expect(try await store.inlineMapleRun(run.runID).status == "succeeded")
        #expect(try await store.inlineMapleRun(run.runID).appliedRevision == saved.revision)
        #expect(try await coordinator.inlineResponseProposal(runID:run.runID).blocks.isEmpty)
    }
}

extension AutomaticTodayTests {
    @Test func replyAcknowledgmentRecoversAtomicallyAndMissingReplyNeverAcknowledges() async throws {
        let (root,library,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        var initial=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"UTC")
        initial=try await coordinator.commit(documentID:initial.documentID,expectedRevision:initial.revision,content:initial.content+(try ManagedMarkdown.marker(["id":"request"]))+"@maple Find messages\n",commandID:"reply-recovery-request")
        let request=InlineMapleRequest(commandID:"reply-recovery-run",documentID:initial.documentID,requestBlockID:"request",expectedRevision:initial.revision,text:"Find messages")
        let queued=try await store.queueInlineMaple(request,provider:"synthetic-test-fixture")
        _ = try await store.startInlineMaple(queued.runID)
        let run=try await store.completeInlineMaple(queued.runID,text:"Fixture response",eventIDs:[],total:0,coverage:"Fixture coverage")
        let proposal=try await coordinator.inlineResponseProposal(runID:run.runID)
        // A user deleting the first reply before its first save must not falsely
        // acknowledge delivery merely because a coverage paragraph remains.
        initial=try await coordinator.commit(documentID:initial.documentID,expectedRevision:initial.revision,content:initial.content+"\n"+proposal.blocks[1].markdown,commandID:"reply-missing-main")
        #expect(try await store.inlineMapleRun(run.runID).status == "unapplied")
        let content=initial.content+"\n"+proposal.blocks[0].markdown
        let mutation=DocumentMutationRecord(commandID:"reply-crash-save",documentID:initial.documentID,expectedRevision:initial.revision,targetRevision:ManagedMarkdown.hash(content),before:initial.content,after:content,state:"prepared",createdAt:now)
        _ = try await store.prepareDocumentMutation(mutation)
        #expect(try await store.inlineMapleRun(run.runID).status == "unapplied")
        _ = try await library.save(notebookID:id,path:initial.path,content:content,expectedRevision:initial.revision)
        #expect(try await store.inlineMapleRun(run.runID).status == "unapplied")
        let recoveredCoordinator=TodayDocumentCoordinator(store:store,library:library)
        let recovered=try await recoveredCoordinator.open(documentID:initial.documentID)
        #expect(recovered.revision == mutation.targetRevision)
        #expect(try await store.inlineMapleRun(run.runID).status == "succeeded")
        #expect(try await store.inlineMapleRun(run.runID).appliedRevision == recovered.revision)
        let replay=try await recoveredCoordinator.commit(documentID:initial.documentID,expectedRevision:initial.revision,content:content,commandID:mutation.commandID)
        #expect(replay.revision == recovered.revision)
        #expect(try await store.inlineMapleRun(run.runID).appliedRevision == recovered.revision)
    }
}

extension AutomaticTodayTests {
    @Test func acceptedThenDeletedBlocksSurviveDraftRecoveryAndCommitWithoutResurrection() async throws {
        let (root,library,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let initial=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"UTC")
        let source=event("deleted-before-save");_ = try await store.ingest(source);try await store.automaticFixtureDecision(source.id,route:.summarize,at:now)
        let proposal=try await coordinator.automaticProposal(documentID:initial.documentID,at:now)
        let group=try #require(proposal.groups.first),block=try #require(group.blocks.first)
        let receipts=[group.headingID,block.blockID]
        // Both were accepted into the live editor, then deleted before the first
        // autosave. The prose now exactly matches disk, but receipts are pending.
        try await coordinator.draft(documentID:initial.documentID,revision:initial.revision,content:initial.content,acceptedAutomaticBlockIDs:receipts)
        let recoveredDraft=try await TodayDocumentCoordinator(store:store,library:library).open(documentID:initial.documentID)
        #expect(Set(recoveredDraft.draft?.acceptedAutomaticBlockIDs ?? []) == Set(receipts))
        #expect(try await store.automaticFixtureCount(initial.documentID) == 0)
        let mutation=DocumentMutationRecord(commandID:"receipt-crash",documentID:initial.documentID,expectedRevision:initial.revision,targetRevision:initial.revision,before:initial.content,after:initial.content,state:"prepared",createdAt:now,acceptedAutomaticBlockIDs:receipts)
        _ = try await store.prepareDocumentMutation(mutation)
        #expect(try await store.automaticFixtureCount(initial.documentID) == 0)
        let recovered=try await TodayDocumentCoordinator(store:store,library:library).open(documentID:initial.documentID)
        #expect(recovered.content == initial.content)
        #expect(recovered.draft?.acceptedAutomaticBlockIDs == nil)
        #expect(try await store.automaticFixtureCount(initial.documentID) == 1)
        #expect(try await coordinator.automaticProposal(documentID:initial.documentID,at:now).groups.isEmpty)
        _ = try await coordinator.commit(documentID:initial.documentID,expectedRevision:initial.revision,content:initial.content,commandID:mutation.commandID,acceptedAutomaticBlockIDs:receipts)
        await #expect(throws:Error.self) {try await coordinator.commit(documentID:initial.documentID,expectedRevision:initial.revision,content:initial.content,commandID:mutation.commandID,acceptedAutomaticBlockIDs:[])}
        let next=event("new-after-deleted-heading");_ = try await store.ingest(next);try await store.automaticFixtureDecision(next.id,route:.summarize,at:now)
        let later=try await coordinator.automaticProposal(documentID:initial.documentID,at:now)
        #expect(later.groups.count == 1 && !later.groups[0].createHeading)
    }
}

extension AutomaticTodayTests {
    @Test func backgroundRefreshCannotReplayInterruptedSaveBehindAnActiveEditor() async throws {
        let (root,library,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let initial=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"UTC",collaborative:true)
        let content=initial.content+"Prepared save before the next keystroke.\n"
        let mutation=DocumentMutationRecord(commandID:"interrupted-while-editing",documentID:initial.documentID,expectedRevision:initial.revision,targetRevision:ManagedMarkdown.hash(content),before:initial.content,after:content,state:"prepared",createdAt:now)
        _ = try await store.prepareDocumentMutation(mutation)
        let current=try await coordinator.refreshAutomatic(documentID:initial.documentID,at:now)
        #expect(current.revision == initial.revision)
        #expect(try await library.read(notebookID:id,path:initial.path).content == initial.content)
        #expect(try await store.documentMutation(mutation.commandID)?.state == "prepared")
        try await coordinator.setEditorSession(documentID:initial.documentID,active:false)
        let recovered=try await coordinator.open(documentID:initial.documentID)
        #expect(recovered.content == content)
        #expect(try await store.documentMutation(mutation.commandID)?.state == "committed")
    }
}

extension AutomaticTodayTests {
    @Test func acceptedReplyDeletedBeforeSaveStaysDeletedAfterDraftAndJournalRecovery() async throws {
        let (root,library,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        var initial=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"UTC")
        initial=try await coordinator.commit(documentID:initial.documentID,expectedRevision:initial.revision,content:initial.content+(try ManagedMarkdown.marker(["id":"request"]))+"@maple Find messages\n",commandID:"deleted-reply-request")
        let request=InlineMapleRequest(commandID:"deleted-reply-run",documentID:initial.documentID,requestBlockID:"request",expectedRevision:initial.revision,text:"Find messages")
        let queued=try await store.queueInlineMaple(request,provider:"synthetic-test-fixture")
        _ = try await store.startInlineMaple(queued.runID)
        let run=try await store.completeInlineMaple(queued.runID,text:"Fixture response",eventIDs:[],total:0,coverage:"Fixture coverage")
        #expect(try await coordinator.inlineResponseProposal(runID:run.runID).blocks.count == 2)
        try await coordinator.draft(documentID:initial.documentID,revision:initial.revision,content:initial.content,acceptedReplyRunIDs:[run.runID])
        let draft=try await coordinator.open(documentID:initial.documentID)
        #expect(draft.draft?.acceptedReplyRunIDs == [run.runID])
        #expect(try await store.inlineMapleRun(run.runID).status == "unapplied")
        let other=try await coordinator.open(notebookID:id,day:"2026-10-31",timeZone:"UTC")
        await #expect(throws:Error.self) {try await coordinator.commit(documentID:other.documentID,expectedRevision:other.revision,content:other.content,commandID:"wrong-reply-receipt",acceptedReplyRunIDs:[run.runID])}
        let mutation=DocumentMutationRecord(commandID:"deleted-reply-crash",documentID:initial.documentID,expectedRevision:initial.revision,targetRevision:initial.revision,before:initial.content,after:initial.content,state:"prepared",createdAt:now,acceptedReplyRunIDs:[run.runID])
        _ = try await store.prepareDocumentMutation(mutation)
        #expect(try await store.inlineMapleRun(run.runID).status == "unapplied")
        let reopenedCoordinator=TodayDocumentCoordinator(store:store,library:library)
        let reopened=try await reopenedCoordinator.open(documentID:initial.documentID)
        #expect(reopened.content == initial.content)
        #expect(reopened.draft?.acceptedReplyRunIDs == nil)
        #expect(try await store.inlineMapleRun(run.runID).status == "succeeded")
        #expect(try await store.inlineMapleRun(run.runID).text == "Fixture response")
        #expect(try await reopenedCoordinator.inlineResponseProposal(runID:run.runID).blocks.isEmpty)
        _ = try await reopenedCoordinator.commit(documentID:initial.documentID,expectedRevision:initial.revision,content:initial.content,commandID:mutation.commandID,acceptedReplyRunIDs:[run.runID])
        _ = try await reopenedCoordinator.commit(documentID:initial.documentID,expectedRevision:initial.revision,content:initial.content+"\nLater writing\n",commandID:"after-deleted-reply",acceptedReplyRunIDs:[run.runID])
        #expect(try await store.inlineMapleRun(run.runID).appliedRevision == initial.revision)
    }
}

extension AutomaticTodayTests {
    @Test func receiptOnlyRecoveredDraftDefersBackgroundRefreshAndGeneratedCommit() async throws {
        let (root,library,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let initial=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"UTC")
        let source=event("receipt-only-draft");_ = try await store.ingest(source);try await store.automaticFixtureDecision(source.id,route:.summarize,at:now)
        let proposal=try await coordinator.automaticProposal(documentID:initial.documentID,at:now)
        let group=try #require(proposal.groups.first),block=try #require(group.blocks.first)
        let receipts=[group.headingID,block.blockID]
        try await coordinator.draft(documentID:initial.documentID,revision:initial.revision,content:initial.content,acceptedAutomaticBlockIDs:receipts)
        let restarted=TodayDocumentCoordinator(store:store,library:library)
        let pending=try await restarted.refreshAutomatic(documentID:initial.documentID,at:now)
        #expect(pending.revision == initial.revision)
        #expect(pending.warning?.contains("waiting") == true)
        #expect(try await library.read(notebookID:id,path:initial.path).content == initial.content)
        #expect(try await store.automaticFixtureCount(initial.documentID) == 0)
        // A proposal computed before the draft was noticed must also be stopped
        // by the serialized final write, including its same-prose receipt state.
        let generated=initial.content+"\n"+block.markdown
        let skipped=try await restarted.commit(documentID:initial.documentID,expectedRevision:initial.revision,content:generated,commandID:"stale-generated-proposal",preserveDraft:true,backgroundWrite:true)
        #expect(skipped.revision == initial.revision)
        #expect(try await store.documentMutation("stale-generated-proposal") == nil)
        await #expect(throws:Error.self) {try await restarted.commit(documentID:initial.documentID,expectedRevision:initial.revision,content:generated,commandID:"preserve-receipt-draft",preserveDraft:true)}
        _ = try await restarted.commit(documentID:initial.documentID,expectedRevision:initial.revision,content:initial.content,commandID:"ack-deletion-draft",acceptedAutomaticBlockIDs:receipts)
        #expect(try await library.readDraft(notebookID:id,path:initial.path)?.acceptedAutomaticBlockIDs != nil)
        let next=event("after-receipt-ack");_ = try await store.ingest(next);try await store.automaticFixtureDecision(next.id,route:.summarize,at:now)
        let updated=try await restarted.refreshAutomatic(documentID:initial.documentID,at:now)
        #expect(updated.blocks.contains{$0.eventID == next.id})
        #expect(!updated.blocks.contains{$0.eventID == source.id})
    }
}

extension AutomaticTodayTests {
    @Test(arguments:[false,true]) func newerSameProseReceiptsSurviveCapturedCommitAndCrashRecovery(crash:Bool) async throws {
        let (root,library,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let initial=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"UTC")
        let source=event("same-prose-receipts");_ = try await store.ingest(source);try await store.automaticFixtureDecision(source.id,route:.summarize,at:now)
        let proposal=try await coordinator.automaticProposal(documentID:initial.documentID,at:now)
        let group=try #require(proposal.groups.first),block=try #require(group.blocks.first)
        let captured=initial.content+"Writing captured before another arrival was deleted.\n"
        let oldReceipts=[group.headingID],newReceipts=[group.headingID,block.blockID]
        try await coordinator.draft(documentID:initial.documentID,revision:initial.revision,content:captured,acceptedAutomaticBlockIDs:newReceipts)
        if crash {
            let mutation=DocumentMutationRecord(commandID:"old-captured-receipts",documentID:initial.documentID,expectedRevision:initial.revision,targetRevision:ManagedMarkdown.hash(captured),before:initial.content,after:captured,state:"prepared",createdAt:now,acceptedAutomaticBlockIDs:oldReceipts)
            _ = try await store.prepareDocumentMutation(mutation)
            _ = try await library.save(notebookID:id,path:initial.path,content:captured,expectedRevision:initial.revision)
        } else {
            _ = try await coordinator.commit(documentID:initial.documentID,expectedRevision:initial.revision,content:captured,commandID:"old-captured-receipts",acceptedAutomaticBlockIDs:oldReceipts)
        }
        let restarted=TodayDocumentCoordinator(store:store,library:library)
        let recovered=try await restarted.open(documentID:initial.documentID)
        #expect(recovered.content == captured)
        #expect(recovered.draft?.content == captured)
        #expect(recovered.draft?.revision == recovered.revision)
        #expect(recovered.draft?.acceptedAutomaticBlockIDs == [block.blockID])
        #expect(try await restarted.refreshAutomatic(documentID:initial.documentID,at:now).revision == recovered.revision)
        _ = try await restarted.commit(documentID:initial.documentID,expectedRevision:recovered.revision,content:captured,commandID:"save-newer-receipt",acceptedAutomaticBlockIDs:[block.blockID])
        #expect(try await restarted.automaticProposal(documentID:initial.documentID,at:now).groups.isEmpty)
        #expect(try await store.automaticFixtureCount(initial.documentID) == 1)
    }
}
