import Foundation
import Testing
@testable import MapleCore
struct StageReconciliationTests {
    func fixture(_ count:Int=2)async throws->(KnowledgeStore,[TaskSuggestion],Date) {
        let store=try KnowledgeStore(path:":memory:"),at=Date().addingTimeInterval(5)
        var items:[TaskSuggestion]=[]
        for i in 0..<count {
            let e=Event(type:"message.received",source:Source(connector:"gmail",account:"fixture",externalID:"source-\(i)",revision:"1"),occurredAt:at.addingTimeInterval(-10),receivedAt:at.addingTimeInterval(-10),subjects:["person:self","thread:gmail:fixture"],content:"Please send the synthetic signed form.")
            try await store.ingest(e)
            var s=TaskSuggestion();s.eventID=e.id;s.quote=e.content;s.candidate.title="Send synthetic form \(i)";s.provider="fixture"
            items.append(try await store.offerTask(s))
        }
        return(store,items,at)
    }
    func response(_ s:[TaskSuggestion],quote:String="Please send the synthetic signed form.",unknown:Bool=false,progress:Bool=false)throws->String {
        var value:[String:Any]=["duplicates":[["firstID":"source:"+s[0].id,"secondID":unknown ? "source:unknown":"source:"+s[1].id,"firstEventID":s[0].eventID,"firstQuote":quote,"secondEventID":s[1].eventID,"secondQuote":quote,"reason":"Same synthetic occurrence and action.","confidence":0.99]],"progress":[]]
        if progress {value["progress"]=[["nodeID":"source:"+s[0].id,"status":"completed","eventID":s[0].eventID,"quote":quote,"reason":"Forbidden progress","confidence":0.99]]}
        return String(decoding:try JSONSerialization.data(withJSONObject:value),as:UTF8.self)
    }
    @Test func emptyScopeHasAnExplicitEmptyProof() async throws {
        let store=try KnowledgeStore(path:":memory:")
        let job=try await store.prepareStageReconciliation(runID:"empty",nodeVersions:[:])
        let result=try await store.finishStageReconciliation(job,response:#"{"duplicates":[],"progress":[]}"#)
        #expect(result.job.input.nodes.isEmpty)
        #expect(result.relations.isEmpty)
    }
    @Test func entireExplicitScopeBeyondTwentyAndIdempotentResultOnly()async throws {
        let(store,items,at)=try await fixture(24)
        let versions=Dictionary(uniqueKeysWithValues:items.map{("source:"+$0.id,$0.version)})
        let job=try await store.prepareStageReconciliation(runID:"fixture",nodeVersions:versions,at:at)
        #expect(job.input.nodes.count==24)
        let result=try await store.finishStageReconciliation(job,response:response(items),at:at)
        #expect(result.relations.count==1)
        #expect(try await store.taskRelations().isEmpty)
        #expect(try await store.tasks().isEmpty)
        #expect(try await store.finishStageReconciliation(job,response:response(items),at:at).relations.count==1)
        #expect(try await store.stageReconciliationResult(runID:"fixture")?.job.inputHash==job.inputHash)
        await #expect(throws:Error.self){try await store.prepareStageReconciliation(runID:"fixture",nodeVersions:["source:"+items[0].id:items[0].version],at:at)}
    }
    @Test func rejectsInventedQuotesUnknownIDsAndAnyProgress()async throws {
        let(store,items,at)=try await fixture()
        let job=try await store.prepareStageReconciliation(runID:"fixture",nodeVersions:Dictionary(uniqueKeysWithValues:items.map{("source:"+$0.id,$0.version)}),at:at)
        for invalid in [try response(items,quote:"Invented proof"),try response(items,unknown:true),try response(items,progress:true)] {
            await #expect(throws:Error.self){try await store.finishStageReconciliation(job,response:invalid,at:at)}
        }
        #expect(try await store.stageReconciliationResult(runID:"fixture")==nil)
    }
    @Test func staleVersionAndOversizedScopeFailClosed()async throws {
        let(store,items,at)=try await fixture()
        let job=try await store.prepareStageReconciliation(runID:"fixture",nodeVersions:Dictionary(uniqueKeysWithValues:items.map{("source:"+$0.id,$0.version)}),at:at)
        _ = try await store.reviewSuggestion(id:items[0].id,action:"reject",edited:nil,expectedVersion:items[0].version,requestID:"user-change",at:at)
        await #expect(throws:Error.self){try await store.finishStageReconciliation(job,response:response(items),at:at)}
        let tooMany=Dictionary(uniqueKeysWithValues:(0..<65).map{("source:\($0)",1)})
        await #expect(throws:Error.self){try await store.prepareStageReconciliation(runID:"large",nodeVersions:tooMany,at:at)}
    }
}
