import Foundation
import Network
import Testing
@testable import MapleCore
@testable import MapleCompanionTransport
@testable import Just_Maple

@MainActor
struct CompanionDeliveryTests {
    private enum FixtureFailure: Error { case replyLost, unauthorized }

    @Test func encryptedDeliveryLostReceiptRetryPreservesOldDateAndSingleIngestion() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try KnowledgeStore(path: directory.appendingPathComponent("fixture.sqlite").path)
        let configuration = try PairingConfiguration.create()
        let device = UUID()
        // Whole milliseconds survive the wire codec without introducing source-time drift.
        let now = Date(timeIntervalSince1970: floor(Date().timeIntervalSince1970))
        let capture = SyncCapture(id: UUID(), text: "Synthetic delivery fixture: collect repaired bicycle", createdAt: now.addingTimeInterval(-90 * 86400))
        let request = try SyncCodec.encode(SyncRequest(deviceID: device, operation: "sync", captures: [capture]))
        let server = CompanionTransportServer()
        var loseFirstReceipt = true
        try await server.start(configuration: configuration) { bytes in
            let incoming = try SyncCodec.decode(SyncRequest.self, from: bytes)
            guard incoming.version == 1, incoming.operation == "sync", incoming.deviceID == device else { throw FixtureFailure.unauthorized }
            var received: [UUID] = []
            for item in incoming.captures {
                let receipt = try await store.ingestCompanionCapture(.init(id: item.id, text: item.text, createdAt: item.createdAt), authenticatedDeviceID: device, now: now)
                received.append(receipt.id)
            }
            // Failure occurs after committed SQLite ingestion but before a receipt reaches the phone.
            if loseFirstReceipt { loseFirstReceipt = false; throw FixtureFailure.replyLost }
            let world = try await store.worldSnapshot(at: now)
            return try SyncCodec.encode(CompanionSyncProjection.make(world: world, deviceID: device, receivedIDs: received))
        }
        defer { server.stop() }
        let endpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: try #require(server.port))!)
        do {
            _ = try await CompanionTransportClient.exchange(configuration: configuration, payload: request, endpoint: endpoint, timeoutSeconds: 3)
            Issue.record("The synthetic lost receipt must not reach the client")
        } catch { }
        #expect(try await store.eventCount() == 1)
        #expect(try await store.queue().count == 1)

        let bytes = try await CompanionTransportClient.exchange(configuration: configuration, payload: request, endpoint: endpoint, timeoutSeconds: 3)
        let response = try SyncCodec.decode(SyncResponse.self, from: bytes)
        #expect(response.version == 1 && response.deviceID == device)
        #expect(response.receivedIDs == [capture.id])
        #expect(try await store.eventCount() == 1)
        #expect(try await store.queue().count == 1)
        let eventID = "companion:\(device.uuidString.lowercased()):\(capture.id.uuidString.lowercased())"
        let event = try #require(try await store.event(eventID))
        #expect(event.occurredAt == capture.createdAt)
        #expect(event.receivedAt == now)
        #expect(event.source.connector == "iphone_companion")
        #expect(event.source.account == device.uuidString.lowercased())
        #expect(try await store.search("bicycle").count == 1)
        #expect(try await store.indexStatus().pending == 1)
        // Offline age is preserved: searchable locally, excluded from live Jev/AI work.
        #expect(try await store.acquire(now: now) == nil)
        #expect(try await store.queue().first?.status == "outside_window")
    }
}
