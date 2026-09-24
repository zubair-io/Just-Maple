import Foundation
import Testing
@testable import MapleCore

struct LocalIntelligenceTests {
    func fixture(_ id:String,_ text:String="I accepted an offer.",at:Date=Date(),revision:String="1") -> Event {
        Event(type:"message.received",source:Source(connector:"gmail",account:"fixture",externalID:id,revision:revision),occurredAt:at,subjects:["person:self"],content:text)
    }
    @Test func vectorQueueIsAtomicAndIdempotent()async throws {
        let store=try KnowledgeStore(path:":memory:")
        let e=fixture("one")
        try await store.ingest(e);try await store.ingest(e)
        #expect(try await store.indexStatus().pending==1)
        try await store.saveVectors(eventID:e.id,vectors:[[1,0],[0,1]],model:"fixture")
        try await store.saveVectors(eventID:e.id,vectors:[[1,0]],model:"fixture")
        #expect(try await store.indexStatus().chunks==1)
        #expect(try await store.indexStatus().indexed==1)
    }
    @Test func similarityRespectsTimeAndLatestRevision()async throws {
        let store=try KnowledgeStore(path:":memory:"),now=Date()
        let old=fixture("same",at:now.addingTimeInterval(-100)),new=fixture("same","Updated",at:now,revision:"2"),future=fixture("future",at:now.addingTimeInterval(100))
        for e in [old,new,future] {try await store.ingest(e);try await store.saveVectors(eventID:e.id,vectors:[[1,0]],model:"fixture")}
        let matches=try await store.nearest([1,0],model:"fixture",limit:10,before:now)
        #expect(matches.map(\.id)==[new.id])
        let historical=try await store.nearest([1,0],model:"fixture",limit:10,before:now.addingTimeInterval(-50))
        #expect(historical.map(\.id)==[old.id])
    }
    @Test func localEmbeddingProducesRealFiniteVectors()throws {
        let vector=try LocalEmbedding.vector("The interview is scheduled for tomorrow.")
        #expect(vector.count>32)
        #expect(vector.allSatisfy {$0.isFinite})
        #expect(abs(vector.reduce(Float(0)){$0+$1*$1}-1)<0.001)
        #expect(LocalEmbedding.decode(LocalEmbedding.encode(vector))==vector)
        #expect(LocalEmbedding.chunks(Array(repeating:"word",count:1000).joined(separator:" ")).count>1)
    }
    @Test func stateCommitRequiresGroundingAndLeaseAndExpires()async throws {
        let store=try KnowledgeStore(path:":memory:"),now=Date()
        let e=fixture("state","I am home.",at:now.addingTimeInterval(-1800))
        try await store.ingest(e)
        try await store.seedStateFixture(e.id)
        let (_,token)=try #require(await store.acquireStateJob(at:now))
        let bad="{\"states\":[{\"property\":\"presence\",\"value\":\"Home\",\"quote\":\"not in source\",\"confidence\":0.95}]}"
        await #expect(throws:(any Error).self) {try await store.finishStateJob(eventID:e.id,token:token,response:bad,provider:"fixture",at:now)}
        #expect(try await store.stateClaims().isEmpty)
        let good="{\"states\":[{\"property\":\"presence\",\"value\":\"Home\",\"quote\":\"I am home.\",\"confidence\":0.95}]}"
        try await store.finishStateJob(eventID:e.id,token:token,response:good,provider:"fixture",at:now)
        await #expect(throws:(any Error).self) {try await store.finishStateJob(eventID:e.id,token:token,response:good,provider:"fixture",at:now)}
        #expect(try await store.stateClaims().count==1)
        #expect(try await store.worldStates(at:now).first{$0.property=="presence"}?.status=="stale")
    }
    @Test func reprocessingReplacesDerivedClaimsWithoutDeletingEvidence()async throws {
        let store=try KnowledgeStore(path:":memory:"),e=fixture("reprocess")
        try await store.ingest(e);try await store.requestStateExtraction(eventID:e.id)
        let (_,token)=try #require(await store.acquireStateJob())
        let response="{\"states\":[{\"property\":\"employment\",\"value\":\"Offer accepted\",\"quote\":\"I accepted an offer.\",\"confidence\":0.95}]}"
        try await store.finishStateJob(eventID:e.id,token:token,response:response,provider:"fixture")
        try await store.requestStateExtraction(eventID:e.id)
        let (_,replacement)=try #require(await store.acquireStateJob())
        try await store.finishStateJob(eventID:e.id,token:replacement,response:"{\"states\":[]}",provider:"fixture")
        #expect(try await store.stateClaims().first?.retracted == true)
        #expect(try await store.event(e.id) != nil)
        #expect(try await store.indexStatus().stateCompleted == 1)
    }
    @Test func migrationBackfillsAndRestartKeepsVectors()async throws {
        let path=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString+".sqlite").path
        defer {try? FileManager.default.removeItem(atPath:path)}
        let e=fixture("persist")
        do {
            let store=try KnowledgeStore(path:path)
            try await store.ingest(e)
            try await store.saveVectors(eventID:e.id,vectors:[[1,0]],model:"fixture")
        }
        let reopened=try KnowledgeStore(path:path)
        #expect(try await reopened.indexStatus().indexed == 1)
        #expect(try await reopened.nearest([1,0],model:"fixture",limit:1,before:Date()).first?.id == e.id)
    }
    @Test func stateLeaseRecoveryRejectsLateWorker()async throws {
        let store=try KnowledgeStore(path:":memory:"),now=Date(),e=fixture("lease")
        try await store.ingest(e);try await store.seedStateFixture(e.id)
        let (_,first)=try #require(await store.acquireStateJob(at:now))
        let (_,second)=try #require(await store.acquireStateJob(at:now.addingTimeInterval(301)))
        #expect(first != second)
        await #expect(throws:(any Error).self) {try await store.finishStateJob(eventID:e.id,token:first,response:"{\"states\":[]}",provider:"fixture",at:now.addingTimeInterval(302))}
        try await store.finishStateJob(eventID:e.id,token:second,response:"{\"states\":[]}",provider:"fixture",at:now.addingTimeInterval(302))
    }
}
extension KnowledgeStore {
    func seedStateFixture(_ id:String)throws {try db.execute("INSERT INTO state_jobs(event_id) VALUES (?)",[id])}
}
