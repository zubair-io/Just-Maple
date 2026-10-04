import Foundation
import Testing
@testable import MapleCore

private struct SyntheticUnauditedGrouping:ObligationGroupingProvider {
    let identifier="fixture/unaudited-grouping"
    func propose(_ input:ObligationGroupingInput)async throws->String {"{\"proposals\":[]}"}
}
struct ObligationGroupingCaptureTests {
    private func fixture()throws->(URL,URL,URL) {
        let dir=FileManager.default.temporaryDirectory.appendingPathComponent("grouping-capture-"+UUID().uuidString)
        try FileManager.default.createDirectory(at:dir,withIntermediateDirectories:true)
        let database=dir.appendingPathComponent("fixture.sqlite"),runner=dir.appendingPathComponent("fixture.cjs")
        let script="""
        const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto');
        const database=\(try JSONCodec.string(database.path));
        let data='';process.stdin.on('data',d=>data+=d);process.stdin.on('end',()=>{
          const prompt=JSON.parse(data).prompt;
          const query=sql=>JSON.parse(cp.execFileSync('/usr/bin/sqlite3',['-readonly','-json',database,sql],{encoding:'utf8'})||'[]');
          const invocations=query("SELECT * FROM provider_invocations WHERE stage='obligation_grouping' ORDER BY rowid");
          const invocation=invocations.at(-1);
          const context=query("SELECT payload FROM provider_invocation_events WHERE kind='context' ORDER BY sequence").at(-1);
          if(!invocation?.dispatch_json || context?.payload!==prompt || invocation.context_sha256!==crypto.createHash('sha256').update(prompt).digest('hex')) throw new Error('Capture missing before synthetic provider entry');
          const capture=JSON.parse(invocation.dispatch_json),input=JSON.parse(prompt.split('INPUT:\\n')[1]);
          const expected=[...new Set([...input.sources.map(s=>s.id),...input.nodes.flatMap(n=>n.sourceIDs)])].sort();
          if(JSON.stringify(capture.evidence.map(e=>e.eventID))!==JSON.stringify(expected) || capture.coverage!=='partial') throw new Error('Evidence does not match exact final input');
          fs.appendFileSync(database+'.calls',invocation.id+'\\n');
          process.stdout.write(JSON.stringify(invocations.length===1?{ok:false,error:'synthetic provider error must not leak'}:{ok:true,text:'{"proposals":[]}'}));
        });
        """
        try script.write(to:runner,atomically:true,encoding:.utf8)
        return(dir,database,runner)
    }
    private func seed(_ store:KnowledgeStore)async throws {
        let helper=ObligationGroupingProposalTests()
        _ = try await helper.seed(store,1,evidenceCount:4)
        _ = try await helper.seed(store,2)
        try await store.configureObligationGrouping(maximumSpan:3600,requestID:"fixture-config")
    }

    @Test func exactFinalContextPersistsBeforeTransportAndRetryKeepsPriorFailure()async throws {
        let (dir,database,runner)=try fixture();defer {try? FileManager.default.removeItem(at:dir)}
        let store=try KnowledgeStore(path:database.path);try await seed(store)
        let engine=ObligationGroupingEngine(store:store,provider:ACPObligationGroupingProvider(client:ACPClient(provider:"codex",runner:runner)))
        await #expect(throws:Error.self){try await engine.runOne()}
        #expect(try await store.obligationGroupingStatus().failed==1)
        #expect(try await store.groupingCaptureRows("SELECT payload FROM provider_invocation_events WHERE kind='failure'").first?["payload"]=="provider_request_failed")
        try await store.retryObligationGrouping(requestID:"synthetic-retry")
        try await engine.runOne()
        let rows=try await store.groupingCaptureRows("SELECT * FROM provider_invocations ORDER BY rowid")
        #expect(rows.count==2)
        #expect(rows[0]["job_id"]==rows[1]["job_id"])
        #expect(rows[0]["attempt_id"] != rows[1]["attempt_id"])
        #expect(rows[0]["invocation_id"] != rows[1]["invocation_id"])
        #expect(rows.allSatisfy{$0["parent_id"]==nil}) // Separate user retry, not a model repair.
        let capture=try JSONCodec.decode(ProviderDispatchCapture.self,from:Data(try #require(rows[1]["dispatch_json"]).utf8))
        #expect(capture.evidence.count==4 && capture.evidence.allSatisfy{$0.occurredAt != nil})
        #expect(capture.coverage == .partial)
        #expect(try await store.obligationGroupingStatus().completed==1)
        #expect(try await store.reviewedObligationGroups().isEmpty)
        #expect(try await store.tasks().allSatisfy{$0.status == .open && $0.version==1})
        #expect(try String(contentsOf:database.appendingPathExtension("calls"),encoding:.utf8).split(separator:"\n").count==2)
    }

    @Test func failedDispatchPersistencePreventsProviderCallAndProposalEffects()async throws {
        let (dir,database,runner)=try fixture();defer {try? FileManager.default.removeItem(at:dir)}
        let store=try KnowledgeStore(path:database.path);try await seed(store)
        try await store.groupingCaptureExecute("CREATE TRIGGER reject_grouping_capture BEFORE INSERT ON provider_invocation_events WHEN NEW.kind='dispatch' BEGIN SELECT RAISE(ABORT,'synthetic disk error'); END")
        await #expect(throws:Error.self){try await ObligationGroupingEngine(store:store,provider:ACPObligationGroupingProvider(client:ACPClient(provider:"codex",runner:runner))).runOne()}
        #expect(!FileManager.default.fileExists(atPath:database.path+".calls"))
        #expect(try await store.groupingCaptureRows("SELECT dispatch_json FROM provider_invocations").first?["dispatch_json"]==nil)
        #expect(try await store.obligationGroupingStatus().failed==1)
        #expect(try await store.obligationGroupingProposals().isEmpty)
    }

    @Test func unauditedFixtureDoesNotInventDispatchRecords()async throws {
        let store=try KnowledgeStore(path:":memory:");try await seed(store)
        try await ObligationGroupingEngine(store:store,provider:SyntheticUnauditedGrouping()).runOne()
        #expect(try await store.obligationGroupingStatus().completed==1)
        #expect(try await store.groupingCaptureRows("SELECT id FROM provider_invocations").isEmpty)
    }
}
extension KnowledgeStore {
    fileprivate func groupingCaptureRows(_ sql:String)throws->[[String:String]] {try db.rows(sql)}
    fileprivate func groupingCaptureExecute(_ sql:String)throws {try db.execute(sql)}
}
