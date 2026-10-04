import Foundation
import Testing
@testable import MapleCore

struct SourceTableSnapshotTests {
    let now=Date(timeIntervalSince1970:1_790_750_000)
    func event(_ id:String,type:String="mail.received",connector:String="gmail",account:String="work",received:Date?=nil,content:String="Fixture review") -> Event {
        Event(id:id,type:type,source:Source(connector:connector,account:account,externalID:id,revision:"1"),occurredAt:now,receivedAt:received ?? now,subjects:["person:self"],content:content)
    }
    @Test func providerBranchesAndDistinctNoteCountStayFrozenAcrossPages()async throws {
        let store=try KnowledgeStore(path:":memory:")
        try await store.ingest(event("a"));try await store.ingest(event("b"))
        try await store.fixtureSourceAttempt("a",stage:"classification",provider:"jev",model:"fixture-classifier",at:1)
        try await store.fixtureSourceAttempt("a",stage:"facts",provider:"fixture-extractor",model:"fixture-model",at:1)
        try await store.fixtureSourceBranches("a")
        try await store.fixtureSourceLink("a",document:"one",block:"one-a")
        try await store.fixtureSourceLink("a",document:"one",block:"one-b")
        try await store.fixtureSourceLink("a",document:"two",block:"two-a")
        try await store.fixtureSourceLink("a",document:"cleared",block:"cleared",state:"cleared")
        let first=try await store.sourceList(limit:1,now:now)
        #expect(first.items[0].classificationProvider==nil)
        #expect(first.items[0].noteCount==0)
        try await store.fixtureSourceAttempt("a",stage:"classification",provider:"laya",model:"fixture-local",at:2)
        try await store.fixtureSourceLink("a",document:"three",block:"three-a")
        let second=try await store.sourceList(cursor:first.nextCursor,limit:1,now:now)
        let row=try #require(second.items.first)
        #expect(row.id=="a" && row.classificationProvider=="jev" && row.classificationModel=="fixture-classifier")
        #expect(row.noteCount==2)
        #expect(row.analysisBranches?.map(\.stage)==["facts","tasks","state"])
        #expect(row.analysisBranches?.first{$0.stage=="facts"}?.state=="succeeded")
        #expect(row.analysisBranches?.first{$0.stage=="facts"}?.provider=="fixture-extractor")
        #expect(row.analysisBranches?.first{$0.stage=="tasks"}?.state=="pending")
        #expect(row.analysisBranches?.first{$0.stage=="state"}?.state=="failed")
        let fresh=try await store.sourceDetail(eventID:"a")
        #expect(fresh.row.classificationProvider=="laya" && fresh.row.noteCount==3)
        #expect(Set(fresh.backlinks.map(\.documentID)).count==fresh.row.noteCount)
        #expect(first.snapshotCursor?.sessionID==second.snapshotCursor?.sessionID)
    }
    @Test func homeMembersShowRecordedBatchProviderWithoutInventingOwnAttempt()async throws {
        let store=try KnowledgeStore(path:":memory:")
        try await store.ingest(event("member",type:"home.state",connector:"home_assistant"))
        try await store.ingest(event("batch",type:"home.batch",connector:"home_assistant"))
        try await store.fixtureSourceBatch(member:"member",batch:"batch")
        try await store.fixtureSourceAttempt("batch",stage:"classification",provider:"jev",model:"fixture-batch",at:1)
        try await store.fixtureSourceBranches("batch")
        let row=try #require(await store.sourceList(query:SourceQuery(types:["home.state"]),now:now).items.first)
        #expect(row.classificationState=="batched" && row.classificationProvider=="jev")
        #expect(row.analysisBranches?.first{$0.stage=="state"}?.state=="failed")
        #expect(try await store.sourceDetail(eventID:"member").attempts.isEmpty)
    }
    @Test func arrivalChecksApplySameFiltersWithoutMovingOrAllocatingSnapshots()async throws {
        let store=try KnowledgeStore(path:":memory:")
        try await store.ingest(event("a"));try await store.ingest(event("b"))
        let query=SourceQuery(types:["mail.received"],connectors:["gmail"],accounts:["work"],states:["pending"],receivedAfter:now.addingTimeInterval(-1),receivedBefore:now.addingTimeInterval(1),text:"Fixture")
        let page=try await store.sourceList(query:query,limit:1,windowID:"fixture",now:now)
        let cursor=try #require(page.snapshotCursor)
        #expect(try await !store.sourceChanges(query:query,cursor:cursor,windowID:"fixture",now:now).hasNewEntries)
        for other in [event("other-account",account:"personal"),event("other-type",type:"message.received"),event("other-connector",connector:"imessage"),event("other-text",content:"Unrelated"),event("old-receipt",received:now.addingTimeInterval(-2))] {try await store.ingest(other)}
        #expect(try await !store.sourceChanges(query:query,cursor:cursor,windowID:"fixture",now:now).hasNewEntries)
        try await store.ingest(event("new-match"))
        for _ in 0..<8 {#expect(try await store.sourceChanges(query:query,cursor:cursor,windowID:"fixture",now:now).hasNewEntries)}
        #expect(try await store.fixtureSourceSessionCount()==1)
        let next=try await store.sourceList(query:query,cursor:page.nextCursor,limit:1,windowID:"fixture",now:now)
        #expect(next.total==2 && next.items.map(\.id)==["a"])
        await #expect(throws:Error.self){try await store.sourceChanges(query:SourceQuery(),cursor:cursor,windowID:"fixture",now:now)}
        await #expect(throws:Error.self){try await store.sourceChanges(query:query,cursor:cursor,windowID:"other",now:now)}
        await #expect(throws:Error.self){try await store.sourceChanges(query:query,cursor:cursor,windowID:"fixture",now:now.addingTimeInterval(601))}
        #expect(try await store.fixtureSourceSessionCount()==1)
    }
    @Test func existingStatusChangesAreNotArrivalsButNewMatchingFailuresAre()async throws {
        let store=try KnowledgeStore(path:":memory:")
        try await store.ingest(event("old"))
        let query=SourceQuery(states:["failed"]),page=try await store.sourceList(query:SourceQuery(states:["failed"]),now:now)
        let cursor=try #require(page.snapshotCursor)
        #expect(page.total==0 && page.nextCursor==nil)
        try await store.fixtureSourceFailed("old")
        #expect(try await !store.sourceChanges(query:query,cursor:cursor,now:now).hasNewEntries)
        try await store.ingest(event("new"))
        #expect(try await !store.sourceChanges(query:query,cursor:cursor,now:now).hasNewEntries)
        try await store.fixtureSourceFailed("new")
        #expect(try await store.sourceChanges(query:query,cursor:cursor,now:now).hasNewEntries)
    }
}

private extension KnowledgeStore {
    func fixtureSourceAttempt(_ id:String,stage:String,provider:String,model:String,at:Double)throws {
        try db.execute("INSERT INTO source_attempts(id,event_id,stage,started_at,provider,model) VALUES (?,?,?,?,?,?)",[UUID().uuidString,id,stage,String(at),provider,model])
    }
    func fixtureSourceBranches(_ id:String)throws {
        try db.execute("INSERT INTO fact_jobs(event_id,status,next_attempt_at) VALUES (?,'succeeded',0)",[id])
        try db.execute("INSERT INTO task_extraction_jobs(event_id,status) VALUES (?,'pending')",[id])
        try db.execute("INSERT INTO state_jobs(event_id,status) VALUES (?,'failed')",[id])
    }
    func fixtureSourceLink(_ id:String,document:String,block:String,state:String="active")throws {
        try db.execute("INSERT OR IGNORE INTO managed_documents(id,notebook_id,path,time_zone,json) VALUES (?,'fixture',?,'UTC','{}')",[document,document+".md"])
        try db.execute("INSERT INTO document_block_index VALUES (?,?,1,'fixture',?,?,'{}')",[block,document,state,id])
    }
    func fixtureSourceBatch(member:String,batch:String)throws {try db.execute("INSERT INTO home_batch_members(event_id,batch_id) VALUES (?,?)",[member,batch])}
    func fixtureSourceSessionCount()throws->Int {Int(try db.rows("SELECT COUNT(*) AS n FROM source_query_sessions").first!["n"]!)!}
    func fixtureSourceFailed(_ id:String)throws {try db.execute("UPDATE processing_jobs SET status='failed' WHERE event_id=?",[id])}
}
