import Foundation
import Testing
@testable import MapleCore

/// Synthetic subprocess fixtures assert that durable dispatch/context capture precedes
/// the provider boundary. No model, inbox or user database is contacted.
struct PipelineProviderCaptureTests {
    func fixture(mode:String) throws -> (URL,URL,URL) {
        let dir=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true)
        let database=dir.appendingPathComponent("fixture.sqlite"),runner=dir.appendingPathComponent("runner.cjs")
        let script="""
        const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto');
        const database=\(try JSONCodec.string(database.path)),mode=\(try JSONCodec.string(mode));
        let data='';process.stdin.on('data',d=>data+=d);process.stdin.on('end',()=>{
          const prompt=JSON.parse(data).prompt;
          const query=sql=>JSON.parse(cp.execFileSync('/usr/bin/sqlite3',['-readonly','-json',database,sql],{encoding:'utf8'})||'[]');
          const rows=query('SELECT * FROM provider_invocations ORDER BY rowid');
          const invocation=rows.at(-1);
          if(!invocation?.dispatch_json) throw new Error('Dispatch not durable before invocation');
          const contexts=query("SELECT * FROM provider_invocation_events WHERE kind='context' ORDER BY sequence");
          const context=contexts.at(-1);
          if(context.payload!==prompt || invocation.context_sha256!==crypto.createHash('sha256').update(prompt).digest('hex')) throw new Error('Exact prompt not durable before invocation');
          fs.appendFileSync(database+'.calls',invocation.id+'\\n');
          if(mode==='retry' && rows.length===1) {process.stdout.write(JSON.stringify({ok:false,error:'synthetic transport failure'}));return;}
          let output={duplicates:[],progress:[]};
          if(mode==='observation') output={activities:[]};
          if(mode==='repair') {
            const input=JSON.parse(prompt.split('INPUT:\\n')[1].split('\\nYour previous response')[0]);
            output={activities:[{activityID:rows.length===1?'invented-reference':input.activities[0].id,name:'Fixture scope',purpose:'Fixture planning',kind:'pursuit',reason:'Two independent sources',suggestionIDs:input.evidence.map(e=>e.suggestionID)}]};
          }
          process.stdout.write(JSON.stringify({ok:true,text:JSON.stringify(output)}));
        });
        """
        try script.write(to:runner,atomically:true,encoding:.utf8)
        return (dir,database,runner)
    }

    @Test func reconciliationRecordsExactBoundaryAndRetainsDistinctFailedRetry()async throws {
        let (dir,database,runner)=try fixture(mode:"retry")
        defer {try? FileManager.default.removeItem(at:dir)}
        let store=try KnowledgeStore(path:database.path),now=Date()
        let source=try await TaskReconciliationTests().seed(store,key:"first",title:"Synthetic send garden plan",at:now.addingTimeInterval(-60))
        let engine=TaskReconciliationEngine(store:store,client:ACPClient(provider:"codex",runner:runner))
        await #expect(throws:Error.self){try await engine.runOne()}
        let first=try #require(try await store.captureFixtureRows("SELECT * FROM provider_invocations").first)
        let dispatch=try JSONCodec.decode(ProviderDispatchCapture.self,from:Data(try #require(first["dispatch_json"]).utf8))
        #expect(dispatch.coverage == .partial) // Extracted task prose lacks full derivation lineage.
        #expect(dispatch.evidence.map(\.eventID)==[source.eventID])
        #expect(dispatch.evidence.first?.occurredAt != nil)
        #expect(try await store.captureFixtureRows("SELECT * FROM provider_invocation_events WHERE kind='failure'").count==1)
        #expect(try await store.captureFixtureRows("SELECT status FROM task_reconciliation_jobs").first?["status"]=="failed")
        try await store.captureFixtureExecute("UPDATE task_reconciliation_jobs SET status='pending',created_at=0")
        try await store.captureFixtureExecute("UPDATE task_reconciliation_clock SET checked_at=0")
        try await engine.runOne()
        let rows=try await store.captureFixtureRows("SELECT * FROM provider_invocations ORDER BY rowid")
        #expect(rows.count==2)
        #expect(rows[0]["attempt_id"] != rows[1]["attempt_id"])
        #expect(rows[0]["invocation_id"] != rows[1]["invocation_id"])
        #expect(rows[0]["job_id"]==rows[1]["job_id"])
        #expect(try await store.captureFixtureRows("SELECT status FROM task_reconciliation_jobs").first?["status"]=="done")
        #expect(try String(contentsOf:database.appendingPathExtension("calls"),encoding:.utf8).split(separator:"\n").count==2)
    }

    @Test func discoveryRepairKeepsBothExactPromptsAndParentInvocation()async throws {
        let (dir,database,runner)=try fixture(mode:"repair")
        defer {try? FileManager.default.removeItem(at:dir)}
        let store=try KnowledgeStore(path:database.path),now=Date(),helper=ObservationActivityDiscoveryTests()
        let a=try await helper.source(store,"one",text:"Fixture garden layout planning",at:now)
        let b=try await helper.source(store,"two",text:"Fixture garden planting planning",at:now)
        var activity=LifeActivity();activity.name="User garden scope"
        _ = try await store.saveActivity(activity,expectedVersion:0,requestID:"fixture-scope",at:now)
        try await ActivityDiscoveryEngine(store:store,client:ACPClient(provider:"codex",runner:runner)).runOne()
        let rows=try await store.captureFixtureRows("SELECT * FROM provider_invocations ORDER BY rowid")
        #expect(rows.count==2)
        #expect(rows[1]["parent_id"]==rows[0]["id"])
        #expect(rows[0]["attempt_id"]==rows[1]["attempt_id"])
        for row in rows {
            let capture=try JSONCodec.decode(ProviderDispatchCapture.self,from:Data(try #require(row["dispatch_json"]).utf8))
            #expect(Set(capture.evidence.map(\.eventID))==Set([a.id,b.id]))
            #expect(capture.coverage == .partial) // Existing activity scope has no complete source lineage.
        }
        let contexts=try await store.captureFixtureRows("SELECT payload FROM provider_invocation_events WHERE kind='context' ORDER BY sequence")
        #expect(contexts.count==2)
        #expect(contexts[1]["payload"]?.contains("Previous response (untrusted)")==true)
        #expect(contexts[1]["payload"]?.contains("invented-reference")==true)
        #expect(try await store.captureFixtureRows("SELECT payload FROM provider_invocation_events WHERE kind='validation'").first?["payload"]=="not_applied")
        #expect(try await store.discoverySeenCount()==2)
    }

    @Test func observationOnlyDiscoveryHasCompleteDeclaredSourceCoverage()async throws {
        let (dir,database,runner)=try fixture(mode:"observation")
        defer {try? FileManager.default.removeItem(at:dir)}
        let store=try KnowledgeStore(path:database.path),now=Date(),helper=ObservationActivityDiscoveryTests()
        let a=try await helper.source(store,"one",text:"Fixture garden layout",at:now)
        let b=try await helper.source(store,"two",text:"Fixture planting schedule",at:now)
        try await ActivityDiscoveryEngine(store:store,client:ACPClient(provider:"codex",runner:runner)).runOne()
        let row=try #require(try await store.captureFixtureRows("SELECT dispatch_json FROM provider_invocations").first)
        let capture=try JSONCodec.decode(ProviderDispatchCapture.self,from:Data(try #require(row["dispatch_json"]).utf8))
        #expect(capture.coverage == .complete)
        #expect(Set(capture.evidence.map(\.eventID))==Set([a.id,b.id]))
        #expect(try await store.discoverySeenCount()==2)
    }

    @Test func captureFailurePreventsProviderLaunchAndLeavesWorkFailed()async throws {
        let (dir,database,runner)=try fixture(mode:"normal")
        defer {try? FileManager.default.removeItem(at:dir)}
        let store=try KnowledgeStore(path:database.path)
        _ = try await TaskReconciliationTests().seed(store,key:"first",title:"Synthetic garden plan",at:Date().addingTimeInterval(-60))
        try await store.captureFixtureExecute("CREATE TRIGGER reject_capture BEFORE INSERT ON provider_invocation_events WHEN NEW.kind='dispatch' BEGIN SELECT RAISE(ABORT,'fixture disk failure'); END")
        await #expect(throws:Error.self){try await TaskReconciliationEngine(store:store,client:ACPClient(provider:"codex",runner:runner)).runOne()}
        #expect(!FileManager.default.fileExists(atPath:database.path+".calls"))
        #expect(try await store.captureFixtureRows("SELECT * FROM provider_invocation_events WHERE kind='context'").count==1)
        #expect(try await store.captureFixtureRows("SELECT dispatch_json FROM provider_invocations").first?["dispatch_json"]==nil)
        #expect(try await store.captureFixtureRows("SELECT status FROM task_reconciliation_jobs").first?["status"]=="failed")
        #expect(try await store.taskRelations().isEmpty)
    }
}

extension KnowledgeStore {
    fileprivate func captureFixtureRows(_ query:String)throws->[[String:String]] {try db.rows(query)}
    fileprivate func captureFixtureExecute(_ statement:String)throws {try db.execute(statement)}
}
