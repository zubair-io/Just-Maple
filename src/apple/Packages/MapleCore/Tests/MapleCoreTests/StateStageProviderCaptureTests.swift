import Foundation
import Testing
@testable import MapleCore

extension KnowledgeStore {
    fileprivate func stateStageCaptureRows(_ sql:String)throws->[[String:String]] {try db.rows(sql)}
    fileprivate func stateStageCaptureExecute(_ sql:String)throws {try db.execute(sql)}
}
private struct StateStageRunner {
    let directory:URL
    var runner:URL {directory.appendingPathComponent("fixture.cjs")}
    var marker:URL {directory.appendingPathComponent("calls")}
    var client:ACPClient {ACPClient(provider:"codex",runner:runner)}
    init(response:String)throws {
        directory=FileManager.default.temporaryDirectory.appendingPathComponent("maple-state-stage-fixture-"+UUID().uuidString)
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        try setResponse(response)
    }
    func setResponse(_ response:String)throws {
        try """
        const fs=require('fs'),path=require('path');let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{
          JSON.parse(input);fs.appendFileSync(path.join(__dirname,'calls'),'1');
          process.stdout.write(JSON.stringify({ok:true,text:\(try JSONCodec.string(response))}));
        });
        """.write(to:runner,atomically:true,encoding:.utf8)
    }
    var calls:Int {(try? String(contentsOf:marker,encoding:.utf8).count) ?? 0}
    func cleanup() {try? FileManager.default.removeItem(at:directory)}
}
struct StateStageProviderCaptureTests {
    private func fixture(_ path:String)async throws->(KnowledgeStore,[String:Int],Event?) {
        if path=="state" {
            let store=try KnowledgeStore(path:":memory:")
            let event=Event(type:"source.updated",source:Source(connector:"notes",account:"synthetic",externalID:"state",revision:"1"),occurredAt:Date().addingTimeInterval(-30),subjects:["person:self"],content:"I am focusing on the synthetic project.")
            try await store.ingest(event)
            try await store.requestStateExtraction(eventID:event.id)
            return(store,[:],event)
        }
        let(store,items,_)=try await StageReconciliationTests().fixture()
        return(store,Dictionary(uniqueKeysWithValues:items.map{("source:"+$0.id,$0.version)}),nil)
    }
    private func run(_ path:String,store:KnowledgeStore,versions:[String:Int],event:Event?,client:ACPClient)async throws {
        if path=="state" {try await StateExtractionEngine(store:store,client:client).runOne(eventID:event?.id)}
        else {_ = try await StageReconciliationEngine(store:store,client:client).run(runID:"synthetic-stage",nodeVersions:versions)}
    }
    private func response(_ path:String)->String {
        path=="state" ? #"{"states":[{"property":"focus","value":"Focusing on the synthetic project","quote":"I am focusing on the synthetic project.","confidence":0.95}]}"# : #"{"duplicates":[],"progress":[]}"#
    }
    private func assertNotApplied(_ path:String,store:KnowledgeStore)async throws {
        if path=="state" {
            #expect(try await store.stateStageCaptureRows("SELECT id FROM world_states").isEmpty)
            #expect(try await store.stateStageCaptureRows("SELECT status FROM state_jobs").first?["status"] == "failed")
        } else {
            #expect(try await store.stageReconciliationResult(runID:"synthetic-stage") == nil)
            #expect(try await store.stateStageCaptureRows("SELECT status FROM stage_reconciliation_attempts").allSatisfy{$0["status"]=="failed"})
        }
    }

    @Test(arguments:["state","stage"]) func exactInputDispatchAndAtomicSuccess(_ path:String)async throws {
        let(store,versions,event)=try await fixture(path),runner=try StateStageRunner(response:response(path))
        defer {runner.cleanup()}
        try await run(path,store:store,versions:versions,event:event,client:runner.client)
        #expect(runner.calls==1)
        let rows=try await store.stateStageCaptureRows("SELECT * FROM provider_invocations"),row=try #require(rows.first)
        #expect(rows.count==1 && row["stage"] == (path=="state" ? "state":"stage_reconciliation"))
        #expect(row["context_sha256"]?.count==64)
        let capture=try JSONCodec.decode(ProviderDispatchCapture.self,from:Data(try #require(row["dispatch_json"]).utf8))
        #expect(capture.coverage == (path=="state" ? .complete:.partial))
        let immutable=try await store.stateStageCaptureRows("SELECT id,occurred_at FROM events")
        #expect(Set(capture.evidence.map(\.eventID))==Set(immutable.compactMap{$0["id"]}))
        #expect(capture.evidence.allSatisfy{$0.occurredAt != nil})
        let events=try await store.stateStageCaptureRows("SELECT * FROM provider_invocation_events ORDER BY sequence")
        #expect(events.compactMap{$0["kind"]}==["context","dispatch","response","validation","application"])
        #expect(events.last?["payload"] == (path=="state" ? "committed":"staged_result_recorded"))
        if path=="state" {
            #expect(try await store.stateStageCaptureRows("SELECT status FROM state_jobs").first?["status"]=="done")
            #expect(try await store.stateStageCaptureRows("SELECT id FROM world_states").count==1)
            #expect(try await store.stateStageCaptureRows("SELECT token FROM state_jobs").first?["token"]==nil)
            let sourceAttempts=try await store.stateStageCaptureRows("SELECT * FROM source_attempts WHERE stage='state'")
            #expect(sourceAttempts.count==2)
            #expect(sourceAttempts.allSatisfy{$0["ended_at"] != nil && $0["commit_outcome"]=="committed"})
            let parent=try #require(sourceAttempts.first{$0["id"]==row["attempt_id"]})
            let child=try #require(sourceAttempts.first{$0["id"]==row["id"]})
            #expect(parent["parent_id"]==nil && child["parent_id"]==parent["id"])
            #expect(child["transport_outcome"]=="response_received")
            #expect(try await store.stateStageCaptureRows("SELECT kind FROM source_artifacts WHERE stage='state' AND kind IN ('validation','application')").count==2)
            try await store.failStateJob(eventID:try #require(event?.id),token:try #require(row["attempt_id"]))
            #expect(try await store.stateStageCaptureRows("SELECT status FROM state_jobs").first?["status"]=="done")
        } else {
            let attempt=try #require(try await store.stateStageCaptureRows("SELECT * FROM stage_reconciliation_attempts").first)
            #expect(attempt["id"]==row["attempt_id"] && attempt["run_id"]==row["job_id"] && attempt["status"]=="staged_result_recorded")
            let saved=try #require(try await store.stageReconciliationResult(runID:"synthetic-stage"))
            try await store.failStageReconciliation(saved.job,attemptID:attempt["id"])
            #expect(try await store.stateStageCaptureRows("SELECT status FROM stage_reconciliation_runs").first?["status"]=="completed")
            #expect(try await store.stateStageCaptureRows("SELECT status FROM stage_reconciliation_attempts").first?["status"]=="staged_result_recorded")
        }
        try await run(path,store:store,versions:versions,event:event,client:runner.client)
        #expect(runner.calls==1) // Completed work, including the staged proof, is not redispatched.
    }

    @Test(arguments:["state","stage"]) func auditFailurePreventsProcessAndStorageFailuresDoNotRepair(_ path:String)async throws {
        for kind in ["context","dispatch","response","application"] {
            let(store,versions,event)=try await fixture(path),runner=try StateStageRunner(response:response(path))
            defer {runner.cleanup()}
            try await store.stateStageCaptureExecute("CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON provider_invocation_events WHEN NEW.kind='\(kind)' BEGIN SELECT RAISE(FAIL,'synthetic audit failure'); END")
            await #expect(throws:Error.self){try await run(path,store:store,versions:versions,event:event,client:runner.client)}
            #expect(runner.calls == (["context","dispatch"].contains(kind) ? 0:1))
            try await assertNotApplied(path,store:store)
            #expect(try await store.stateStageCaptureRows("SELECT sequence FROM provider_invocation_events WHERE kind='application'").isEmpty)
            if path=="state" {
                let attempts=try await store.stateStageCaptureRows("SELECT * FROM source_attempts WHERE stage='state'")
                #expect(attempts.allSatisfy{$0["ended_at"] != nil && $0["commit_outcome"]=="failed"})
            }
            if kind=="application" {
                // The validated-success audit rolls back with state/proof effects when application persistence fails.
                #expect(try await store.stateStageCaptureRows("SELECT sequence FROM provider_invocation_events WHERE kind='validation' AND payload='valid'").isEmpty)
            }
        }
    }

    @Test(arguments:["state","stage"]) func invalidOutputRetainsResponseAndExplicitRetryHasDistinctAttempt(_ path:String)async throws {
        let(store,versions,event)=try await fixture(path),runner=try StateStageRunner(response:"invalid synthetic JSON")
        defer {runner.cleanup()}
        await #expect(throws:Error.self){try await run(path,store:store,versions:versions,event:event,client:runner.client)}
        #expect(runner.calls==1)
        try await assertNotApplied(path,store:store)
        #expect(try await store.stateStageCaptureRows("SELECT payload FROM provider_invocation_events WHERE kind='response'").first?["payload"]=="invalid synthetic JSON")
        try runner.setResponse(response(path))
        if let event {try await store.requestStateExtraction(eventID:event.id)}
        try await run(path,store:store,versions:versions,event:event,client:runner.client)
        let attempts=try await store.stateStageCaptureRows("SELECT attempt_id,invocation_id FROM provider_invocations WHERE dispatch_json IS NOT NULL")
        #expect(runner.calls==2 && attempts.count==2)
        #expect(Set(attempts.compactMap{$0["attempt_id"]}).count==2)
        #expect(Set(attempts.compactMap{$0["invocation_id"]}).count==2)
    }
}
