import Foundation
import Testing
@testable import MapleCore

struct SourcesTests {
    let now=Date()
    func source(_ id:String,connector:String="gmail",account:String="one",type:String="mail.received",revision:String="1",externalID:String?=nil,content:String="Sender: Fixture\nSubject: Test fixture\nBody:\nPlease review the fixture.")->Event {Event(id:id,type:type,source:Source(connector:connector,account:account,externalID:externalID ?? id,revision:revision),occurredAt:now,receivedAt:now,subjects:["person:self"],content:content)}
    @Test func filtersCombineAndSnapshotSurvivesStatusChangesAndIngestion()async throws {
        let store=try KnowledgeStore(path:":memory:")
        for id in ["a","b","c"] {try await store.ingest(source(id))}
        try await store.ingest(source("different-account",account:"two"))
        try await store.ingest(source("different-type",type:"calendar.updated"))
        try await store.ingest(source("different-connector",connector:"imessage"))
        let query=SourceQuery(types:["mail.received"],connectors:["gmail"],accounts:["one"],states:["pending"],receivedAfter:now.addingTimeInterval(-1),receivedBefore:now.addingTimeInterval(1),text:"fixture")
        let first=try await store.sourceList(query:query,limit:1,now:now)
        #expect(first.total==3 && first.items.map(\.id)==["c"])
        try await store.sourceFixtureStatus("b",stage:"classification",status:"succeeded")
        try await store.ingest(source("z"))
        let second=try await store.sourceList(query:query,cursor:first.nextCursor,limit:2,now:now)
        #expect(second.total==3 && second.items.map(\.id)==["b","a"] && second.items.allSatisfy{$0.status=="pending"})
        #expect(try await store.sourceDetail(eventID:"b").row.status=="complete")
        #expect(try await store.sourceList(query:query,now:now).total==3)
        await #expect(throws:Error.self){try await store.sourceList(query:SourceQuery(connectors:["gmail"]),cursor:first.nextCursor,now:now)}
        await #expect(throws:Error.self){try await store.sourceList(query:query,cursor:first.nextCursor,now:now.addingTimeInterval(601))}
    }
    @Test func querySessionsAreWindowBoundedAndSearchIsLiteral()async throws {
        let store=try KnowledgeStore(path:":memory:");try await store.ingest(source("a"));try await store.ingest(source("b"))
        let first=try await store.sourceList(limit:1,now:now)
        for i in 1...4 {_ = try await store.sourceList(limit:1,now:now.addingTimeInterval(Double(i)))}
        await #expect(throws:Error.self){try await store.sourceList(cursor:first.nextCursor,now:now.addingTimeInterval(5))}
        #expect(try await store.sourceList(query:SourceQuery(text:"fixture OR not-a-match"),now:now).total==0)
        await #expect(throws:Error.self){try await store.sourceList(query:SourceQuery(states:["made-up"]))}
        await #expect(throws:Error.self){try await store.sourceList(limit:101)}
    }
    @Test func immutableRevisionsAndObservedStateStaySeparate()async throws {
        let store=try KnowledgeStore(path:":memory:")
        try await store.ingest(source("ha1",connector:"home_assistant",type:"state.changed",externalID:"door",content:"Home Assistant entity: door\nName: Door\nState: open\nAttributes: {}"))
        try await store.ingest(source("ha2",connector:"home_assistant",type:"state.changed",revision:"2",externalID:"door",content:"Home Assistant entity: door\nName: Door\nState: closed\nAttributes: {}"))
        let first=try await store.sourceDetail(eventID:"ha1")
        #expect(first.row.observedState=="open" && first.row.status=="pending" && Set(first.relatedRevisions)==["ha1","ha2"])
        await #expect(throws:Error.self){try await store.ingest(source("ha3",connector:"home_assistant",type:"state.changed",externalID:"door",content:"Changed immutable bytes"))}
    }
    @Test func retryIsIdempotentAndRetainsAttemptsAndFailureDominatesIndependentBranches()async throws {
        let store=try KnowledgeStore(path:":memory:");try await store.ingest(source("a"))
        let lease=try #require(await store.acquire(now:now))
        try await store.fail(lease,error:"Safe fixture failure",now:now)
        let old=try await store.sourceDetail(eventID:"a")
        #expect(old.attempts.count==1 && old.attempts[0].commitOutcome=="failed")
        let result=try await store.sourceRetry(commandID:"retry-fixture",eventID:"a",stage:"classification",expectedVersion:old.row.stateVersion,now:now)
        #expect(result.stateVersion>old.row.stateVersion)
        #expect(try await store.sourceRetry(commandID:"retry-fixture",eventID:"a",stage:"classification",expectedVersion:old.row.stateVersion,now:now).stateVersion==result.stateVersion)
        await #expect(throws:Error.self){try await store.sourceRetry(commandID:"retry-fixture",eventID:"a",stage:"facts",expectedVersion:old.row.stateVersion,now:now)}
        try await store.sourceFixtureStatus("a",stage:"classification",status:"succeeded")
        try await store.sourceFixtureStatus("a",stage:"state",status:"failed")
        #expect(try await store.sourceDetail(eventID:"a").row.status=="failed")
        #expect(try await store.sourceDetail(eventID:"a").row.analysisState=="failed")
        let history=try await store.sourceHistory(eventID:"a",limit:2)
        #expect(history.items.count==2 && history.nextSequence != nil)
        let earlier=try await store.sourceHistory(eventID:"a",beforeSequence:history.nextSequence,limit:100)
        #expect(Set(history.items.map(\.sequence)).isDisjoint(with:Set(earlier.items.map(\.sequence))))
    }
    @Test func leaseRecoveryKeepsUnknownOutcomeAndArtifactsArePrivateAndPaged()async throws {
        let store=try KnowledgeStore(path:":memory:");try await store.ingest(source("a"));try await store.ingest(source("b"))
        let first=try #require(await store.acquire(now:now,duration:1,eventIDs:["a"]))
        let second=try #require(await store.acquire(now:now.addingTimeInterval(2),eventIDs:["a"]))
        #expect(first.token != second.token)
        try await store.recordProviderAudit(.init(invocationID:"fixture-call",provider:"fixture",model:"test",kind:"context",payload:"Exact fixture request"),eventID:"a",leaseID:second.token,stage:"classification")
        try await store.recordProviderAudit(.init(invocationID:"fixture-call",provider:"fixture",model:"test",kind:"response",payload:"ab🙂cd"),eventID:"a",leaseID:second.token,stage:"classification")
        let detail=try await store.sourceDetail(eventID:"a")
        #expect(detail.attempts.first{$0.id==first.token}?.transportOutcome=="unknown")
        #expect(detail.attempts.first{$0.id==first.token}?.commitOutcome=="interrupted_or_discarded")
        let artifact=try #require(detail.artifacts.first{$0.kind=="response"})
        let page=try await store.sourceArtifact(eventID:"a",artifactID:artifact.id,limit:5)
        #expect(page.content=="ab" && page.nextOffset==2 && !page.complete)
        #expect(try await store.sourceArtifact(eventID:"a",artifactID:artifact.id,offset:2,limit:6).content=="🙂cd")
        #expect(try await store.sourceArtifact(eventID:"b",artifactID:artifact.id).availability=="not_recorded")
        await #expect(throws:Error.self){try await store.sourceArtifact(eventID:"a",artifactID:artifact.id,offset:3)}
    }
    @Test func auditRollbackAndSkipHistoryAreAtomic()async throws {
        let store=try KnowledgeStore(path:":memory:");try await store.ingest(source("a"))
        let before=try await store.sourceHistory(eventID:"a").items.count
        await #expect(throws:Error.self){try await store.sourceFixtureRollback("a")}
        #expect(try await store.sourceHistory(eventID:"a").items.count==before)
        #expect(try await store.sourceDetail(eventID:"a").row.status=="pending")
        try await store.excludeExpiredAIWork(at:now.addingTimeInterval(AIProcessingWindow.duration+1))
        #expect(try await store.sourceDetail(eventID:"a").row.status=="skipped")
        #expect(try await store.sourceHistory(eventID:"a").items.first?.reason=="outside_window")
    }
}
private extension KnowledgeStore {
    func sourceFixtureStatus(_ id:String,stage:String,status:String)throws {
        if stage=="state" {try db.execute("INSERT INTO state_jobs(event_id,status) VALUES (?,?) ON CONFLICT(event_id) DO UPDATE SET status=excluded.status",[id,status])}
        else {try db.execute("UPDATE processing_jobs SET status=? WHERE event_id=?",[status,id])}
    }
    func sourceFixtureRollback(_ id:String)throws {try db.transaction {try db.execute("UPDATE processing_jobs SET status='blocked' WHERE event_id=?",[id]);throw MapleError.invalid("Injected rollback")}}
}

extension SourcesTests {
    @Test(.enabled(if: ProcessInfo.processInfo.environment["MAPLE_SOURCES_PERF"] == "1"))
    func tenThousandSourceWarmFirstPageP95()async throws {
        let directory=FileManager.default.temporaryDirectory.appendingPathComponent("maple-sources-perf-"+UUID().uuidString)
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        defer {try? FileManager.default.removeItem(at:directory)}
        let store=try KnowledgeStore(path:directory.appendingPathComponent("fixture.sqlite").path)
        try await store.sourcePerformanceFixtures(count:10000,at:now)
        for _ in 0..<3 {_ = try await store.sourceList()}
        var samples=[Double]()
        for _ in 0..<20 {
            let start=ContinuousClock.now
            let page=try await store.sourceList()
            let elapsed=start.duration(to:.now),parts=elapsed.components
            samples.append(Double(parts.seconds)*1000+Double(parts.attoseconds)/1e15)
            #expect(page.items.count==60 && page.total==10000)
        }
        let sorted=samples.sorted(),p95=sorted[Int(ceil(Double(samples.count)*0.95))-1]
        print("SOURCES_PERFORMANCE fixture=file-backed_10000_events debug=true warmups=3 samples_ms=\(samples) p95_ms=\(p95)")
        #expect(p95<200,"Warm first-page p95 must remain below 200ms for 10k events.")
    }
    @Test func manualFactCheckCapturesActualAttemptAndFailureHistory()async throws {
        let store=try KnowledgeStore(path:":memory:");try await store.ingest(source("a",connector:"notes",type:"note.updated"))
        let classifier=try TypeSafeClassifier(apiKey:"fixture-secret",transport:CapturingTransport(data:try TypeSafeTests().payload()))
        _ = try await store.checkSourceFacts(eventID:"a",classifier:classifier)
        let detail=try await store.sourceDetail(eventID:"a")
        #expect(detail.attempts.contains{$0.stage=="fact_check" && $0.commitOutcome=="committed"})
        #expect(detail.artifacts.contains{$0.stage=="fact_check" && $0.kind=="response"})
        let failed=try TypeSafeClassifier(apiKey:"fixture-secret",transport:CapturingTransport(data:Data("private-error-body".utf8),status:401))
        await #expect(throws:Error.self){try await store.checkSourceFacts(eventID:"a",classifier:failed)}
        let history=try await store.sourceHistory(eventID:"a")
        #expect(history.items.contains{$0.stage=="fact_check" && $0.toState=="failed"})
        #expect(history.items.contains{$0.stage=="fact_check" && $0.toState=="succeeded"})
        for artifact in try await store.sourceDetail(eventID:"a").artifacts {
            let page=try await store.sourceArtifact(eventID:"a",artifactID:artifact.id)
            #expect(!page.content.contains("private-error-body") && !page.content.contains("fixture-secret"))
        }
    }
}
private extension KnowledgeStore {
    func sourcePerformanceFixtures(count:Int,at:Date)throws {
        try db.transaction {
            for i in 0..<count {
                let connector=["gmail","imessage","home_assistant"][i%3]
                let event=Event(id:"performance-fixture-\(i)",type:["mail.received","message.received","state.changed"][i%3],source:Source(connector:connector,account:"fixture-\(i%4)",externalID:"fixture-\(i)",revision:"1"),occurredAt:at.addingTimeInterval(Double(-i)),receivedAt:at.addingTimeInterval(Double(-i)),subjects:["person:self"],content:"Sender: Synthetic fixture\nSubject: Performance fixture \(i)\nBody:\n"+String(repeating:"This is labeled synthetic source content for database performance verification. ",count:20))
                try event.validate();_ = try insert(event,enqueue:true)
            }
        }
    }
}

extension SourcesTests {
    @Test func legacyOutputRemainsInspectableWithoutInventedAttempts()async throws {
        let store=try KnowledgeStore(path:":memory:");try await store.ingest(source("legacy",connector:"notes"))
        try await store.sourceLegacyFixture("legacy")
        let detail=try await store.sourceDetail(eventID:"legacy")
        #expect(detail.historyAvailability=="legacy_latest_only_before_audit" && detail.attempts.isEmpty)
        #expect(try await store.sourceHistory(eventID:"legacy").items.isEmpty)
        let output=try #require(detail.artifacts.first{$0.id=="legacy:state:response"})
        #expect(output.legacy)
        #expect(try await store.sourceArtifact(eventID:"legacy",artifactID:output.id).content=="{\"states\":[]}")
    }
    @Test func coalescedTransitionLinksExactRepresentativeAndStaleRetryIsRejected()async throws {
        let store=try KnowledgeStore(path:":memory:");try await store.ingest(source("older"));try await store.ingest(source("representative"))
        let initial=try await store.sourceDetail(eventID:"older")
        try await store.sourceCoalescedFixture("older",representative:"representative")
        let history=try await store.sourceHistory(eventID:"older")
        #expect(history.items.first?.relatedEventID=="representative")
        #expect(try await store.sourceDetail(eventID:"older").stages.first?.relatedEventID=="representative")
        await #expect(throws:Error.self){try await store.sourceRetry(commandID:"stale",eventID:"older",stage:"classification",expectedVersion:initial.row.stateVersion)}
    }
}
private extension KnowledgeStore {
    func sourceLegacyFixture(_ id:String)throws {
        try db.execute("UPDATE processing_jobs SET status='succeeded' WHERE event_id=?",[id])
        try db.execute("INSERT INTO state_jobs(event_id,status,response) VALUES (?,'done','{\"states\":[]}')",[id])
        // Simulate records created by the pre-audit app; no historical timing is fabricated.
        try db.execute("DELETE FROM source_transitions WHERE event_id=?",[id])
    }
    func sourceCoalescedFixture(_ id:String,representative:String)throws {
        try db.execute("UPDATE processing_jobs SET status='coalesced',error=? WHERE event_id=?",["Indexed locally; cumulative energy increment superseded by observation "+representative,id])
    }
}

extension SourcesTests {
    @Test func homeBatchMembersTrackParentWithoutClaimingSeparateClassification()async throws {
        let store=try KnowledgeStore(path:":memory:")
        try await store.ingest(source("fixture-home-member",connector:"home_assistant",type:"home.state",content:"State: open\nSynthetic home fixture"))
        try await store.ingest(source("fixture-home-batch",connector:"home_assistant",type:"home.batch"))
        try await store.sourceHomeBatchFixture(member:"fixture-home-member",parent:"fixture-home-batch")
        for (processing,aggregate,inbox) in [("pending","pending","indexed"),("failed","failed","failed"),("succeeded","complete","processed")] {
            try await store.sourceFixtureStatus("fixture-home-batch",stage:"classification",status:processing)
            let page=try await store.sourceList(query:SourceQuery(types:["home.state"],states:[aggregate]))
            #expect(page.items.count==1 && page.items[0].classificationState=="batched")
            let detail=try await store.sourceDetail(eventID:"fixture-home-member")
            #expect(detail.row.status==aggregate && detail.row.observedState=="open")
            let stage=try #require(detail.stages.first{$0.stage=="classification"})
            #expect(stage.state=="batched" && stage.relatedEventID=="fixture-home-batch" && stage.attemptID==nil)
            #expect(detail.attempts.isEmpty && detail.artifacts.allSatisfy{$0.stage=="source"})
            let history=try #require(await store.historyInboxPage().items.first{$0.id=="fixture-home-member"})
            #expect(history.status==inbox && history.statusDetail.contains("batch"))
            await #expect(throws:Error.self) {try await store.sourceRetry(commandID:"member-retry-"+processing,eventID:"fixture-home-member",stage:"classification",expectedVersion:detail.row.stateVersion)}
        }
        try await store.sourceFixtureStatus("fixture-home-batch",stage:"state",status:"failed")
        #expect(try await store.sourceDetail(eventID:"fixture-home-member").row.status=="failed")
        #expect(try await store.sourceDetail(eventID:"fixture-home-member").row.analysisState=="failed")
        #expect(try await store.sourceList(query:SourceQuery(types:["home.state"],states:["failed"])).total==1)
    }
}
private extension KnowledgeStore {
    func sourceHomeBatchFixture(member:String,parent:String)throws {
        try db.execute("INSERT INTO home_batch_members(event_id,batch_id) VALUES (?,?)",[member,parent])
        try db.execute("UPDATE processing_jobs SET status='batched',error=NULL WHERE event_id=?",[member])
        try db.execute("UPDATE source_transitions SET related_event_id=?,reason='Classified together in one Home Assistant batch.' WHERE event_id=? AND to_state='batched'",[parent,member])
    }
}
