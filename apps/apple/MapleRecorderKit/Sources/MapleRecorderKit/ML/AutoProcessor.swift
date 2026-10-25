#if !os(watchOS)
import Foundation
import Observation

/// Watches the recording store for unprocessed recordings and automatically
/// triggers the transcription/diarization/summarization pipeline.
@Observable
final class AutoProcessor {
    private(set) var processingIds: Set<UUID> = []

    private let store: RecordingStore
    private let modelManager: ModelManager
    private let settingsManager: SettingsManager
    private var watchTask: Task<Void, Never>?

    init(store: RecordingStore, modelManager: ModelManager, settingsManager: SettingsManager) {
        self.store = store
        self.modelManager = modelManager
        self.settingsManager = settingsManager
    }

    /// Begin watching the store for unprocessed recordings.
    func startWatching() {
        guard watchTask == nil else { return }
        watchTask = Task { [weak self] in
            // Small delay so initial load completes
            try? await Task.sleep(for: .seconds(2))
            await self?.processUnprocessed()
        }
    }

    func stopWatching() {
        watchTask?.cancel()
        watchTask = nil
    }

    /// Scan for any recording with audio but no transcript, and process it.
    func processUnprocessed() async {
        let unprocessed = store.recordings.filter {
            !$0.audioFiles.isEmpty && $0.transcript.isEmpty && !processingIds.contains($0.id)
        }
        for recording in unprocessed {
            await processRecording(recording)
        }
    }

    /// Force reprocess a recording regardless of whether it already has a transcript.
    func reprocess(_ recording: MapleRecording) async {
        await processRecording(recording)
    }

    private func processRecording(_ recording: MapleRecording) async {
        guard !processingIds.contains(recording.id) else { return }
        processingIds.insert(recording.id)
        defer { processingIds.remove(recording.id) }

        // Ensure models are ready
        if !modelManager.isReady {
            await modelManager.ensureModelsReady()
        }
        guard modelManager.isReady else { return }

        // Download audio files from iCloud if needed
        let audioURLs = recording.audioFiles.map {
            StorageLocation.recordingsURL.appendingPathComponent($0)
        }
        do {
            try await ICloudFileDownloader.ensureAllDownloaded(urls: audioURLs)
        } catch {
            print("AutoProcessor: Failed to download audio for \(recording.id): \(error)")
            return
        }

        // Run the processing pipeline
        let pipeline = modelManager.createPipeline()
        do {
            try await store.processRecording(
                recording,
                pipeline: pipeline,
                transcription: modelManager.transcriptionManager,
                diarization: modelManager.diarizationManager,
                summarizationProvider: settingsManager.preferredProvider
            )
        } catch {
            print("AutoProcessor: Processing failed for \(recording.id): \(error)")
        }
    }
}
#endif
