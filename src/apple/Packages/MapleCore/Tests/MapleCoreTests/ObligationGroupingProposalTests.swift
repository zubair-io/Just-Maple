import Foundation
import Testing
@testable import MapleCore

private struct ProposalOutput: Codable {let proposals:[ObligationGroupingProposal]}
private struct FailingGroupingProvider:ObligationGroupingProvider {
    let identifier="fixture/provider"
    func propose(_ input:ObligationGroupingInput)async throws->String {throw MapleError.provider("Synthetic provider failure")}
}
struct ObligationGroupingProposalTests {
    let now=Date()
    func seed(_ store:KnowledgeStore,_ i:Int,age:TimeInterval=0,evidenceCount:Int=1)async throws -> LifeTask {
        var ids=[String]()
        for index in 0..<evidenceCount {
            let e=Event(type:"message.received",source:Source(connector:"gmail",account:"fixture",externalID:"fixture-\(i)-\(index)",revision:"1"),occurredAt:now.addingTimeInterval(-age),subjects:["person:self","thread:fixture"],content:"Please review form number \(i).")
            try await store.ingest(e);ids.append(e.id)
        }
        var task=LifeTask();task.title="Review form \(i)";task.evidenceIDs=ids
        return try await store.saveTask(task,expectedVersion:0,requestID:"seed-\(i)",at:now)
    }
    private func output(_ job:ObligationGroupingJob,badQuote:Bool=false) -> ProposalOutput {
        ProposalOutput(proposals:[ObligationGroupingProposal(intent:"Review forms",actorID:"person:self",target:"Forms",reason:"Synthetic evidence-backed proposal",children:job.input.nodes.prefix(2).map{node in
            let source=job.input.sources.first{$0.id==node.sourceIDs[0]}!
            return GroupingProposalEvidence(nodeID:node.id,eventID:source.id,quote:badQuote ? "Invented request":source.content,actionQuote:"review",targetQuote:"form",version:node.version)
        })])
    }
    @Test func noImplicitWindowAndEvidenceProposalNeverMutatesMembership()async throws {
        let store=try KnowledgeStore(path:":memory:")
        _ = try await seed(store,1);_ = try await seed(store,2)
        #expect(try await store.acquireObligationGrouping(provider:"fixture",at:now)==nil)
        try await store.configureObligationGrouping(maximumSpan:3600,requestID:"configure")
        let job=try #require(await store.acquireObligationGrouping(provider:"fixture",at:now))
        try await store.finishObligationGrouping(job,response:JSONCodec.string(output(job)),at:now)
        #expect(try await store.obligationGroupingProposals(at:now).count==1)
        #expect(try await store.reviewedObligationGroups().isEmpty)
        #expect(try await store.tasks().allSatisfy{$0.status == .open && $0.version==1})
        #expect(try await store.acquireObligationGrouping(provider:"fixture",at:now)==nil)
    }
    @Test func oldEvidenceIsExcludedDespiteRecentEditAndLegacyCorrectionsAreFlagged()async throws {
        let store=try KnowledgeStore(path:":memory:")
        let old=try await seed(store,0,age:31*86400),a=try await seed(store,1);_ = try await seed(store,2)
        _ = try await store.correctTaskInference(nodeID:"task:"+a.id,status:.waiting,separate:false,expectedVersion:1,requestID:"legacy")
        try await store.configureObligationGrouping(maximumSpan:3600,requestID:"configure")
        let job=try #require(await store.acquireObligationGrouping(provider:"fixture",at:now))
        #expect(!job.input.nodes.contains{$0.id=="task:"+old.id})
        #expect(job.input.nodes.first{$0.id=="task:"+a.id}?.userStatus==true)
        #expect(job.input.sources.allSatisfy{AIProcessingWindow.includes($0.occurredAt,at:now)})
    }
    @Test func unvalidatedAndChangedSourcesFailAtomically()async throws {
        let store=try KnowledgeStore(path:":memory:")
        var a=try await seed(store,1);_ = try await seed(store,2)
        try await store.configureObligationGrouping(maximumSpan:3600,requestID:"configure")
        let job=try #require(await store.acquireObligationGrouping(provider:"fixture",at:now))
        await #expect(throws:Error.self){try await store.finishObligationGrouping(job,response:JSONCodec.string(output(job,badQuote:true)),at:now)}
        #expect(try await store.obligationGroupingProposals(at:now).isEmpty)
        a.title="Fixture intervening correction";_ = try await store.saveTask(a,expectedVersion:1,requestID:"edit")
        await #expect(throws:Error.self){try await store.finishObligationGrouping(job,response:"{\"proposals\":[]}",at:now)}
        #expect(try await store.obligationGroupingStatus().completed==0)
    }
    @Test func providerFailureRemainsFailedAndExplicitRetryKeepsSameBatch()async throws {
        let store=try KnowledgeStore(path:":memory:")
        _ = try await seed(store,1);_ = try await seed(store,2)
        try await store.configureObligationGrouping(maximumSpan:3600,requestID:"configure")
        await #expect(throws:Error.self){try await ObligationGroupingEngine(store:store,provider:FailingGroupingProvider()).runOne()}
        #expect(try await store.obligationGroupingStatus().failed==1)
        #expect(try await store.obligationGroupingProposals().isEmpty)
        #expect(try await store.acquireObligationGrouping(provider:"fixture/provider")==nil)
        try await store.retryObligationGrouping(requestID:"retry")
        #expect(try await store.acquireObligationGrouping(provider:"fixture/provider") != nil)
    }
    @Test func coverageAdvancesPastTwentyAndUsesAllEvidenceIDs()async throws {
        let store=try KnowledgeStore(path:":memory:")
        for i in 0..<23 {_ = try await seed(store,i,evidenceCount:i==0 ? 4:1)}
        try await store.configureObligationGrouping(maximumSpan:3600,requestID:"configure")
        var covered=Set<String>()
        for _ in 0..<4 {
            guard let job=try await store.acquireObligationGrouping(provider:"fixture",at:now) else {break}
            #expect(job.input.nodes.count<=20 && job.input.sources.count<=20)
            covered.formUnion(job.input.nodes.map(\.id))
            try await store.finishObligationGrouping(job,response:"{\"proposals\":[]}",at:now)
        }
        #expect(covered.count==23)
        #expect(try await store.acquireObligationGrouping(provider:"fixture",at:now)==nil)
        #expect(try await store.obligationGroupingStatus().coveredVersions==23)
    }
    @Test func retriesPreserveOriginalBatchAndSupersedeChangedVersions()async throws {
        let store=try KnowledgeStore(path:":memory:")
        var a=try await seed(store,1);_ = try await seed(store,2)
        try await store.configureObligationGrouping(maximumSpan:3600,requestID:"configure")
        let first=try #require(await store.acquireObligationGrouping(provider:"fixture",at:now))
        try await store.failObligationGrouping(first)
        _ = try await seed(store,3)
        try await store.retryObligationGrouping(requestID:"retry")
        let retry=try #require(await store.acquireObligationGrouping(provider:"fixture",at:now))
        #expect(retry.id==first.id && retry.input.nodes.count==2)
        try await store.failObligationGrouping(retry)
        a.title="Fixture updated task";_ = try await store.saveTask(a,expectedVersion:1,requestID:"edit")
        try await store.retryObligationGrouping(requestID:"retry-changed")
        #expect(try await store.obligationGroupingStatus().pending==0)
        #expect(try await store.acquireObligationGrouping(provider:"fixture",at:now)?.id != first.id)
    }
    @Test func unsampledFourthEvidenceAgingOutBlocksRetryAndProviderDispatch()async throws {
        let store=try KnowledgeStore(path:":memory:")
        var ids=[String]()
        for i in 0..<4 {
            let e=Event(id:"fixture-source-\(i)",type:"message.received",source:Source(connector:"gmail",account:"fixture",externalID:"many-\(i)",revision:"1"),occurredAt:i==3 ? now.addingTimeInterval(-30*86400+1):now,subjects:["person:self","thread:fixture"],content:"Please review form.")
            try await store.ingest(e);ids.append(e.id)
        }
        var task=LifeTask();task.title="Fixture derived old context";task.evidenceIDs=ids
        _ = try await store.saveTask(task,expectedVersion:0,requestID:"many")
        _ = try await seed(store,1)
        try await store.configureObligationGrouping(maximumSpan:31*86400,requestID:"configure")
        let job=try #require(await store.acquireObligationGrouping(provider:"fixture",at:now))
        #expect(!job.input.sources.contains{$0.id=="fixture-source-3"})
        await #expect(throws:Error.self){try await store.validateObligationGroupingJob(job,at:now.addingTimeInterval(2))}
        try await store.failObligationGrouping(job)
        try await store.retryObligationGrouping(requestID:"retry")
        #expect(try await store.acquireObligationGrouping(provider:"fixture",at:now.addingTimeInterval(2))==nil)
        #expect(try await store.obligationGroupingStatus().pending==0)
    }

}
