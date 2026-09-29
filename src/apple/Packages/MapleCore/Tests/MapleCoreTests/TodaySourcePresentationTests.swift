import Foundation
import Testing
@testable import MapleCore

struct TodaySourcePresentationTests {
    @Test func homePreviewUsesActualPriorAndCurrentStatesAndCountsHiddenEntities() async throws {
        let store=try KnowledgeStore(path:":memory:")
        func records(_ state:String)->[ConnectorSourceRecord] {
            (0..<4).map { ConnectorSourceRecord(id:"light.fixture_\($0)",name:"Synthetic room \($0)",content:"Home Assistant entity: light.fixture_\($0)\nName: Synthetic room \($0)\nState: \(state)") }
        }
        _ = try await store.ingestSourceSnapshot(records("off"),connector:"home_assistant")
        let first=try #require(await store.queue().first { $0.status == "pending" }?.eventID)
        #expect(try await store.sourceDetail(eventID:first).row.preview.contains("observed off"))
        _ = try await store.ingestSourceSnapshot(records("on"),connector:"home_assistant")
        let next=try #require(await store.queue().first { $0.status == "pending" && $0.eventID != first }?.eventID)
        let row=try await store.sourceDetail(eventID:next).row
        #expect(row.preview.contains("off → on"))
        #expect(row.preview.contains("+1 more entities"))
        #expect(!row.preview.contains("Synthetic room 3"))
        #expect(row.attentionReason == nil) // no fabricated classifier result
    }
}
