import Foundation
import Testing
@testable import MapleCore

struct MessageReviewContextTests {
    let at=Date(timeIntervalSince1970:floor(Date().timeIntervalSince1970)+10)
    func message(_ id:String,offset:Double,connector:String="imessage",thread:String="selected",account:String="fixture",revision:String="1",received:Date?=nil,content:String="Synthetic message",type:String="message.received")->Event {
        let date=at.addingTimeInterval(offset)
        return Event(type:type,source:Source(connector:connector,account:account,externalID:id,revision:revision),occurredAt:date,receivedAt:received ?? date,subjects:["person:self","thread:\(connector):\(thread)"],content:content)
    }
    @Test(arguments:["gmail","imessage"])
    func originalRequestSeesLaterResolutionButNewRequestKeepsOwnIdentity(connector:String) async throws {
        let store=try KnowledgeStore(path:":memory:")
        let original=message("request",offset:-300,connector:connector,content:"Please send your billing postcode.")
        let answer=message("answer",offset:-200,connector:connector,content:"The postcode is 12345.",type:"message.sent")
        let resolved=message("resolved",offset:-100,connector:connector,content:"That completes verification; nothing further is needed.")
        let newRequest=message("new-request",offset:-50,connector:connector,content:"Separately, please choose a delivery date.")
        for event in [original,answer,resolved,newRequest] {try await store.ingest(event)}
        let first=try MessageScreeningContext.filtered(await store.modelContext(for:original.id,at:at),at:at)
        #expect(first.event.id == original.id && first.event.content == original.content)
        #expect(first.recentEvents.map(\.id) == [answer.id,resolved.id,newRequest.id])
        #expect(first.messageReview?.assessmentScope == "original_source_obligation_at_review_time")
        #expect(first.messageReview?.omittedCount == 0)
        let newer=try MessageScreeningContext.filtered(await store.modelContext(for:newRequest.id,at:at),at:at)
        #expect(newer.event.id == newRequest.id && newer.event.content == newRequest.content)
        #expect(newer.recentEvents.contains {$0.id == resolved.id})
        // Contract fixtures prove available evidence and question semantics, not live model quality.
        #expect(TypeSafeClassifier.messageQuestions.values.allSatisfy {$0.instructions.contains("later independent request") && $0.instructions.contains("partial answer")})
        #expect(LayaClassifier.messageQuestions.allSatisfy {$0.1.instructions.contains("later independent request") && $0.1.instructions.contains("partial answer")})
        #expect(TypeSafeClassifier.messageQuestions["meaningful_update"]!.instructions.contains("newly learned material completion"))
        #expect(TypeSafeClassifier.messageQuestions["meaningful_update"]!.instructions.contains("routine closure already established"))
        let encoded=try #require(try JSONSerialization.jsonObject(with:Data(LayaClassifier.render(first).utf8)) as? [String:Any])
        #expect((encoded["messageReview"] as? [String:Any])?["assessmentScope"] as? String == first.messageReview?.assessmentScope)
    }
    @Test func accountThreadRevisionAndAvailabilityIsolation() async throws {
        let store=try KnowledgeStore(path:":memory:")
        let source=message("request",offset:-1000),old=message("reply",offset:-800),latest=message("reply",offset:-500,revision:"2")
        let safe=message("safe",offset:-200)
        for event in [source,old,latest,safe,message("other-thread",offset:-100,thread:"other"),message("other-account",offset:-100,account:"other"),message("future",offset:1),message("future-receipt",offset:-100,received:at.addingTimeInterval(1)),message("expired",offset:-AIProcessingWindow.duration-1)] {try await store.ingest(event)}
        let context=try await store.modelContext(for:source.id,at:at)
        #expect(context.recentEvents.map(\.id) == [latest.id,safe.id])
        #expect(context.messageReview?.totalObservations == 3)
        #expect(try await store.classificationMessageReviewIsCurrent(context,at:at))
        try await store.ingest(message("unrelated",offset:-10,thread:"elsewhere"))
        #expect(try await store.classificationMessageReviewIsCurrent(context,at:at))
        try await store.ingest(message("late-import",offset:-900,received:at))
        #expect(try await !store.classificationMessageReviewIsCurrent(context,at:at))
    }
    @Test func boundedLatestAndAdjacentContextDisclosesGapsAndTruncation() async throws {
        let store=try KnowledgeStore(path:":memory:")
        var events=[Event]()
        for index in 0..<40 {
            let event=message("message-\(index)",offset:Double(index-50),content:index==11 ? String(repeating:"合成🙂",count:500):"Synthetic \(index)")
            events.append(event);try await store.ingest(event)
        }
        let context=try await store.modelContext(for:events[10].id,at:at)
        let expected=Set(([8,9,11,12,13,14]+Array(32..<40)).map{events[$0].id})
        #expect(Set(context.recentEvents.map(\.id)) == expected)
        #expect(context.messageReview?.omittedCount == 25)
        #expect(context.messageReview?.truncatedEventIDs == [events[11].id])
        #expect(context.recentEvents.first {$0.id == events[11].id}!.content.utf8.count<=800)
        #expect(try MessageScreeningContext.filtered(context,at:at).messageReview == context.messageReview)
    }
    @Test func relevantTerminalTasksSurviveUnrelatedTasksAndFenceChanges() async throws {
        let store=try KnowledgeStore(path:":memory:")
        let source=message("request",offset:-100),other=message("other",offset:-100,thread:"other")
        for event in [source,other] {try await store.ingest(event)}
        for index in 0..<42 {var t=LifeTask();t.title="Unrelated \(index)";t.evidenceIDs=[other.id];_ = try await store.saveTask(t,expectedVersion:0,requestID:"other-\(index)",at:at.addingTimeInterval(-1))}
        var t=LifeTask();t.title="Completed original request";t.evidenceIDs=[source.id];t.status = .completed
        var saved=try await store.saveTask(t,expectedVersion:0,requestID:"linked",at:at.addingTimeInterval(-2))
        let context=try await store.modelContext(for:source.id,at:at)
        #expect(context.world?.tasks.map(\.id) == [saved.id])
        #expect(context.world?.tasks.first?.status == .completed)
        saved.status = .open
        _ = try await store.saveTask(saved,expectedVersion:saved.version,requestID:"reopen",at:at)
        #expect(try await !store.classificationMessageReviewIsCurrent(context,at:at))
    }
    @Test func safeProviderSetupFailuresRemainActionableWithoutAutomaticRetry() {
        for (text,code) in [
            ("The selected Codex model is unavailable for this ChatGPT account or CLI. Choose a supported model for Maple and test the connection again.","provider_model"),
            ("Provider authentication expired. Sign in to the selected provider and test the connection again.","provider_auth")
        ] {
            let failure=TaskExtractionFailure.classify(MapleError.provider(text))
            #expect(failure.code == code && failure.message == text && !failure.retryable)
        }
        let unknown=TaskExtractionFailure.classify(MapleError.provider("Private raw provider failure fixture"))
        #expect(!unknown.message.contains("Private raw"))
    }
    @Test func staleTaskReviewCannotRetirePriorProposalAndRetriesWithFreshEvidence() async throws {
        let store=try KnowledgeStore(path:":memory:")
        let source=message("request",offset:-100,content:"Please send the completed form.")
        try await store.ingest(source)
        var suggestion=TaskSuggestion();suggestion.eventID=source.id;suggestion.quote=source.content;suggestion.provider="fixture";suggestion.candidate.title="Send the completed form"
        let offered=try await store.offerTask(suggestion,at:at.addingTimeInterval(-10))
        try await store.requestTaskExtraction(eventID:source.id)
        let (_,token)=try #require(await store.acquireTaskExtraction(at:at,eventIDs:[source.id]))
        let context=try await store.taskModelContext(for:source.id,at:at)
        #expect(context.messageReview != nil)
        try await store.ingest(message("answer",offset:1,content:"The form is now submitted.",type:"message.sent"))
        do {
            try await store.commitTaskExtraction([],eventID:source.id,token:token,at:at.addingTimeInterval(2),reviewContext:context)
            Issue.record("A stale review must not retire the proposal.")
        } catch {
            #expect(TaskExtractionFailure.classify(error).code == "context_changed")
            try await store.failTaskExtraction(eventID:source.id,token:token,error:error,at:at.addingTimeInterval(2))
        }
        #expect(try await store.reviewSuggestionStatus(offered.id) == "pending")
        #expect(try await store.taskExtractionQueue().first?.status == "pending")
        let fresh=try await store.taskModelContext(for:source.id,at:at.addingTimeInterval(65))
        let (_,next)=try #require(await store.acquireTaskExtraction(at:at.addingTimeInterval(65),eventIDs:[source.id]))
        try await store.commitTaskExtraction([],eventID:source.id,token:next,at:at.addingTimeInterval(65),reviewContext:fresh)
        #expect(try await store.reviewSuggestionStatus(offered.id) == "superseded")
    }
    @Test func taskPromptPruningKeepsFenceAndTruthfulSelectionMetadata() async throws {
        let store=try KnowledgeStore(path:":memory:")
        let source=message("request",offset:-100)
        try await store.ingest(source)
        for index in 1...12 {try await store.ingest(message("reply-\(index)",offset:Double(-100+index),content:String(repeating:"Synthetic supporting evidence. ",count:60)))}
        let context=try await store.taskModelContext(for:source.id,at:at)
        let text=try TaskEvidenceRules.promptContext(context,maxBytes:8_000)
        let sent=try JSONCodec.decode(Context.self,from:Data(text.utf8))
        #expect(sent.messageReview?.snapshotHash == context.messageReview?.snapshotHash)
        #expect(sent.messageReview?.selectedEventIDs == sent.recentEvents.map(\.id))
        #expect(sent.messageReview?.omittedCount == 12-sent.recentEvents.count)
        #expect(sent.recentEvents.count<12)
    }
    @Test func inFlightThreadChangePreservesResponseButCommitsNoDecisionOrDownstreamWork() async throws {
        let store=try KnowledgeStore(path:":memory:")
        let source=message("request",offset:-100,content:"Please send the form.")
        try await store.ingest(source)
        let context=try await store.modelContext(for:source.id,at:at)
        let lease=try #require(await store.acquire(now:at,eventIDs:[source.id]))
        let assessment=Assessment(notify:0,askUser:1,reason:0,summarize:1,jobStage:.unchanged,stageConfidence:1,model:"fixture",provider:"fixture",containsFacts:1)
        let decision=Policy.decide(context:context,assessment:assessment,now:at)
        try await store.ingest(message("answer",offset:1,content:"Here is the completed form.",type:"message.sent"))
        #expect(try await !store.finish(lease,decision:decision,raw:Data("synthetic response".utf8),now:at.addingTimeInterval(2)))
        #expect(try await store.decisions().isEmpty)
        let effects=try await store.reviewFenceEffects(source.id)
        #expect(effects.status == "pending")
        #expect(effects.downstream == 0)
        #expect(effects.responses == 1)
    }
}
private extension KnowledgeStore {
    func reviewSuggestionStatus(_ id:String)throws->String {
        let row=try db.rows("SELECT json FROM task_suggestions WHERE id=?",[id]).first!
        return try JSONCodec.decode(TaskSuggestion.self,from:Data(row["json"]!.utf8)).reviewStatus
    }
    func reviewFenceEffects(_ id:String)throws->(status:String,downstream:Int,responses:Int) {
        let status=try db.rows("SELECT status FROM processing_jobs WHERE event_id=?",[id]).first?["status"] ?? "missing"
        var downstream=0
        for table in ["work_items","fact_jobs","task_extraction_jobs"] {downstream += try db.rows("SELECT event_id FROM \(table) WHERE event_id=?",[id]).count}
        let responses=try db.rows("SELECT id FROM source_artifacts WHERE event_id=? AND kind='response'",[id]).count
        return (status,downstream,responses)
    }
}
