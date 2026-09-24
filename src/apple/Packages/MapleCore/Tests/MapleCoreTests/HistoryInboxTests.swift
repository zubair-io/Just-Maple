import Foundation
import Testing
@testable import MapleCore
struct HistoryInboxTests {
    let now=Date(timeIntervalSince1970:1_800_000_000)
    func event(_ id:String,connector:String="gmail",content:String?=nil)->Event {Event(id:id,type:"source.update",source:Source(connector:connector,account:"fixture",externalID:id,revision:"1"),occurredAt:now,subjects:["person:self","thread:fixture"],content:content ?? "Sender: Fixture Person\nSubject: Fixture subject\nBody:\nPlease review the fixture form.")}
    @Test func equalTimestampKeysetPagesExcludeNewArrivalsAndFilterServerSide()async throws {
        let store=try KnowledgeStore(path:":memory:")
        for i in 0..<8 {try await store.ingest(event("fixture-\(i)",connector:i%2==0 ? "gmail":"imessage"))}
        let first=try await store.historyInboxPage(limit:3)
        #expect(first.items.map(\.id)==["fixture-7","fixture-6","fixture-5"])
        try await store.ingest(event("fixture-4-new"))
        let second=try await store.historyInboxPage(cursor:first.nextCursor,limit:3)
        let third=try await store.historyInboxPage(cursor:second.nextCursor,limit:3)
        #expect(Set((first.items+second.items+third.items).map(\.id)).count==8)
        #expect(!second.items.contains{$0.id=="fixture-4-new"} && third.nextCursor==nil && third.total==8)
        let gmail=try await store.historyInboxPage(limit:2,connector:"gmail")
        #expect(gmail.total==5 && gmail.items.allSatisfy{$0.connector=="gmail"})
        #expect(try await store.historyInboxPage(cursor:gmail.nextCursor,limit:2,connector:"gmail").items.allSatisfy{$0.connector=="gmail"})
        await #expect(throws:Error.self){try await store.historyInboxPage(cursor:gmail.nextCursor,connector:"imessage")}
    }
    @Test func classificationProgressIsSeparateFromDeeperAnalysis()async throws {
        let store=try KnowledgeStore(path:":memory:"),source=event("fixture")
        try await store.ingest(source)
        #expect(try await store.historyInboxPage().items[0].status=="waiting")
        try await store.fixtureInboxStatus(source.id,processing:"succeeded",deeper:"pending")
        let processed=try await store.historyInboxPage().items[0]
        #expect(processed.status=="processed" && processed.analysisStatus=="waiting")
        try await store.fixtureInboxStatus(source.id,processing:"succeeded",deeper:"failed")
        #expect(try await store.historyInboxPage().items[0].status=="processed")
        #expect(try await store.historyInboxPage().items[0].analysisStatus=="failed")
        try await store.fixtureInboxStatus(source.id,processing:"blocked",deeper:"done")
        #expect(try await store.historyInboxPage().items[0].status=="failed")
    }
    @Test func activityTagsAndCanonicalTerminalStatuses()async throws {
        let store=try KnowledgeStore(path:":memory:"),source=event("fixture")
        try await store.ingest(source);try await store.fixtureInboxStatus(source.id,processing:"succeeded",deeper:"done")
        var activity=LifeActivity();activity.name="Fixture activity";activity=try await store.saveActivity(activity,expectedVersion:0,requestID:"activity")
        var candidate=TaskSuggestion();candidate.eventID=source.id;candidate.quote="Please review the fixture form.";candidate.provider="fixture";candidate.candidate.title="Review fixture form";candidate.candidate.activityIDs=[activity.id]
        let suggestion=try await store.offerTask(candidate)
        #expect(try await store.historyInboxPage().items[0].status=="flagged")
        _ = try await store.reviewSuggestion(id:suggestion.id,action:"accept",edited:nil,expectedVersion:suggestion.version,requestID:"accept")
        let task=try #require(await store.tasks().first)
        _ = try await store.applyTaskAction(nodeID:"task:"+task.id,change:TaskActionChange(kind:"done",issuedAt:now),expectedVersion:task.version,requestID:"done",scope:"fixture")
        let page=try await store.historyInboxPage()
        #expect(page.items[0].status=="processed" && page.items[0].tags.first?.name=="Fixture activity")
        // A stale duplicate still says open, but its canonical task is terminal.
        let second=event("fixture-duplicate");try await store.ingest(second);try await store.fixtureInboxStatus(second.id,processing:"succeeded",deeper:"done")
        candidate.id=UUID().uuidString;candidate.eventID=second.id
        let duplicate=try await store.offerTask(candidate)
        try await store.fixtureInboxRelation(source:"source:"+duplicate.id,target:"task:"+task.id)
        #expect(try await store.historyInboxPage().items.first{$0.id==second.id}?.status=="processed")
    }
    @Test func allConnectorsBoundedPreviewsAndAggregateQueueCounts()async throws {
        let store=try KnowledgeStore(path:":memory:")
        for (i,connector) in ["gmail","imessage","home_assistant","apple_calendar","google_calendar","notebook","companion","apple_contacts"].enumerated(){try await store.ingest(event("source-\(i)",connector:connector,content:"Sender: Fixture\nSubject: Subject\nBody:\n"+String(repeating:"🙂",count:3000)+"PRIVATE_END_SENTINEL"))}
        let page=try await store.historyInboxPage()
        #expect(page.items.count==8 && page.sources.count==8)
        #expect(page.items.allSatisfy{$0.preview.utf8.count<=280 && $0.sender=="Fixture" && $0.subject=="Subject"})
        #expect(!String(data:try JSONCodec.encode(page),encoding:.utf8)!.contains("PRIVATE_END_SENTINEL"))
        #expect(try await store.recentQueue(limit:3).count==3)
        #expect(try await store.processingQueueCounts()["pending"]==8)
        await #expect(throws:Error.self){try await store.historyInboxPage(limit:101)}
    }
}
private extension KnowledgeStore {
    func fixtureInboxStatus(_ id:String,processing:String,deeper:String)throws {try db.execute("UPDATE processing_jobs SET status=? WHERE event_id=?",[processing,id]);try db.execute("INSERT OR REPLACE INTO state_jobs(event_id,status) VALUES (?,?)",[id,deeper])}
    func fixtureInboxRelation(source:String,target:String)throws {try db.execute("INSERT INTO task_relations VALUES (?,?)",[source,try JSONCodec.string(TaskRelation(duplicateID:source,primaryID:target,reason:"Synthetic fixture",evidenceIDs:[]))])}
}
