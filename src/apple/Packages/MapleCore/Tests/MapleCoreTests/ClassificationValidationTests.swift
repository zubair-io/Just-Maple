import Foundation
import Testing
@testable import MapleCore

struct ClassificationValidationTests {
    @Test func lightweightSnapshotMatchesFullContextIncludingPrefixAndProvenanceAge() async throws {
        let store = try KnowledgeStore(path: ":memory:"), now = Date()
        let current = Event(type:"note.updated",source:Source(connector:"notes",account:"fixture",externalID:"current",revision:"1"),occurredAt:now,subjects:["person:self"],content:"Synthetic context fixture.")
        let old = Event(type:"note.updated",source:Source(connector:"notes",account:"fixture",externalID:"old",revision:"1"),occurredAt:now.addingTimeInterval(-31*86400),subjects:["person:self"],content:"Synthetic historical evidence.")
        for event in [current,old] {try await store.ingest(event)}
        try await store.seedValidationFixtures(current:current,old:old,now:now)
        let full = try await store.modelContext(for:current.id,at:now)
        let light = try await store.classificationValidationSnapshot(for:current.id,at:now)
        #expect(light.currentState == full.currentState)
        #expect(light.sourceFacts == full.sourceFacts)
        #expect(light.currentState.count == 16)
        #expect(light.sourceFacts.count == 6)
        let lease = try #require(await store.acquire(now:now.addingTimeInterval(1),eventIDs:[current.id]))
        let assessment = Assessment(notify:0,askUser:0,reason:0,summarize:0,jobStage:.unchanged,stageConfidence:1,model:"fixture",provider:"fixture")
        let decision = Policy.decide(context:full,assessment:assessment)
        #expect(try await store.finish(lease,decision:decision,raw:Data(),now:now.addingTimeInterval(1)))
        #expect(try await !store.finish(lease,decision:decision,raw:Data(),now:now.addingTimeInterval(1)))
        #expect(try await store.decisions().count == 1)
    }
    @Test func homeHistoryUsesEntityScopeWhileExplicitSelfClaimsRemain() async throws {
        let store = try KnowledgeStore(path: ":memory:"), now = Date()
        func fixture(_ id:String,_ subject:String,_ offset:Double)->Event {
            Event(type:"home.state",source:Source(connector:"home_assistant",account:"fixture",externalID:id,revision:"1"),occurredAt:now.addingTimeInterval(offset),subjects:["person:self",subject],content:"Synthetic sensor state evidence.")
        }
        let current=fixture("current","home:one",0),related=fixture("related","home:one",-1),other=fixture("other","home:two",-2)
        for event in [current,related,other] {try await store.ingest(event);try await store.saveVectors(eventID:event.id,vectors:[LocalEmbedding.vector(current.content)],model:LocalEmbedding.model)}
        let claim=try await store.correct(subject:"person:self",predicate:"availability",value:"Fixture busy")
        let context=try await store.modelContext(for:current.id,at:now.addingTimeInterval(1))
        #expect(context.recentEvents.map(\.id) == [related.id])
        #expect(context.relatedEvidence.contains { $0.id == related.id })
        #expect(!context.relatedEvidence.contains { $0.id == other.id })
        #expect(context.currentState.contains { $0.id == claim.id })
        #expect(context.relatedEvidence.contains { $0.id == claim.evidenceEventID })
    }
}
private extension KnowledgeStore {
    func seedValidationFixtures(current:Event,old:Event,now:Date)throws {
        for i in 0..<30 {
            try insertClaim(Claim(id:"claim-\(i)",subject:"person:self",predicate:String(format:"property-%02d",i),value:"fixture",evidenceEventID:i%3==0 ? old.id:current.id,observedAt:now,confidence:1,origin:"inference"))
            let fact=SourceFact(id:"fact-\(i)",subject:"person:self",predicate:"fixture",value:"fixture",sourceQuote:"Synthetic",eventID:i%2==0 ? old.id:current.id,provider:"fixture",model:"fixture",extractedAt:now)
            try db.execute("INSERT INTO source_facts VALUES (?,?,?,?)",[fact.id,fact.eventID,fact.subject,try JSONCodec.string(fact)])
        }
    }
}
