import Foundation
import Testing
@testable import MapleCore

struct QueryPerformanceTests {
    @Test func latestIdentityUsesEntityIndexAndRespectsEqualTimestampRevisionsAndAccounts()async throws {
        let store=try KnowledgeStore(path:":memory:"),now=Date()
        for (id,account,revision,sender) in [("old","one","1","old@example.invalid"),("latest","one","2","latest@example.invalid"),("other-account","two","1","other@example.invalid")] {
            let alias="person:email:"+ConnectorSourceRecord.identifier(sender)
            try await store.ingest(Event(id:id,type:"message.received",source:Source(connector:"gmail",account:account,externalID:"same",revision:revision),occurredAt:now,receivedAt:now,subjects:[alias],content:"Sender: \(sender)\nDirection: incoming\nBody:\nSynthetic fixture."))
        }
        let identities=try await store.personIdentities(now:now)
        #expect(Set(identities.flatMap(\.evidenceEventIDs))==["latest","other-account"])
        let plans=try await store.queryPerformancePlans()
        #expect(plans.contains{$0.contains("events_entity_received") && $0.contains("external_id=?")})
        #expect(!plans.contains{$0.contains("MULTI-INDEX OR")})
    }
    @Test func batchedNearestRanksEligibleSourcesBeforeLimitingAndKeepsTemporalRevisionSemantics()async throws {
        let store=try KnowledgeStore(path:":memory:"),now=Date()
        let fixtures:[(String,String,String,Double,String,[Float])]=[
            ("ha","home_assistant","ha",-2,"1",[1,0]),
            ("old","gmail","same",-100,"1",[1,0]),
            ("latest","gmail","same",-10,"2",[0.7,0.7]),
            ("second","imessage","second",-5,"1",[0,1]),
            ("future","gmail","future",10,"1",[1,0])]
        for (id,connector,external,age,revision,vector) in fixtures {
            try await store.ingest(Event(id:id,type:"source.updated",source:Source(connector:connector,account:"fixture",externalID:external,revision:revision),occurredAt:now.addingTimeInterval(age),receivedAt:now.addingTimeInterval(age),subjects:["person:self"],content:"Synthetic \(id)"))
            try await store.saveVectors(eventID:id,vectors:[vector],model:"fixture")
        }
        let matches=try await store.nearestBatch([[1,0],[0,1]],model:"fixture",limit:1,before:now,after:[now.addingTimeInterval(-20),now.addingTimeInterval(-7)],connectors:["gmail","imessage"])
        #expect(matches.map{$0.map(\.id)}==[["latest"],["second"]])
        let historical=try await store.nearestBatch([[1,0]],model:"fixture",limit:1,before:now.addingTimeInterval(-50),connectors:["gmail"])
        #expect(historical[0].map(\.id)==["old"])
        let singles=try await [[Float(1),0],[0,1]].asyncFixtureMap{try await store.nearest($0,model:"fixture",limit:3,before:now)}
        let all=try await store.nearestBatch([[1,0],[0,1]],model:"fixture",limit:3,before:now)
        #expect(all.map{$0.map(\.id)}==singles.map{$0.map(\.id)})
    }
    @Test func filteredStatePreservesExplicitCorrectionPriorityAndEmptySelection()async throws {
        let store=try KnowledgeStore(path:":memory:")
        _ = try await store.correct(subject:"person:self",predicate:"person.name",value:"Fixture self")
        _ = try await store.correct(subject:"person:other",predicate:"person.name",value:"Fixture other")
        #expect(try await store.state(subjects:[]).isEmpty)
        let all=try await store.state(),filtered=try await store.state(subjects:["person:self","person:self"])
        #expect(filtered==all.filter{$0.subject=="person:self"})
        let many=(0..<600).map{"person:fixture-\($0)"}+["person:self"]
        #expect(try await store.state(subjects:many)==filtered)
    }
    /// Explicitly opt in with a private *copy*, never the user's live database.
    @Test(.enabled(if:ProcessInfo.processInfo.environment["MAPLE_QUERY_COPY_DB"] != nil))
    func copiedCorpusReadPerformance()async throws {
        let path=try #require(ProcessInfo.processInfo.environment["MAPLE_QUERY_COPY_DB"])
        guard path.hasPrefix(FileManager.default.temporaryDirectory.path),path.contains("maple-query-copy-") else {throw MapleError.invalid("Benchmark requires an isolated temporary database copy.")}
        let store=try KnowledgeStore(path:path)
        let start=ContinuousClock.now
        let people=try await store.people()
        let peopleTime=start.duration(to:.now)
        let selfStart=ContinuousClock.now
        let state=try await store.state(subjects:["person:self"])
        let stateTime=selfStart.duration(to:.now)
        let semanticStart=ContinuousClock.now
        let semantic=try await store.semanticSearch("schedule meeting",limit:6)
        let semanticTime=semanticStart.duration(to:.now)
        let reconcileStart=ContinuousClock.now
        let input=try await store.reconciliationInput(at:Date())
        let reconcileTime=reconcileStart.duration(to:.now)
        print("COPIED_CORPUS_PERFORMANCE people_count=\(people.count) people=\(peopleTime) self_claim_count=\(state.count) self_state=\(stateTime) semantic_results=\(semantic.count) generic_semantic=\(semanticTime) reconciliation_nodes=\(input.nodes.count) reconciliation_sources=\(input.sources.count) reconciliation=\(reconcileTime)")
    }
}
private extension KnowledgeStore {
    func queryPerformancePlans()throws->[String] {try db.rows("EXPLAIN QUERY PLAN SELECT e.id FROM events e WHERE e.connector='gmail' AND \(Self.currentIdentityRevisionSQL)").compactMap{$0["detail"]}}
}
private extension Array where Element==[Float] {
    func asyncFixtureMap<T>(_ transform:(Element)async throws->T)async rethrows->[T] {var values=[T]();for value in self {values.append(try await transform(value))};return values}
}
