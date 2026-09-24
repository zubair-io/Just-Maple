import Foundation
import Testing
import MapleCore
@testable import Just_Maple

@MainActor
struct WaitingReviewTickTests {
    @Test func waitingReviewTimerWorksWithoutConnectorsOrProvider() async throws {
        let now=Date(timeIntervalSince1970:floor(Date().timeIntervalSince1970))
        let store=try KnowledgeStore(path:":memory:")
        var task=LifeTask();task.title="Fixture blocked approval"
        task=try await store.saveTask(task,expectedVersion:0,requestID:"task",at:now)
        _ = try await store.applyTaskAction(nodeID:"task:"+task.id,change:TaskActionChange(kind:"waiting",issuedAt:now.addingTimeInterval(-60),reviewAt:now,waitingOn:"Fixture reviewer"),expectedVersion:task.version,requestID:"waiting",scope:"fixture",at:now)
        let model=AppModel();model.store=store;model.running=false;model.classifier=nil
        await model.waitingReviewTick(at:now)
        #expect(model.world?.tasks.filter{$0.waitingFollowUp != nil}.count==1)
        await model.waitingReviewTick(at:now.addingTimeInterval(30))
        #expect(try await store.tasks().count==2)
        #expect(model.world?.tasks.first{$0.id==task.id}?.status == .waiting)
    }
}

private actor FixtureGroupingProvider: ObligationGroupingProvider {
    nonisolated var identifier:String {"fixture/grouping"}
    private var calls=0
    let fails:Bool
    init(fails:Bool=false){self.fails=fails}
    func propose(_ input:ObligationGroupingInput) async throws -> String {
        calls+=1
        if fails {throw MapleError.provider("Fixture provider failure")}
        return "{\"proposals\":[]}"
    }
    func count()->Int {calls}
}

@MainActor
struct GroupingProposalTickTests {
    func seed()async throws->KnowledgeStore {
        let store=try KnowledgeStore(path:":memory:")
        for key in ["first","second"] {
            let event=Event(type:"message.received",source:Source(connector:"gmail",account:"fixture",externalID:key,revision:"1"),occurredAt:Date(),subjects:["person:self","thread:gmail:fixture"],content:"Fixture: review this document.")
            try await store.ingest(event)
            var suggestion=TaskSuggestion();suggestion.eventID=event.id;suggestion.provider="fixture";suggestion.quote=event.content;suggestion.candidate.title="Review fixture document \(key)"
            _ = try await store.offerTask(suggestion)
        }
        return store
    }
    @Test func automaticTickRequiresConfigurationAndRetainsSuccessfulEmptyResponse()async throws {
        let store=try await seed(),provider=FixtureGroupingProvider(),model=AppModel(),now=Date()
        model.store=store;model.running=true;model.classifier=nil
        await model.groupingProposalTick(provider:provider,at:now)
        #expect(await provider.count()==0)
        try await store.configureObligationGrouping(maximumSpan:86400,requestID:"configure")
        await model.groupingProposalTick(provider:provider,at:now)
        #expect(await provider.count()==1)
        #expect(try await store.obligationGroupingStatus().completed==1)
        await model.groupingProposalTick(provider:provider,at:now.addingTimeInterval(30))
        #expect(await provider.count()==1)
        #expect(try await store.obligationGroupingProposals().isEmpty)
        #expect(try await store.tasks().isEmpty)
    }
    @Test func automaticTickKeepsProviderFailureInspectableWithoutApplyingActions()async throws {
        let store=try await seed(),provider=FixtureGroupingProvider(fails:true),model=AppModel()
        try await store.configureObligationGrouping(maximumSpan:86400,requestID:"configure")
        model.store=store;model.running=true
        await model.groupingProposalTick(provider:provider)
        #expect(await provider.count()==1)
        #expect(try await store.obligationGroupingStatus().failed==1)
        #expect(try await store.obligationGroupingProposals().isEmpty)
        #expect(try await store.tasks().isEmpty)
        #expect(model.localIntelligenceStatus.contains("failed work is saved"))
    }
}
