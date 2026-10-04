import Foundation
import Testing
@testable import MapleCore

struct ACPModelSelectionTests {
    @Test func selectedModelTravelsToRunnerWithoutChangingGlobalConfiguration()async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
        defer {try? FileManager.default.removeItem(at:root)}
        let runner=root.appendingPathComponent("fixture.cjs")
        try #"let text='';process.stdin.on('data',x=>text+=x);process.stdin.on('end',()=>{const r=JSON.parse(text);console.log(JSON.stringify({ok:true,text:r.model??'inherited',model:r.model??'synthetic-inherited'}));});"#.write(to:runner,atomically:true,encoding:.utf8)
        let recorder=ModelMetadataRecorder()
        #expect(try await ACPClient(provider:"codex",runner:runner,model:"synthetic-supported").request("fixture",onModel:{await recorder.append($0)})=="synthetic-supported")
        #expect(await recorder.values==["synthetic-supported"])
        #expect(try await ACPClient(provider:"codex",runner:runner).request("fixture")=="inherited")
        await #expect(throws:Error.self) {try await ACPClient(provider:"claude",runner:runner,model:"synthetic-supported").request("fixture")}
        await #expect(throws:Error.self) {try await ACPClient(provider:"codex",runner:runner,model:"invalid model").request("fixture")}
    }

    @Test func providerRejectionRecordsEffectiveModelWithoutRepairOrSuccessfulResponse()async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
        defer {try? FileManager.default.removeItem(at:root)}
        let runner=root.appendingPathComponent("fixture.cjs"),counter=root.appendingPathComponent("calls")
        let script="""
        const fs=require('node:fs'),path=require('node:path');process.stdin.resume();process.stdin.on('end',()=>{fs.appendFileSync(path.join(__dirname,'calls'),'1');console.log(JSON.stringify({ok:false,model:'synthetic-unavailable',error:'The selected Codex model is unavailable for this ChatGPT account or CLI. Choose a supported model for Maple and test the connection again.'}));});
        """
        try script.write(to:runner,atomically:true,encoding:.utf8)
        let source=Event(type:"message.received",source:Source(connector:"gmail",account:"fixture",externalID:"fixture",revision:"1"),occurredAt:Date(),subjects:["person:self"],content:"Direction: incoming\nBody:\nComplete the required forms.")
        let recorder=ModelAuditRecorder(),extractor=ACPExtractor(client:ACPClient(provider:"codex",runner:runner))
        await #expect(throws:Error.self) {try await extractor.extractAudited(Context(event:source,currentState:[],recentEvents:[],relatedEvidence:[],version:"fixture"),activities:[]){await recorder.append($0)}}
        #expect(try String(contentsOf:counter,encoding:.utf8)=="1")
        let audits=await recorder.values
        #expect(audits.map(\.kind)==["context","dispatch","provider_model"])
        #expect(audits.last?.payload.contains("synthetic-unavailable")==true)
        #expect(Set(audits.map(\.invocationID)).count==1)
    }
}
private actor ModelMetadataRecorder {var values:[String]=[];func append(_ value:String){values.append(value)}}
private actor ModelAuditRecorder {var values:[ProviderAuditEvent]=[];func append(_ value:ProviderAuditEvent){values.append(value)}}
