import Foundation
import Testing
@testable import MapleCore
struct AIWindowTests {
    func event(_ id:String,at:Date)->Event {
        Event(type:"message.received",source:Source(connector:"gmail",account:"fixture",externalID:id,revision:"1"),occurredAt:at,receivedAt:Date(),subjects:["person:self","thread:gmail:shared"],content:"Window fixture interview availability \(id)")
    }
    @Test func boundaryUsesOriginalDateNotImportTime()throws {
        let now=Date(),cutoff=now.addingTimeInterval(-AIProcessingWindow.duration)
        try AIProcessingWindow.require(event("boundary",at:cutoff),at:now)
        #expect(throws:(any Error).self) {try AIProcessingWindow.require(event("old",at:cutoff.addingTimeInterval(-0.001)),at:now)}
    }
    @Test func allQueuesSkipOldEvidenceButIndexAndSearchRetainIt()async throws {
        let store=try KnowledgeStore(path:":memory:"),now=Date(),old=event("old",at:Date().addingTimeInterval(-31*86400)),fresh=event("fresh",at:Date())
        for e in [old,fresh] {
            try await store.ingest(e)
            try await store.recordFactCheck(eventID:e.id,probability:1,provider:"fixture",model:"fixture")
            try await store.requestTaskExtraction(eventID:e.id)
            try await store.requestStateExtraction(eventID:e.id)
        }
        #expect(try await store.acquire(now:now.addingTimeInterval(1))?.eventID == fresh.id)
        #expect(try await store.acquireFacts(now:now.addingTimeInterval(1))?.eventID == fresh.id)
        #expect(try await store.acquireTaskExtraction(at:now.addingTimeInterval(1))?.0.id == fresh.id)
        #expect(try await store.acquireStateJob(at:now.addingTimeInterval(1))?.0.id == fresh.id)
        #expect(try await store.queue().first{$0.eventID==old.id}?.status == "outside_window")
        #expect(try await store.factQueue().first{$0.eventID==old.id}?.status == "outside_window")
        #expect(try await store.taskExtractionQueue().first{$0.eventID==old.id}?.status == "outside_window")
        #expect(try await store.indexStatus().pending == 2)
        #expect(try await store.search("Window fixture").count == 2)
        try await store.saveVectors(eventID:old.id,vectors:[[1,0]],model:"fixture")
        #expect(try await store.nearest([1,0],model:"fixture",limit:1,before:now).first?.id == old.id)
        try await store.requestStateExtraction(eventID:old.id)
        #expect(try await store.acquireStateJob(eventID:old.id) == nil)
    }
    @Test func oldSourceCannotReachJevOrACP()async throws {
        let old=event("old",at:Date().addingTimeInterval(-31*86400))
        let context=Context(event:old,currentState:[],recentEvents:[],relatedEvidence:[],version:"fixture")
        let transport=CapturingTransport(data:Data())
        let jev=try TypeSafeClassifier(apiKey:"fixture",transport:transport)
        await #expect(throws:(any Error).self) {try await jev.classify(context)}
        await #expect(throws:(any Error).self) {try await jev.checkFacts(context)}
        #expect(await transport.request == nil)
        let ai=ACPExtractor(client:ACPClient(provider:"codex",runner:URL(fileURLWithPath:"/must-not-run")))
        await #expect(throws:(any Error).self) {try await ai.extract(old)}
        await #expect(throws:(any Error).self) {try await ai.extract(old,activities:[])}
    }
    @Test func recentEventDoesNotCarryOldEvidenceOrFreshlyExtractedOldFacts()async throws {
        let store=try KnowledgeStore(path:":memory:"),now=Date(),old=event("old",at:Date().addingTimeInterval(-31*86400)),fresh=event("fresh",at:Date())
        try await store.ingest(old);try await store.ingest(fresh)
        try await store.seedWindowFact(old)
        let raw=try await store.context(for:fresh.id)
        #expect(raw.sourceFacts?.count == 1)
        let context=try await store.modelContext(for:fresh.id,at:now)
        #expect(context.sourceFacts?.isEmpty == true)
        #expect(context.recentEvents.allSatisfy{$0.id != old.id})
        #expect(context.relatedEvidence.allSatisfy{$0.id != old.id})
    }
}
extension KnowledgeStore {
    func seedWindowFact(_ event:Event)throws {
        let fact=SourceFact(id:"fixture-fact",subject:"person:self",predicate:"plan",value:"Older assertion",sourceQuote:event.content,eventID:event.id,provider:"fixture",model:"fixture",extractedAt:Date())
        try db.execute("INSERT INTO source_facts VALUES (?,?,?,?)",[fact.id,event.id,fact.subject,try JSONCodec.string(fact)])
    }
}
