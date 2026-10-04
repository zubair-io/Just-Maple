import Foundation
import Testing
@testable import MapleCore

/// Explicitly synthetic subprocesses, temporary stores and no live models.
struct InlineProviderCaptureTests {
    func fixture() throws -> (URL,URL,URL) {
        let dir=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true)
        let database=dir.appendingPathComponent("fixture.sqlite"),runner=dir.appendingPathComponent("runner.cjs")
        try """
        const fs=require('node:fs'),cp=require('node:child_process');
        const database=\(try JSONCodec.string(database.path));
        let data='';process.stdin.on('data',d=>data+=d);process.stdin.on('end',()=>{
          const prompt=JSON.parse(data).prompt;
          const query=sql=>JSON.parse(cp.execFileSync('/usr/bin/sqlite3',['-readonly','-json',database,sql],{encoding:'utf8'})||'[]');
          const row=query('SELECT * FROM provider_invocations ORDER BY rowid DESC LIMIT 1')[0];
          if(!row?.dispatch_json) throw Error('Missing durable dispatch');
          const context=query("SELECT payload FROM provider_invocation_events WHERE kind='context' ORDER BY sequence DESC LIMIT 1")[0];
          if(context.payload!==prompt) throw Error('Incorrect persisted input');
          const dispatch=JSON.parse(row.dispatch_json);
          const ids=dispatch.evidence.map(e=>e.eventID);
          const expected=row.stage==='inline_answer'?['email']:[];
          if(JSON.stringify(ids)!==JSON.stringify(expected)) throw Error('Wrong evidence');
          fs.appendFileSync(database+'.calls',row.id+'\\n');
          const response=row.stage==='inline_intent'?{type:'email',sender:'Dominick',query:'',clarification:null}:{text:'Found a synthetic email.',eventIDs:['email']};
          process.stdout.write(JSON.stringify({ok:true,text:JSON.stringify(response)}));
        });
        """.write(to:runner,atomically:true,encoding:.utf8)
        return(dir,database,runner)
    }
    @Test func exactIntentAndAnswerAreCapturedBeforeDispatch()async throws {
        let(dir,database,runner)=try fixture();defer{try? FileManager.default.removeItem(at:dir)}
        let store=try KnowledgeStore(path:database.path),helper=InlineMapleTests()
        try await store.ingest(helper.event("email",sender:"Dominick"))
        try await store.ingest(helper.event("unrelated",sender:"Someone else"))
        let run=try await store.queueInlineMaple(helper.request(),provider:"codex")
        let result=try await InlineMapleEngine(store:store,provider:ConfiguredInlineMapleProvider(name:"codex",runner:runner)).run(run.runID)
        #expect(result.status=="unapplied")
        let rows=try await store.inlineCaptureRows("SELECT * FROM provider_invocations ORDER BY rowid")
        #expect(rows.count==2)
        #expect(rows[0]["attempt_id"] != rows[1]["attempt_id"])
        #expect(Set(rows.compactMap{$0["job_id"]})==[run.runID])
        for row in rows {
            let dispatch=try JSONCodec.decode(ProviderDispatchCapture.self,from:Data(try #require(row["dispatch_json"]).utf8))
            #expect(dispatch.coverage == .partial)
        }
        #expect(try await store.inlineCaptureRows("SELECT * FROM provider_invocation_events WHERE kind='response'").count==2)
        #expect(try await store.inlineCaptureRows("SELECT * FROM provider_invocation_events WHERE kind='validation' AND payload='valid'").count==2)
        _ = try await InlineMapleEngine(store:store,provider:ConfiguredInlineMapleProvider(name:"codex",runner:runner)).run(run.runID)
        #expect(try String(contentsOf:database.appendingPathExtension("calls"),encoding:.utf8).split(separator:"\n").count==2)
    }
    @Test func failedDispatchCapturePreventsLaunch()async throws {
        let(dir,database,runner)=try fixture();defer{try? FileManager.default.removeItem(at:dir)}
        let store=try KnowledgeStore(path:database.path)
        try await store.inlineCaptureExecute("CREATE TRIGGER reject_inline_capture BEFORE INSERT ON provider_invocation_events WHEN NEW.kind='dispatch' BEGIN SELECT RAISE(ABORT,'synthetic storage failure'); END")
        let run=try await store.queueInlineMaple(InlineMapleTests().request(),provider:"codex")
        let result=try await InlineMapleEngine(store:store,provider:ConfiguredInlineMapleProvider(name:"codex",runner:runner)).run(run.runID)
        #expect(result.status=="failed")
        #expect(!FileManager.default.fileExists(atPath:database.path+".calls"))
        #expect(try await store.inlineCaptureRows("SELECT dispatch_json FROM provider_invocations").first?["dispatch_json"]==nil)
    }
    @Test func legacyProviderDoesNotInventDispatchAndInvalidProviderFailsPreflight()async throws {
        struct Legacy:InlineMapleProvider {
            let name="fixture",model="synthetic"
            func respond(_ prompt:String)async throws->String {#"{"type":"any","sender":"","query":"","clarification":"Synthetic clarification"}"#}
        }
        let store=try KnowledgeStore(path:":memory:")
        let run=try await store.queueInlineMaple(InlineMapleTests().request(),provider:"fixture")
        let result=try await InlineMapleEngine(store:store,provider:Legacy()).run(run.runID)
        #expect(result.status=="unapplied")
        let invalid=try await store.queueInlineMaple(InlineMapleTests().request("invalid"),provider:"invalid")
        let failed=try await InlineMapleEngine(store:store,provider:ConfiguredInlineMapleProvider(name:"invalid",runner:URL(fileURLWithPath:"/unused"))).run(invalid.runID)
        #expect(failed.status=="failed")
        #expect(try await store.inlineCaptureRows("SELECT * FROM provider_invocation_events WHERE kind='dispatch'").isEmpty)
    }
    @Test func cancellationBeforeBoundaryPreventsDispatchAndKeepsCanceledRun()async throws {
        struct Canceling:InlineMapleProvider {
            let name="fixture",model="synthetic",store:KnowledgeStore,runID:String
            func respond(_ prompt:String)async throws->String {throw MapleError.invalid("Expected audited entry point")}
            func respond(_ prompt:String,beforeDispatch:@escaping @Sendable () async throws->Void)async throws->String {
                _ = try await store.cancelInlineMaple(runID)
                try await beforeDispatch()
                Issue.record("Canceled request passed dispatch boundary")
                return "{}"
            }
        }
        let store=try KnowledgeStore(path:":memory:")
        let run=try await store.queueInlineMaple(InlineMapleTests().request(),provider:"fixture")
        let result=try await InlineMapleEngine(store:store,provider:Canceling(store:store,runID:run.runID)).run(run.runID)
        #expect(result.status=="canceled")
        #expect(try await store.inlineCaptureRows("SELECT * FROM provider_invocation_events WHERE kind='dispatch'").isEmpty)
        #expect(try await store.inlineCaptureRows("SELECT payload FROM provider_invocation_events WHERE kind='validation'").first?["payload"]=="not_received")
    }
}
extension KnowledgeStore {
    fileprivate func inlineCaptureRows(_ sql:String)throws->[[String:String]] {try db.rows(sql)}
    fileprivate func inlineCaptureExecute(_ sql:String)throws {try db.execute(sql)}
}
