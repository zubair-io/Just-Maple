import Foundation
import Testing
@testable import MapleCore

struct HomeTelemetryCoalescingTests {
    func records(_ state: String, device: String = "energy", kind: String = "total_increasing", unit: String = "kWh", entity: String = "sensor.fixture") throws -> [ConnectorSourceRecord] {
        let data = try JSONSerialization.data(withJSONObject: [["entity_id": entity, "state": state, "attributes": ["device_class": device, "state_class": kind, "unit_of_measurement": unit]]])
        return try HomeAssistantClient.records(data: data, server: "https://fixture.invalid")
    }
    @Test func incrementsCoalesceButAllObservationsRemainIndexedAndBaselineSurvives() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        for value in [1,2,3,4] { _ = try await store.ingestSourceSnapshot(records(String(value)), connector: "home_assistant") }
        let queue = try await store.queue()
        #expect(queue.map(\.status) == ["pending","coalesced","coalesced","pending"])
        #expect(try await store.counterFixtureCounts() == [4,4,4,0])
        let page = try await store.historyInboxPage()
        #expect(page.items.filter { $0.status == "indexed" }.count == 2)
        #expect(page.items.allSatisfy { $0.status != "processed" })
        #expect(try await store.ingestSourceSnapshot(records("4"), connector: "home_assistant") == 0)
    }
    @Test func measurementsSafetyDiscreteUnknownUnitsAndResetsAreNotSuppressed() async throws {
        for sample in [("temperature","measurement","°C","sensor.fixture"), ("energy","measurement","kWh","sensor.fixture"), ("energy","total_increasing","unknown","sensor.fixture"), ("gas","total_increasing","m³","sensor.fixture"), ("energy","total_increasing","kWh","binary_sensor.fixture")] {
            let store = try KnowledgeStore(path: ":memory:")
            for value in [1,2,3] { _ = try await store.ingestSourceSnapshot(records(String(value),device:sample.0,kind:sample.1,unit:sample.2,entity:sample.3),connector:"home_assistant") }
            #expect(try await store.queue().allSatisfy { $0.status == "pending" })
        }
        let store = try KnowledgeStore(path: ":memory:")
        for value in ["1","2","0","unknown","unavailable","3"] { _ = try await store.ingestSourceSnapshot(records(value),connector:"home_assistant") }
        #expect(try await store.queue().allSatisfy { $0.status == "pending" })
    }
    @Test func leasesFailuresAttributesAndAccountBoundariesSurvive() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        for value in [1,2] { _ = try await store.ingestSourceSnapshot(records(String(value)),connector:"home_assistant") }
        let id = try #require(await store.queue().last?.eventID)
        let lease = try #require(await store.acquire(now:Date(),eventIDs:[id]))
        _ = try await store.ingestSourceSnapshot(records("3"),connector:"home_assistant")
        #expect(try await store.queue().first { $0.eventID == id }?.status == "leased")
        try await store.fail(lease,error:"Fixture failure",now:Date())
        _ = try await store.ingestSourceSnapshot(records("4",unit:"Wh"),connector:"home_assistant")
        _ = try await store.ingestSourceSnapshot(records("5",unit:"Wh"),connector:"home_assistant",account:"other")
        #expect(try await store.queue().allSatisfy { $0.status != "coalesced" })
    }
    @Test func transactionRollbackDoesNotSupersedePriorWork() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        for value in [1,2] { _ = try await store.ingestSourceSnapshot(records(String(value)),connector:"home_assistant") }
        var next = try records("3")
        next.append(ConnectorSourceRecord(id:"invalid",name:"",content:"invalid"))
        await #expect(throws: Error.self) { try await store.ingestSourceSnapshot(next,connector:"home_assistant") }
        #expect(try await store.queue().map(\.status) == ["pending","pending"])
        #expect(try await store.counterFixtureCounts() == [2,2,2,0])
    }
}
private extension KnowledgeStore {
    func counterFixtureCounts() throws -> [Int] {
        try ["events","events_fts","embedding_jobs","decisions"].map { table in
            Int(try db.rows("SELECT COUNT(*) AS n FROM \(table)").first!["n"]!)!
        }
    }
}
