import Foundation
import Testing
import MapleCore
@testable import Just_Maple

private actor SchedulingClassifier: Classifier {
    var calls=0
    func classify(_ context:Context) async throws -> ClassifierResult {
        calls += 1
        let assessment=Assessment(notify:0,askUser:0,reason:0,summarize:0,jobStage:.unchanged,stageConfidence:0,model:"synthetic",provider:"fixture")
        return ClassifierResult(assessment:assessment,rawResponse:try JSONCodec.encode(assessment))
    }
    func count()->Int {calls}
}
@MainActor struct ClassificationSchedulingTests {
    @Test func classificationDrainsABatchWhileDownstreamIsBusy() async throws {
        let store=try KnowledgeStore(path:":memory:"),model=AppModel(),classifier=SchedulingClassifier()
        model.store=store;model.running=true;model.downstreamBusy=true
        for i in 0..<8 {
            try await store.ingest(Event(type:"message.received",source:.init(connector:"gmail",account:"fixture",externalID:"\(i)",revision:"1"),occurredAt:Date(),subjects:["person:fixture"],content:"Synthetic scheduling fixture"))
        }
        await model.tick(classifier:classifier)
        #expect(await classifier.count()==8)
        #expect(try await store.decisions().count==8)
        let saved = try #require(await store.decisions().first)
        #expect(try await store.decision(eventID:saved.eventID)?.eventID==saved.eventID)
        #expect(model.downstreamBusy)
        #expect(!model.busy)
        model.running=false
        await model.tick(classifier:classifier)
        #expect(await classifier.count()==8)
    }
}
