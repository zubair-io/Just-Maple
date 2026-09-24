import Foundation
import Testing
@testable import MapleCore

struct CompanionIngestionTests {
    let now = Date(timeIntervalSince1970: 1_800_000_000)

    @Test func replaySurvivesRestartAndQueuesExactlyOnce() async throws {
        let path = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
        defer { for suffix in ["", "-wal", "-shm"] { try? FileManager.default.removeItem(atPath: path + suffix) } }
        let device = UUID(), capture = CompanionObservation(id: UUID(), text: "Fixture: pick up the repaired bicycle", createdAt: now.addingTimeInterval(-60))
        let receipt: CompanionReceipt
        do {
            let store = try KnowledgeStore(path: path)
            receipt = try await store.ingestCompanionCapture(capture, authenticatedDeviceID: device, now: now)
        }
        let store = try KnowledgeStore(path: path)
        let replay = try await store.ingestCompanionCapture(capture, authenticatedDeviceID: device, now: now.addingTimeInterval(120))
        #expect(receipt == replay)
        #expect(try await store.eventCount() == 1)
        #expect(try await store.queue().count == 1)
        let event = try #require(try await store.event(receipt.eventID))
        #expect(event.occurredAt == capture.createdAt)
        #expect(event.receivedAt == now)
        #expect(event.subjects == ["person:self"])
        #expect(event.source.account == device.uuidString.lowercased())
        #expect(event.source.externalID == capture.id.uuidString.lowercased())
        #expect(event.id == event.id.lowercased())
        #expect(try await store.search("bicycle").count == 1)
        let db = try SQLite(path: path)
        #expect(try db.rows("SELECT * FROM embedding_jobs").count == 1)
    }

    @Test func alteredReplayRejectsTextAndTimestampButDevicesAreIndependent() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let device = UUID(), id = UUID()
        let capture = CompanionObservation(id: id, text: "Fixture original", createdAt: now)
        let first = try await store.ingestCompanionCapture(capture, authenticatedDeviceID: device, now: now)
        for changed in [CompanionObservation(id: id, text: "Fixture changed", createdAt: now), CompanionObservation(id: id, text: capture.text, createdAt: now.addingTimeInterval(0.001))] {
            do { _ = try await store.ingestCompanionCapture(changed, authenticatedDeviceID: device, now: now); Issue.record("Accepted changed capture ID reuse") } catch {}
        }
        #expect(try await store.eventCount() == 1)
        let other = try await store.ingestCompanionCapture(capture, authenticatedDeviceID: UUID(), now: now)
        #expect(first.eventID != other.eventID)
        #expect(try await store.eventCount() == 2)
        #expect(try await store.queue().count == 2)
    }

    @Test func invalidPayloadsCannotCreateDurableWork() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let device = UUID()
        for (text, date) in [(" \n\t", now), (String(repeating: "é", count: 8193), now), ("Fixture", now.addingTimeInterval(301)), ("Fixture", Date(timeIntervalSinceReferenceDate: .infinity))] {
            do { _ = try await store.ingestCompanionCapture(CompanionObservation(id: UUID(), text: text, createdAt: date), authenticatedDeviceID: device, now: now); Issue.record("Accepted invalid capture") } catch {}
        }
        let invalidID = Data(#"{"id":"not-a-uuid","text":"Fixture","createdAt":0}"#.utf8)
        do { _ = try JSONCodec.decode(CompanionObservation.self, from: invalidID); Issue.record("Accepted malformed UUID") } catch {}
        #expect(try await store.eventCount() == 0)
        #expect(try await store.queue().isEmpty)
    }

    @Test func oldOfflineCapturePreservesSourceDateAndBoundarySizeIsAccepted() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let capture = CompanionObservation(id: UUID(), text: String(repeating: "é", count: 8192), createdAt: now.addingTimeInterval(-90 * 86400))
        let receipt = try await store.ingestCompanionCapture(capture, authenticatedDeviceID: UUID(), now: now)
        let event = try #require(try await store.event(receipt.eventID))
        #expect(event.occurredAt == capture.createdAt)
        #expect(event.receivedAt == now)
        #expect(try await store.queue().count == 1)
    }
}
