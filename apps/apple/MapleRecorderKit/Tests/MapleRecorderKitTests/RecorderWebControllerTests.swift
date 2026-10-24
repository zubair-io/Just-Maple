import Foundation
import Testing
@testable import MapleRecorderKit

struct RecorderWebControllerTests {
    private func response(_ controller: RecorderWebController, _ request: [String: Any]) async throws -> [String: Any] {
        let data = try JSONSerialization.data(withJSONObject: request)
        let result = await controller.handle(data)
        return try #require(JSONSerialization.jsonObject(with: result) as? [String: Any])
    }

    @Test func rejectsUnknownCommandsAndPreservesRequestCorrelation() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let controller = RecorderWebController(session: RecorderSession(store: RecordingStore(directory: directory)), monitorsLibrary: false)
        let result = try await response(controller, ["requestId": "request-1", "operation": "arbitraryFileRead"])
        #expect(result["requestId"] as? String == "request-1")
        #expect(result["error"] as? String == "Invalid recorder request.")
        #expect(result["state"] == nil)
    }

    @Test func rejectsInvalidSegmentIndexesWithoutChangingRecording() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = RecordingStore(directory: directory)
        let recording = MapleRecording(title: "Original", audioFiles: [], duration: 10)
        try store.save(recording)
        let controller = RecorderWebController(session: RecorderSession(store: store), monitorsLibrary: false)
        let result = try await response(controller, ["requestId": "edit", "operation": "edit",
            "recordingId": recording.id.uuidString, "field": "segment", "segmentIndex": -1, "value": "changed"])
        #expect(result["error"] != nil)
        #expect(store.recordings.first?.title == "Original")
        #expect(store.recordings.first?.transcript.isEmpty == true)
    }

    @Test func rejectsScreenshotTraversalEvenIfMetadataContainsIt() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = RecordingStore(directory: directory)
        var recording = MapleRecording(title: "Screenshot", audioFiles: [], duration: 10)
        recording.screenshots = [TimelineScreenshot(fileName: "../private.jpg", timestamp: 0)]
        try store.save(recording)
        let controller = RecorderWebController(session: RecorderSession(store: store), monitorsLibrary: false)
        let result = try await response(controller, ["requestId": "image", "operation": "screenshot",
            "recordingId": recording.id.uuidString, "value": "../private.jpg"])
        #expect(result["error"] as? String == "Invalid recorder request.")
        #expect(result["image"] == nil)
    }

    @Test func rejectsMalformedRequestsAndNonUUIDRecordingIDs() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let controller = RecorderWebController(session: RecorderSession(store: RecordingStore(directory: directory)), monitorsLibrary: false)
        let malformed = await controller.handle(Data("not json".utf8))
        let result = try #require(JSONSerialization.jsonObject(with: malformed) as? [String: Any])
        #expect(result["error"] != nil)
        let invalidID = try await response(controller, ["requestId": "bad-id", "operation": "delete", "recordingId": "../other-file"])
        #expect(invalidID["requestId"] as? String == "bad-id")
        #expect(invalidID["error"] != nil)
    }
}
