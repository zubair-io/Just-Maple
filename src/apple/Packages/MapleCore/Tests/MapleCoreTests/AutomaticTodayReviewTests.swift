import Foundation
import Testing
@testable import MapleCore

/// Explicit synthetic routing/extraction fixtures. These tests do not assess live model quality.
struct AutomaticTodayReviewTests {
    let now = ISO8601DateFormatter().date(from: "2026-10-30T16:00:00Z")!
    func source(_ name: String) -> Event {
        Event(type:"message.received", source:Source(connector:"gmail",account:"synthetic",externalID:name,revision:"1"),
              occurredAt:now.addingTimeInterval(-30),receivedAt:now.addingTimeInterval(-30),
              subjects:["person:self","thread:gmail:synthetic"],content:"Subject: Synthetic \(name)\nBody:\nComplete the requested setup before using the service.")
    }
    @Test func successfulReviewRetiresOnlyUnchangedCardAndNeverCompletesCanonicalTask() async throws {
        let (root,library,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let event=source("resolved")
        _ = try await store.ingest(event)
        try await store.reviewTodayFixture(event.id,route:.notify,at:now)
        let initial=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"UTC")
        let inserted=try await coordinator.refreshAutomatic(documentID:initial.documentID,at:now)
        let card=try #require(inserted.blocks.first{$0.eventID==event.id})
        var task=LifeTask();task.title="Separate canonical obligation";task.evidenceIDs=[event.id]
        task=try await store.saveTask(task,expectedVersion:0,requestID:"synthetic-open-task",at:now)
        try await store.reviewTodayFixture(event.id,route:.retain,review:true,work:"superseded",at:now)
        let proposal=try await coordinator.automaticProposal(documentID:initial.documentID,at:now)
        #expect(proposal.removals.map(\.blockID)==[card.blockID])
        #expect(proposal.removals.first?.markdown==card.content)
        #expect(try await library.read(notebookID:id,path:inserted.path).revision==inserted.revision)
        let refreshed=try await coordinator.refreshAutomatic(documentID:initial.documentID,at:now)
        #expect(!refreshed.blocks.contains{$0.blockID==card.blockID})
        #expect(try await store.event(event.id)?.content==event.content)
        #expect(try await store.tasks().first{$0.id==task.id}?.status == .open)
        #expect(try await store.tasks().first{$0.id==task.id}?.version==task.version)
        #expect(try await coordinator.automaticProposal(documentID:initial.documentID,at:now).removals.isEmpty)
    }
    @Test(arguments:["pending","failed","unreviewed","active-work","wrong-scope","task-pending","task-failed"])
    func incompleteOrUnprovenReviewDoesNotRemoveAttention(_ scenario:String) async throws {
        let (root,_,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let event=source(scenario);_ = try await store.ingest(event)
        try await store.reviewTodayFixture(event.id,route:.notify,at:now)
        let initial=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"UTC")
        let inserted=try await coordinator.refreshAutomatic(documentID:initial.documentID,at:now)
        try await store.reviewTodayFixture(event.id,route:.retain,review:scenario != "unreviewed",processing:["pending","failed"].contains(scenario) ? scenario:"succeeded",work:scenario=="active-work" ? "unread":"superseded",scope:scenario=="wrong-scope" ? "other":"original_source_obligation_at_review_time",at:now)
        if scenario.hasPrefix("task-") {_ = try await store.reviewTodaySuggestion(event,scenario:String(scenario.dropFirst(5)),at:now)}
        #expect(try await coordinator.automaticProposal(documentID:initial.documentID,at:now).removals.isEmpty)
        #expect(try await coordinator.refreshAutomatic(documentID:initial.documentID,at:now).revision==inserted.revision)
    }
    @Test func failedOldExtractionWithoutProposalDoesNotBlockFreshRetainedReview() async throws {
        let (root,_,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let event=source("old-failed-empty");_ = try await store.ingest(event)
        try await store.reviewTodayFixture(event.id,route:.notify,at:now)
        let initial=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"UTC")
        let inserted=try await coordinator.refreshAutomatic(documentID:initial.documentID,at:now)
        try await store.reviewTodayEmptyExtraction(event.id,status:"failed")
        try await store.reviewTodayFixture(event.id,route:.retain,review:true,work:"superseded",at:now)
        #expect(try await coordinator.automaticProposal(documentID:initial.documentID,at:now).removals.map(\.blockID)==inserted.blocks.filter{$0.eventID==event.id}.map(\.blockID))
        #expect(try await store.reviewTodayExtractionStatus(event.id)=="failed")
    }
    @Test func taskOnlyCardRetiresAfterFreshEmptyReviewSupersedesProposal() async throws {
        let (root,_,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let event=source("task-only-resolved");_ = try await store.ingest(event)
        try await store.reviewTodayFixture(event.id,route:.retain,at:now)
        let suggestion=try await store.reviewTodaySuggestion(event,at:now)
        try await store.reviewTodayRemoveWork(event.id)
        let initial=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"UTC")
        let inserted=try await coordinator.refreshAutomatic(documentID:initial.documentID,at:now)
        let card=try #require(inserted.blocks.first{$0.eventID==event.id})
        try await store.reviewTodayFixture(event.id,route:.retain,review:true,at:now)
        try await store.reviewTodayRemoveWork(event.id)
        try await store.reviewTodaySupersede(suggestion.id)
        #expect(try await coordinator.automaticProposal(documentID:initial.documentID,at:now).removals.map(\.blockID)==[card.blockID])
        #expect(try await coordinator.refreshAutomatic(documentID:initial.documentID,at:now).blocks.filter{$0.eventID==event.id}.isEmpty)
        #expect(try await store.tasks().isEmpty)
    }
    @Test(arguments:["escaped-id","escaped-key","key-order","extra-metadata","label","prose","body-serialization"])
    func equivalentMarkerSerializationRetiresButUserChangesRemain(_ scenario:String) async throws {
        let (root,_,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let event=source("marker-serialization");_ = try await store.ingest(event)
        try await store.reviewTodayFixture(event.id,route:.notify,at:now)
        let initial=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"UTC")
        let inserted=try await coordinator.refreshAutomatic(documentID:initial.documentID,at:now)
        let card=try #require(inserted.blocks.first{$0.eventID==event.id})
        let lines=card.content.components(separatedBy:"\n")
        let body=lines.dropFirst().joined(separator:"\n")
        var marker=lines[0],changedBody=body
        switch scenario {
        case "escaped-id":marker=marker.replacingOccurrences(of:"auto-source:",with:#"auto\u002dsource:"#)
        case "escaped-key":marker=marker.replacingOccurrences(of:#""id""#,with:#""\u0069d""#)
        case "key-order":marker="<!-- maple:block {\"v\":1,\"id\":\"\(card.blockID)\"} -->"
        case "extra-metadata":marker="<!-- maple:block {\"id\":\"\(card.blockID)\",\"v\":1,\"custom\":\"user annotation\"} -->"
        case "label":changedBody=body.replacingOccurrences(of:"Synthetic marker-serialization",with:"My source label")
        case "prose":changedBody += "My added writing\n"
        default:changedBody=body.replacingOccurrences(of:"marker-serialization",with:#"marker\u002dserialization"#)
        }
        let edited=marker+"\n"+changedBody
        let saved=try await coordinator.commit(documentID:initial.documentID,expectedRevision:inserted.revision,content:inserted.content.replacingOccurrences(of:card.content,with:edited),commandID:"synthetic-serialization")
        try await store.reviewTodayFixture(event.id,route:.retain,review:true,work:"superseded",at:now)
        let equivalent=["escaped-id","escaped-key","key-order"].contains(scenario)
        let proposal=try await coordinator.automaticProposal(documentID:initial.documentID,at:now)
        #expect(proposal.removals.map(\.blockID)==(equivalent ? [card.blockID]:[]))
        if equivalent {#expect(proposal.removals.first?.markdown==edited)}
        let refreshed=try await coordinator.refreshAutomatic(documentID:initial.documentID,at:now)
        #expect(refreshed.blocks.contains{$0.blockID==card.blockID} == !equivalent)
        if !equivalent {#expect(refreshed.revision==saved.revision)}
    }
    @Test func manualEditedUnprovenAndHistoricalCardsRemain() async throws {
        let (root,_,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let events=[source("edited"),source("unproven"),source("historical")]
        for event in events {_ = try await store.ingest(event)}
        for event in events {try await store.reviewTodayFixture(event.id,route:.notify,at:now)}
        let initial=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"UTC")
        var inserted=try await coordinator.refreshAutomatic(documentID:initial.documentID,at:now)
        let unproven=try #require(inserted.blocks.first{$0.eventID==events[1].id})
        try await store.removeReviewTodayLedger(unproven.blockID)
        let manual=try await store.automaticSourceMarkdown(events[0],id:"manual-card")
        inserted=try await coordinator.commit(documentID:inserted.documentID,expectedRevision:inserted.revision,content:inserted.content.replacingOccurrences(of:"Synthetic edited",with:"My edited source label")+"\n"+manual,commandID:"synthetic-user-writing")
        // Indexing restores the ledger for reserved IDs, so remove it after the manual edit.
        try await store.removeReviewTodayLedger(unproven.blockID)
        for event in events {try await store.reviewTodayFixture(event.id,route:.retain,review:true,work:"superseded",at:now)}
        let currentProposal=try await coordinator.automaticProposal(documentID:initial.documentID,at:now)
        #expect(currentProposal.removals.count==1)
        #expect(currentProposal.removals.first?.markdown.contains("Synthetic historical")==true)
        let tomorrow=now.addingTimeInterval(86400)
        #expect(try await coordinator.automaticProposal(documentID:initial.documentID,at:tomorrow).removals.isEmpty)
        #expect(try await coordinator.refreshAutomatic(documentID:initial.documentID,at:tomorrow).revision==inserted.revision)
    }
    @Test func recoveredUserDraftDefersRetirement() async throws {
        let (root,library,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let event=source("draft");_ = try await store.ingest(event);try await store.reviewTodayFixture(event.id,route:.notify,at:now)
        let initial=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"UTC")
        let inserted=try await coordinator.refreshAutomatic(documentID:initial.documentID,at:now)
        try await coordinator.draft(documentID:initial.documentID,revision:inserted.revision,content:inserted.content+"My unsaved writing\n")
        try await store.reviewTodayFixture(event.id,route:.retain,review:true,work:"superseded",at:now)
        #expect(try await coordinator.refreshAutomatic(documentID:initial.documentID,at:now).revision==inserted.revision)
        #expect(try await library.readDraft(notebookID:id,path:inserted.path)?.content.contains("My unsaved writing")==true)
    }
    @Test func actionablePendingExtractionAppearsAsEvidenceWithoutAcceptingTaskAndSuppressesRetirement() async throws {
        let (root,_,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let event=source("required-account-setup");_ = try await store.ingest(event)
        try await store.reviewTodayFixture(event.id,route:.retain,review:true,work:"superseded",at:now)
        let suggestion=try await store.reviewTodaySuggestion(event,at:now)
        let initial=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"UTC")
        let proposal=try await coordinator.automaticProposal(documentID:initial.documentID,at:now)
        #expect(proposal.groups.map(\.title)==["Action items"])
        #expect(proposal.groups.first?.blocks.first?.markdown.contains(event.id)==true)
        let inserted=try await coordinator.refreshAutomatic(documentID:initial.documentID,at:now)
        #expect(inserted.blocks.compactMap(\.eventID)==[event.id])
        #expect(inserted.blocks.compactMap(\.taskID).isEmpty)
        #expect(try await store.tasks().isEmpty)
        #expect(try await store.reviewTodaySuggestionState(suggestion.id)=="pending")
        #expect(try await coordinator.automaticProposal(documentID:initial.documentID,at:now).removals.isEmpty)
        #expect(try await coordinator.refreshAutomatic(documentID:initial.documentID,at:now).revision==inserted.revision)
    }
    @Test(arguments:["optional","rejected","superseded","accepted","waiting","completed","deferred","failed","pending","unsupported"])
    func nonactionableOrUnsuccessfulExtractionsDoNotCreateTodayCards(_ scenario:String) async throws {
        let (root,_,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let event=source(scenario);_ = try await store.ingest(event);try await store.reviewTodayFixture(event.id,route:.retain,at:now)
        if scenario != "optional" {_ = try await store.reviewTodaySuggestion(event,scenario:scenario,at:now)}
        let initial=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"UTC")
        #expect(try await coordinator.automaticProposal(documentID:initial.documentID,at:now).groups.isEmpty)
        #expect(try await coordinator.refreshAutomatic(documentID:initial.documentID,at:now).revision==initial.revision)
    }
}

extension KnowledgeStore {
    fileprivate func reviewTodayFixture(_ eventID:String,route:Route,review:Bool=false,processing:String="succeeded",work:String="unread",scope:String="original_source_obligation_at_review_time",at:Date) throws {
        var context=try context(for:eventID)
        if review {context.messageReview=MessageConversationReview(asOf:at,snapshotHash:"synthetic",totalObservations:2,selectedEventIDs:[],omittedCount:0,truncatedEventIDs:[],assessmentScope:scope)}
        let assessment=Assessment(notify:0,askUser:0,reason:0,summarize:0,jobStage:.unchanged,stageConfidence:0,model:"synthetic",provider:"synthetic")
        let decision=Decision(eventID:eventID,route:route,assessment:assessment,context:context,explanation:["Synthetic fixture"],policyVersion:"synthetic",createdAt:at)
        try db.execute("INSERT OR REPLACE INTO decisions VALUES (?,?,?)",[eventID,try JSONCodec.string(decision),"synthetic"])
        try db.execute("UPDATE processing_jobs SET status=? WHERE event_id=?",[processing,eventID])
        try db.execute("INSERT OR REPLACE INTO work_items VALUES (?,?,?,?)",["review-test:"+eventID,eventID,"notify",work])
    }
    fileprivate func removeReviewTodayLedger(_ id:String) throws {try db.execute("DELETE FROM document_auto_insertions WHERE block_id=?",[id])}
    fileprivate func reviewTodaySuggestion(_ event:Event,scenario:String="actionable",at:Date) throws -> TaskSuggestion {
        var suggestion=TaskSuggestion();suggestion.eventID=event.id;suggestion.quote="Complete the requested setup";suggestion.provider="synthetic";suggestion.candidate.title="Complete account setup";suggestion=try offerTask(suggestion,at:at)
        if ["rejected","superseded","accepted"].contains(scenario){suggestion.reviewStatus=scenario}
        if scenario=="waiting" {suggestion.candidate.status = .waiting}
        if scenario=="completed" {suggestion.candidate.status = .completed}
        if scenario=="unsupported" {suggestion.candidate.evidenceIDs=[]}
        var json=try JSONCodec.string(suggestion)
        if scenario=="deferred" {
            var value=try JSONSerialization.jsonObject(with:Data(json.utf8)) as! [String:Any]
            var candidate=value["candidate"] as! [String:Any];candidate["actionState"]=["resurfaceAt":at.addingTimeInterval(3600).timeIntervalSince1970];value["candidate"]=candidate
            json=String(decoding:try JSONSerialization.data(withJSONObject:value),as:UTF8.self)
        }
        try db.execute("UPDATE task_suggestions SET json=? WHERE id=?",[json,suggestion.id])
        try db.execute("INSERT OR REPLACE INTO task_extraction_jobs(event_id,status) VALUES (?,?)",[event.id,["failed","pending"].contains(scenario) ? scenario:"succeeded"])
        return suggestion
    }
    fileprivate func reviewTodayEmptyExtraction(_ eventID:String,status:String) throws {try db.execute("INSERT OR REPLACE INTO task_extraction_jobs(event_id,status) VALUES (?,?)",[eventID,status])}
    fileprivate func reviewTodayExtractionStatus(_ eventID:String) throws -> String? {try db.rows("SELECT status FROM task_extraction_jobs WHERE event_id=?",[eventID]).first?["status"]}
    fileprivate func reviewTodayRemoveWork(_ eventID:String) throws {try db.execute("DELETE FROM work_items WHERE event_id=?",[eventID])}
    fileprivate func reviewTodaySupersede(_ id:String) throws {try db.execute("UPDATE task_suggestions SET json=json_set(json,'$.reviewStatus','superseded') WHERE id=?",[id])}
    fileprivate func reviewTodaySuggestionState(_ id:String) throws -> String? {try db.rows("SELECT json_extract(json,'$.reviewStatus') AS state FROM task_suggestions WHERE id=?",[id]).first?["state"]}
}
