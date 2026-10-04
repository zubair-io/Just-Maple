import Foundation
import Testing
@testable import MapleCore

private actor DispatchAdapterRecorder {
    var events=[ProviderAuditEvent]()
    var calls=0
    func append(_ event:ProviderAuditEvent)throws {events.append(event)}
    func called()throws {
        #expect(events.last?.kind == "dispatch")
        #expect(events.dropLast().last?.kind == "context")
        calls += 1
    }
}
private struct DispatchAdapterTransport:HTTPTransport {
    let recorder:DispatchAdapterRecorder
    func send(_ request:URLRequest)async throws->(Data,Int) {
        try await recorder.called()
        return (try TypeSafeTests().payload(),200)
    }
}
struct ProviderDispatchAdapterTests {
    func event(_ id:String,connector:String="notes",text:String="Explicit synthetic dispatch fixture",at:Date=Date(),subjects:[String]=["person:self","thread:fixture"])->Event {
        Event(id:id,type:"source.updated",source:.init(connector:connector,account:"synthetic",externalID:id,revision:"1"),occurredAt:at,subjects:subjects,content:text)
    }
    func context(_ event:Event)->Context {Context(event:event,currentState:[],recentEvents:[],relatedEvidence:[],version:"synthetic")}

    @Test func metadataKeepsExplicitUnknownReferencesAndNeverSubstitutesObservedTime() throws {
        let now=Date(),source=event("source",at:now),other=event("other",at:now.addingTimeInterval(-20))
        let claim=Claim(id:"claim",subject:"person:self",predicate:"fixture",value:"Synthetic",evidenceEventID:"missing-claim-evidence",observedAt:now,confidence:1,origin:"user")
        let fact=SourceFact(id:"fact",subject:"person:self",predicate:"fixture",value:"Synthetic",sourceQuote:"Synthetic",eventID:"fact-evidence",provider:"fixture",model:"fixture",extractedAt:now,sourceOccurredAt:now.addingTimeInterval(-40))
        var input=Context(event:source,currentState:[claim],recentEvents:[other],relatedEvidence:[other],version:"synthetic",sourceFacts:[fact])
        var task=LifeTask();task.evidenceIDs=["missing-task-evidence","other"]
        input.world=ReasoningWorldContext(asOf:now,activities:[],tasks:[task],states:[])
        let capture=ProviderDispatchEvidence(context:input).capture(at:now)
        #expect(capture.coverage == .complete) // Identity list complete; root resolves missing dates or downgrades it.
        #expect(capture.evidence.map(\.eventID)==["fact-evidence","missing-claim-evidence","missing-task-evidence","other","source"])
        #expect(capture.evidence.first{$0.eventID=="missing-claim-evidence"}?.occurredAt == nil)
        #expect(capture.evidence.first{$0.eventID=="missing-task-evidence"}?.occurredAt == nil)
        #expect(capture.evidence.first{$0.eventID=="fact-evidence"}?.occurredAt == fact.sourceOccurredAt)
        var activity=LifeActivity();activity.name="Synthetic scope"
        #expect(ProviderDispatchEvidence(context:input,additionalActivities:[activity]).capture().coverage == .partial)
        #expect(ProviderDispatchEvidence(context:input,includeWorld:false).capture().evidence.contains{$0.eventID=="missing-task-evidence"} == false)
        let inconsistent=ProviderDispatchEvidence(event:source).merging(ProviderDispatchEvidence(event:event("source",at:now.addingTimeInterval(1)))).capture()
        #expect(inconsistent.coverage == .partial && inconsistent.evidence.first?.occurredAt == nil)
    }

    @Test func taskCaptureUsesExactPrunedContextAndKeepsActivityProvenanceUnknown()throws {
        let source=event("source"),history=(0..<30).map{event("history-\($0)",text:String(repeating:"Synthetic bounded context. ",count:100))}
        let input=Context(event:source,currentState:[],recentEvents:history,relatedEvidence:[],version:"synthetic")
        let request=try ACPExtractor.taskRequest(input,activities:[])
        let marker="CONTEXT (supporting context only, not new task evidence):\n"
        let sent=try JSONCodec.decode(Context.self,from:Data(try #require(request.prompt.components(separatedBy:marker).last).utf8))
        let actual=Set(([sent.event]+sent.recentEvents+sent.relatedEvidence).map(\.id))
        #expect(actual.count < 31)
        #expect(Set(request.evidence.capture().evidence.map(\.eventID)) == actual)
        var activity=LifeActivity();activity.name="Synthetic activity"
        #expect(try ACPExtractor.taskRequest(input,activities:[activity]).evidence.capture().coverage == .partial)
    }

    @Test func typeSafeDispatchIsDurableBeforeTransportAndMatchesFilteredInput()async throws {
        let now=Date(),source=event("source",at:now),related=event("related",at:now.addingTimeInterval(-10)),unrelated=event("unrelated",at:now.addingTimeInterval(-20),subjects:["person:self","different"])
        let input=Context(event:source,currentState:[],recentEvents:[related,unrelated],relatedEvidence:[],version:"synthetic")
        let recorder=DispatchAdapterRecorder(),classifier=try TypeSafeClassifier(apiKey:"synthetic-unused",transport:DispatchAdapterTransport(recorder:recorder))
        _ = try await classifier.classifyAudited(input){try await recorder.append($0)}
        let entries=await recorder.events,dispatch=try #require(entries.first{$0.kind=="dispatch"})
        #expect(await recorder.calls == 1)
        #expect(dispatch.payload.isEmpty && dispatch.invocationID==entries.first?.invocationID)
        #expect(dispatch.dispatch?.coverage == .complete)
        #expect(Set(dispatch.dispatch?.evidence.map(\.eventID) ?? []) == ["source","related"])
        for factCheck in [false,true] {
            let blocked=DispatchAdapterRecorder(),provider=try TypeSafeClassifier(apiKey:"synthetic-unused",transport:DispatchAdapterTransport(recorder:blocked))
            let audit:ProviderAuditSink={entry in if entry.kind=="dispatch" {throw MapleError.database("Synthetic disk failure")};try await blocked.append(entry)}
            await #expect(throws:Error.self){
                if factCheck {_ = try await provider.checkFacts(input,audit:audit)}
                else {_ = try await provider.classifyAudited(input,audit:audit)}
            }
            #expect(await blocked.calls == 0)
        }
    }

    @Test func homeDispatchExcludesWorldAndFactsOmittedByCompactWireCodec()async throws {
        let now=Date();var input=context(event("batch",connector:"home_assistant",at:now))
        input.sourceFacts=[SourceFact(id:"fact",subject:"person:self",predicate:"fixture",value:"Synthetic",sourceQuote:"Synthetic",eventID:"not-sent",provider:"fixture",model:"fixture",extractedAt:now,sourceOccurredAt:now)]
        input.world=ReasoningWorldContext(asOf:now,activities:[LifeActivity()],tasks:[],states:[])
        let recorder=DispatchAdapterRecorder(),classifier=try TypeSafeClassifier(apiKey:"synthetic-unused",transport:DispatchAdapterTransport(recorder:recorder))
        _ = try await classifier.classifyAudited(input){try await recorder.append($0)}
        let dispatch=try #require(await recorder.events.first{$0.kind=="dispatch"}?.dispatch)
        #expect(dispatch.evidence.map(\.eventID)==["batch"] && dispatch.coverage == .complete)
    }

    @Test func layaPreflightAndAuditFailuresNeverInvokeModel()async throws {
        let input=context(event("source")),recorder=DispatchAdapterRecorder()
        let classifier=LayaClassifier(predict:{_,_ in try await recorder.called();throw MapleError.provider("Synthetic prediction should not run")},preflight:{_,_ in throw LayaError.capacity("Synthetic preflight failure")})
        await #expect(throws:Error.self){try await classifier.classifyAudited(input){try await recorder.append($0)}}
        await #expect(throws:Error.self){try await classifier.checkFacts(input){try await recorder.append($0)}}
        #expect(await recorder.calls == 0)
        #expect(await recorder.events.allSatisfy{$0.kind != "dispatch"})
        let blocked=LayaClassifier {_,_ in try await recorder.called();throw MapleError.provider("Synthetic prediction should not run")}
        await #expect(throws:Error.self){try await blocked.classifyAudited(input){entry in if entry.kind=="dispatch" {throw MapleError.database("Synthetic audit failure")};try await recorder.append(entry)}}
        #expect(await recorder.calls == 0)
    }

    @Test func acpFactTaskAndRepairDispatchesLinkToExactContextsAndFailureStopsProcess()async throws {
        let directory=FileManager.default.temporaryDirectory.appendingPathComponent("maple-dispatch-fixture-"+UUID().uuidString)
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        defer {try? FileManager.default.removeItem(at:directory)}
        let runner=directory.appendingPathComponent("fixture.cjs"),marker=directory.appendingPathComponent("called")
        try """
        const fs=require('fs'),path=require('path');let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{
          fs.writeFileSync(path.join(__dirname,'called'),'synthetic');const p=JSON.parse(input).prompt;
          const text=p.includes('Extract only explicit assertions')?'{"facts":[]}':(p.includes('VALID-FIRST')||p.includes('previous response failed strict validation'))?'{"tasks":[]}':'invalid synthetic JSON';
          process.stdout.write(JSON.stringify({ok:true,text}));
        });
        """.write(to:runner,atomically:true,encoding:.utf8)
        let provider=ACPExtractor(client:ACPClient(provider:"codex",runner:runner)),source=event("source"),factRecorder=DispatchAdapterRecorder()
        _ = try await provider.extractAudited(source){try await factRecorder.append($0)}
        #expect(await factRecorder.events.map(\.kind)==["context","dispatch","response"])
        let recorder=DispatchAdapterRecorder()
        _ = try await provider.extractAudited(context(source),activities:[]){try await recorder.append($0)}
        let entries=await recorder.events,dispatches=entries.filter{$0.kind=="dispatch"}
        #expect(dispatches.count==2 && dispatches[1].parentInvocationID==dispatches[0].invocationID)
        #expect(Set(dispatches.map(\.invocationID)).count==2)
        #expect(dispatches.allSatisfy{$0.payload.isEmpty && $0.dispatch?.evidence.map(\.eventID)==[source.id]})
        for dispatch in dispatches {
            let index=try #require(entries.firstIndex{$0.kind=="dispatch" && $0.invocationID==dispatch.invocationID})
            #expect(entries[index-1].kind=="context" && entries[index-1].invocationID==dispatch.invocationID)
        }
        let failedValidation=DispatchAdapterRecorder()
        await #expect(throws:Error.self){try await provider.extractAudited(context(event("valid-first",text:"VALID-FIRST synthetic source")),activities:[]){entry in
            try await failedValidation.append(entry)
            if entry.kind=="validation" {throw MapleError.database("Synthetic validation audit failure")}
        }}
        #expect(await failedValidation.events.filter{$0.kind=="dispatch"}.count==1)
        try FileManager.default.removeItem(at:marker)
        await #expect(throws:Error.self){try await provider.extractAudited(source){entry in if entry.kind=="dispatch" {throw MapleError.database("Synthetic audit failure")}}}
        #expect(!FileManager.default.fileExists(atPath:marker.path))
        let invalid=ACPClient(provider:"unsupported-fixture",runner:runner)
        await #expect(throws:Error.self){try await invalid.request("fixture"){Issue.record("Preflight failure must not dispatch")}}
        #expect(!FileManager.default.fileExists(atPath:marker.path))
    }
}
