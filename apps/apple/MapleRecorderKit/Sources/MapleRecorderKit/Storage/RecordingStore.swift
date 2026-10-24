import Foundation
import Observation

@Observable
final class RecordingStore {
    var recordings: [MapleRecording] = []

    /// True while a reload is in flight. `hasLoadedOnce` becomes true after the
    /// first load completes — the UI uses it to show a loading state instead of the
    /// empty "No Recordings" view before recordings have finished loading from disk.
    private(set) var isLoading = false
    private(set) var hasLoadedOnce = false

    /// Set by quick record to tell the main UI which recording to select.
    var pendingSelectionId: UUID?

    private let fileManager = FileManager.default

    /// Bumped on every in-memory mutation (`save`/`delete`). A reload that started
    /// before a mutation must not clobber the newer in-memory state with its stale
    /// disk snapshot — see `reload()`.
    private var mutationGeneration = 0

    init() {
        StorageLocation.migrateLocalToICloudIfNeeded()
        try? StorageLocation.ensureDirectoryExists()
        loadRecordings()
    }

    // For testing with a custom directory. Does not auto-load — tests call
    // `await reload()` explicitly so loading is deterministic (the async reload
    // would otherwise race with synchronous `save` calls in the same test).
    init(directory: URL) {
        self.overrideDirectory = directory
        if !fileManager.fileExists(atPath: directory.path(percentEncoded: false)) {
            try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        }
    }

    private var overrideDirectory: URL?

    private var recordingsURL: URL {
        overrideDirectory ?? StorageLocation.recordingsURL
    }

    /// Trigger a reload. Fire-and-forget; the heavy work runs off the main thread.
    func loadRecordings() {
        Task { await reload() }
    }

    /// Reload recordings from disk. Directory scan, file reads, and JSON
    /// deserialization run off the main thread — the on-disk library can be tens of
    /// MB across many files, and doing this on the main actor (at launch and on every
    /// iCloud change via `ICloudSyncMonitor`) freezes the UI. Only the final
    /// assignment to `recordings` happens back on the main actor.
    func reload() async {
        let url = recordingsURL
        isLoading = true
        defer {
            isLoading = false
            hasLoadedOnce = true
        }
        while true {
            let generation = mutationGeneration
            // GCD global queue rather than `Task.detached`: under
            // `SWIFT_APPROACHABLE_CONCURRENCY` a detached task can still run on the
            // main actor's executor, which would put this disk scan/JSON decode back
            // on the UI thread. A global queue is reliably off-main — same reasoning
            // as `ProcessingPipeline.runOffMain`.
            let loaded = await Self.readOffMain(at: url)
            // If a save/delete raced with the read, its newer state would be lost by
            // assigning this snapshot. Re-read (disk now reflects the mutation) until
            // no mutation occurs during the read.
            if mutationGeneration == generation {
                recordings = loaded
                return
            }
        }
    }

    /// Runs the synchronous disk read on a GCD global queue and awaits the result,
    /// guaranteeing it stays off the main thread (see `reload()`).
    nonisolated private static func readOffMain(at url: URL) async -> [MapleRecording] {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                continuation.resume(returning: readRecordingsFromDisk(at: url))
            }
        }
    }

    nonisolated private static func readRecordingsFromDisk(at recordingsURL: URL) -> [MapleRecording] {
        let fileManager = FileManager.default
        guard let files = try? fileManager.contentsOfDirectory(
            at: recordingsURL,
            includingPropertiesForKeys: [.contentModificationDateKey, .ubiquitousItemDownloadingStatusKey],
            options: .skipsHiddenFiles
        ) else {
            return []
        }

        let mdFiles = files.filter {
            $0.pathExtension == "md" && !$0.lastPathComponent.hasSuffix(".notes.md")
        }

        return mdFiles
            .compactMap { url -> MapleRecording? in
                // Skip iCloud placeholders — don't block waiting for download
                if !ICloudFileDownloader.isDownloaded(url: url) {
                    // Kick off download in background; ICloudSyncMonitor will
                    // trigger a reload once the file arrives.
                    try? fileManager.startDownloadingUbiquitousItem(at: url)
                    return nil
                }
                guard let data = try? Data(contentsOf: url),
                      let markdown = String(data: data, encoding: .utf8) else {
                    return nil
                }
                guard var recording = MarkdownSerializer.deserialize(markdown) else {
                    return nil
                }

                // The sidecar is deliberately editable outside Maple. Prefer it over
                // the duplicated metadata value when it is locally available.
                let notesURL = recordingsURL.appendingPathComponent("\(recording.id.uuidString).notes.md")
                if fileManager.fileExists(atPath: notesURL.path(percentEncoded: false)) {
                    if ICloudFileDownloader.isDownloaded(url: notesURL),
                       let notesMarkdown = try? String(contentsOf: notesURL, encoding: .utf8) {
                        recording.notes = MarkdownSerializer.deserializeNotes(notesMarkdown)
                    } else {
                        try? fileManager.startDownloadingUbiquitousItem(at: notesURL)
                    }
                }
                return recording
            }
            .sorted { $0.createdAt > $1.createdAt }
    }

    func save(_ recording: MapleRecording) throws {
        let markdown = MarkdownSerializer.serialize(recording)
        let fileURL = recordingsURL.appendingPathComponent("\(recording.id.uuidString).md")
        try markdown.write(to: fileURL, atomically: true, encoding: .utf8)

        // Once transcription has run, always keep the companion file present. An
        // empty S1 result is valid for filler-only audio and is still persisted.
        if !recording.transcript.isEmpty || !recording.notes.isEmpty {
            let notesMarkdown = MarkdownSerializer.serializeNotes(recording)
            let notesURL = recordingsURL.appendingPathComponent("\(recording.id.uuidString).notes.md")
            try notesMarkdown.write(to: notesURL, atomically: true, encoding: .utf8)
        }

        if let index = recordings.firstIndex(where: { $0.id == recording.id }) {
            recordings[index] = recording
        } else {
            recordings.append(recording)
            recordings.sort { $0.createdAt > $1.createdAt }
        }
        mutationGeneration += 1
    }

    func delete(_ recording: MapleRecording) throws {
        let mdURL = recordingsURL.appendingPathComponent("\(recording.id.uuidString).md")
        if fileManager.fileExists(atPath: mdURL.path(percentEncoded: false)) {
            try fileManager.removeItem(at: mdURL)
        }

        let notesURL = recordingsURL.appendingPathComponent("\(recording.id.uuidString).notes.md")
        if fileManager.fileExists(atPath: notesURL.path(percentEncoded: false)) {
            try fileManager.removeItem(at: notesURL)
        }

        for audioFile in recording.audioFiles {
            let audioURL = recordingsURL.appendingPathComponent(audioFile)
            if fileManager.fileExists(atPath: audioURL.path(percentEncoded: false)) {
                try fileManager.removeItem(at: audioURL)
            }
        }

        for audioFile in recording.systemAudioFiles {
            let audioURL = recordingsURL.appendingPathComponent(audioFile)
            if fileManager.fileExists(atPath: audioURL.path(percentEncoded: false)) {
                try fileManager.removeItem(at: audioURL)
            }
        }

        for screenshot in recording.screenshots {
            let screenshotURL = recordingsURL.appendingPathComponent(screenshot.fileName)
            if fileManager.fileExists(atPath: screenshotURL.path(percentEncoded: false)) {
                try fileManager.removeItem(at: screenshotURL)
            }
        }

        recordings.removeAll { $0.id == recording.id }
        mutationGeneration += 1
    }

    func update(_ recording: MapleRecording) throws {
        var updated = recording
        updated.modifiedAt = Date()
        try save(updated)
    }

    #if !os(watchOS)
    func processRecording(
        _ recording: MapleRecording,
        pipeline: ProcessingPipeline,
        transcription: TranscriptionManager,
        diarization: DiarizationManager,
        summarizationProvider: LLMProvider = .none
    ) async throws {
        let audioURLs = recording.audioFiles.map { recordingsURL.appendingPathComponent($0) }
        let systemAudioURLs = recording.systemAudioFiles.map { recordingsURL.appendingPathComponent($0) }
        let result = try await pipeline.process(
            audioURLs: audioURLs,
            systemAudioURLs: systemAudioURLs,
            transcriptionManager: transcription,
            diarizationManager: diarization,
            summarizationProvider: summarizationProvider
        )
        var updated = recording
        updated.transcript = result.segments
        updated.speakers = result.speakers
        updated.summary = result.summary
        updated.notes = result.notes
        updated.tags = result.tags
        if !result.generatedTitle.isEmpty {
            updated.title = Self.stripMarkdown(result.generatedTitle)
        }
        updated.modifiedAt = Date()
        try save(updated)
    }
    #endif

    /// Strips common markdown formatting from a title string.
    static func stripMarkdown(_ text: String) -> String {
        var result = text.trimmingCharacters(in: .whitespacesAndNewlines)
        // Remove leading heading markers (### Title → Title)
        while result.hasPrefix("#") {
            result = String(result.dropFirst())
        }
        result = result.trimmingCharacters(in: .whitespaces)
        // Remove bold/italic markers (**text** → text, *text* → text)
        result = result.replacingOccurrences(of: "**", with: "")
        result = result.replacingOccurrences(of: "__", with: "")
        // Only strip single * or _ if they appear as wrapping pairs
        if result.hasPrefix("*") && result.hasSuffix("*") && result.count > 2 {
            result = String(result.dropFirst().dropLast())
        }
        if result.hasPrefix("_") && result.hasSuffix("_") && result.count > 2 {
            result = String(result.dropFirst().dropLast())
        }
        // Remove surrounding quotes
        if result.hasPrefix("\"") && result.hasSuffix("\"") && result.count > 2 {
            result = String(result.dropFirst().dropLast())
        }
        return result.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
