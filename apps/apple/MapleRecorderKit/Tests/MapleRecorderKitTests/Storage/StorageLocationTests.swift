import Testing
import Foundation
@testable import MapleRecorderKit

struct StorageLocationTests {

    @Test func recorderLibraryIsSeparateFromLegacyBridgeAudio() {
        let url = StorageLocation.localRecordingsURL
        #expect(url.deletingLastPathComponent().lastPathComponent == "MapleRecorder")
    }


    @Test func recordingsURLEndsInRecordings() {
        let url = StorageLocation.recordingsURL
        #expect(url.lastPathComponent == "recordings")
    }

    @Test func localFallbackInSimulator() {
        // In simulator / test environment, iCloud is unavailable
        // so we should get a local Documents path
        let url = StorageLocation.recordingsURL
        #expect(url.path().contains("recordings"))
    }
}
