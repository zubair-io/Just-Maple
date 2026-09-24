import Foundation
import Testing
@testable import MapleCore
struct ActionRoutingTests {
    @Test(arguments:[0.1,0.95]) func historicalActionsAreIndependentOfInterruption(action:Double) async throws {
        struct Fixture:Classifier {
            let action:Double
            func classify(_ context:Context)async throws->ClassifierResult {
                let message=MessageAssessment(kind:.information,confidence:0.99,replyNeeded:0,timeSensitive:0,commitmentChanged:0,contextConflict:0,meaningfulUpdate:0,needsReasoning:0,actionNeeded:action)
                return ClassifierResult(assessment:Assessment(notify:0,askUser:0,reason:0,summarize:0,jobStage:.unchanged,stageConfidence:1,model:"routing-fixture",provider:"fixture",message:message),rawResponse:Data("{}".utf8))
            }
        }
        let store=try KnowledgeStore(path:":memory:")
        let event=Event(type:"message.received",source:Source(connector:"gmail",account:"fixture",externalID:"renewal",revision:"1"),occurredAt:Date().addingTimeInterval(-172800),subjects:["person:self","thread:gmail:renewal"],content:"Your existing service expires in 14 days. Renew to keep access.")
        try await store.ingest(event)
        _ = try await IntelligenceEngine(store:store,classifier:Fixture(action:action)).run()
        #expect(try await store.decisions().first?.route == .retain)
        #expect(try await store.taskExtractionQueue().count == (action>=0.85 ? 1:0))
    }
    @Test func gmailContextDoesNotMixUnrelatedSelfThreads()async throws {
        let store=try KnowledgeStore(path:":memory:")
        let now=Date()
        for (id,thread) in [("related","a"),("unrelated","b"),("new","a")] {
            try await store.ingest(Event(type:"message.received",source:Source(connector:"gmail",account:"fixture",externalID:id,revision:"1"),occurredAt:now.addingTimeInterval(id=="new" ? 1:0),subjects:["person:self","thread:gmail:"+thread],content:"Message "+id))
        }
        let event=try #require(try await store.search("new").first)
        #expect(try await store.context(for:event.id).recentEvents.map(\.content)==["Message related"])
    }
}
