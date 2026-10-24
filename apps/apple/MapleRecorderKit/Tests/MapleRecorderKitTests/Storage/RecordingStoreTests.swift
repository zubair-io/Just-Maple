import Testing
import Foundation
@testable import MapleRecorderKit

struct RecordingStoreTests {

    private func makeTempDirectory() throws -> URL {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("MapleRecorderTests-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        return tempDir
    }

    private func cleanup(_ url: URL) {
        try? FileManager.default.removeItem(at: url)
    }

    @Test func saveAndLoad() async throws {
        let dir = try makeTempDirectory()
        defer { cleanup(dir) }

        let store = RecordingStore(directory: dir)
        let recording = MapleRecording(
            title: "Test Recording",
            summary: "A test",
            audioFiles: ["test.m4a"],
            duration: 60.0
        )

        try store.save(recording)
        #expect(store.recordings.count == 1)
        #expect(store.recordings[0].title == "Test Recording")

        // Create a new store from the same directory to verify persistence.
        // `reload()` runs the disk read off the main thread, so await it.
        let store2 = RecordingStore(directory: dir)
        await store2.reload()
        #expect(store2.recordings.count == 1)
        #expect(store2.recordings[0].id == recording.id)
        #expect(store2.recordings[0].title == "Test Recording")
    }

    @Test func deleteRemovesFile() throws {
        let dir = try makeTempDirectory()
        defer { cleanup(dir) }

        let store = RecordingStore(directory: dir)
        let recording = MapleRecording(
            title: "To Delete",
            audioFiles: ["delete.m4a"],
            duration: 10.0
        )

        try store.save(recording)
        #expect(store.recordings.count == 1)

        try store.delete(recording)
        #expect(store.recordings.isEmpty)

        // Verify file is gone
        let mdPath = dir.appendingPathComponent("\(recording.id.uuidString).md").path()
        #expect(!FileManager.default.fileExists(atPath: mdPath))
    }

    @Test func saveLoadsAndDeletesNotesSidecar() async throws {
        let dir = try makeTempDirectory()
        defer { cleanup(dir) }

        let segment = TranscriptSegment(
            speakerId: "s0",
            start: 0,
            end: 2,
            text: "um hello world",
            words: []
        )
        let recording = MapleRecording(
            title: "Clean Notes",
            notes: "Speaker 1: Hello, world.",
            transcript: [segment]
        )
        let store = RecordingStore(directory: dir)
        try store.save(recording)

        let notesURL = dir.appendingPathComponent("\(recording.id.uuidString).notes.md")
        #expect(FileManager.default.fileExists(atPath: notesURL.path(percentEncoded: false)))
        try "# Clean Notes — Notes\n\nSpeaker 1: Edited outside Maple.\n"
            .write(to: notesURL, atomically: true, encoding: .utf8)

        let reloadedStore = RecordingStore(directory: dir)
        await reloadedStore.reload()
        #expect(reloadedStore.recordings.count == 1)
        #expect(reloadedStore.recordings[0].notes == "Speaker 1: Edited outside Maple.")

        try reloadedStore.delete(reloadedStore.recordings[0])
        #expect(!FileManager.default.fileExists(atPath: notesURL.path(percentEncoded: false)))
    }

    /// Regression: the iCloud container path ("…/Mobile Documents/…") contains a
    /// space. `URL.path()` percent-encodes it to "%20", and on macOS
    /// `FileManager.fileExists(atPath:)` then treats that literally and fails — so
    /// audio files were reported missing even though they were present on disk
    /// (the "Audio file not found" transcription error). Every FileManager path
    /// lookup in the storage/audio layers must therefore use the *decoded* path.
    ///
    /// This locks the contract the fix relies on: `path()` encodes the space,
    /// `path(percentEncoded: false)` does not. If a call site ever drops the
    /// argument and reverts to `path()`, it reintroduces the bug on macOS.
    @Test func storagePathsMustBeDecodedNotPercentEncoded() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("Mobile Documents \(UUID().uuidString)")
        let audioURL = dir.appendingPathComponent("clip.m4a")

        let encoded = audioURL.path()                      // what URL.path() yields
        let decoded = audioURL.path(percentEncoded: false) // what FileManager needs

        #expect(encoded.contains("%20"), "URL.path() should percent-encode the space")
        #expect(!decoded.contains("%20"), "decoded path must not contain %20")
        #expect(decoded.contains("Mobile Documents "), "decoded path must contain the literal space")
    }

    /// Integration smoke test: deleting a recording whose files live under a
    /// spaced path actually removes the audio file (exercises the decoded-path
    /// lookups in `RecordingStore.delete`).
    @Test func deleteRemovesAudioInPathWithSpaces() throws {
        let parent = FileManager.default.temporaryDirectory
            .appendingPathComponent("Mobile Documents \(UUID().uuidString)")
        let dir = parent.appendingPathComponent("recordings")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { cleanup(parent) }

        let store = RecordingStore(directory: dir)
        let recording = MapleRecording(
            title: "Spaced Path",
            audioFiles: ["spaced.m4a"],
            duration: 10.0
        )
        try store.save(recording)

        let audioURL = dir.appendingPathComponent("spaced.m4a")
        FileManager.default.createFile(atPath: audioURL.path(percentEncoded: false), contents: Data([0x00]))
        #expect(FileManager.default.fileExists(atPath: audioURL.path(percentEncoded: false)))

        try store.delete(recording)

        // The audio file must actually be removed, not silently skipped.
        #expect(!FileManager.default.fileExists(atPath: audioURL.path(percentEncoded: false)))
    }

    @Test func deleteRemovesTimelineScreenshots() throws {
        let dir = try makeTempDirectory()
        defer { cleanup(dir) }

        let screenshot = TimelineScreenshot(fileName: "frame.jpg", timestamp: 5)
        let recording = MapleRecording(title: "With Timeline", screenshots: [screenshot])
        let screenshotURL = dir.appendingPathComponent(screenshot.fileName)
        FileManager.default.createFile(
            atPath: screenshotURL.path(percentEncoded: false),
            contents: Data([0xFF, 0xD8, 0xFF])
        )
        let store = RecordingStore(directory: dir)
        try store.save(recording)

        try store.delete(recording)

        #expect(!FileManager.default.fileExists(atPath: screenshotURL.path(percentEncoded: false)))
    }

    @Test func emptyDirectoryReturnsEmpty() throws {
        let dir = try makeTempDirectory()
        defer { cleanup(dir) }

        let store = RecordingStore(directory: dir)
        #expect(store.recordings.isEmpty)
    }

    @Test func multipleRecordingsSortedByDateDescending() throws {
        let dir = try makeTempDirectory()
        defer { cleanup(dir) }

        let store = RecordingStore(directory: dir)

        let older = MapleRecording(
            title: "Older",
            audioFiles: ["old.m4a"],
            duration: 30.0,
            createdAt: Date(timeIntervalSince1970: 1000)
        )
        let newer = MapleRecording(
            title: "Newer",
            audioFiles: ["new.m4a"],
            duration: 30.0,
            createdAt: Date(timeIntervalSince1970: 2000)
        )

        try store.save(older)
        try store.save(newer)

        #expect(store.recordings.count == 2)
        #expect(store.recordings[0].title == "Newer")
        #expect(store.recordings[1].title == "Older")
    }
}
