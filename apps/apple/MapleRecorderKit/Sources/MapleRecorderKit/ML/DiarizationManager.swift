#if !os(watchOS)
import FluidAudio
import Foundation
import Observation

// `nonisolated` so FluidAudio diarization runs off the main actor (the project
// defaults unmarked types to `@MainActor`, which would block the UI).
@Observable
nonisolated final class DiarizationManager {
    var isModelReady = false
    var isDiarizing = false

    private var diarizer: OfflineDiarizerManager?

    func initialize() async throws {
        let config = OfflineDiarizerConfig()
        let manager = OfflineDiarizerManager(config: config)
        try await manager.prepareModels()
        self.diarizer = manager
        self.isModelReady = true
    }

    func diarize(_ samples: [Float]) async throws -> DiarizationResult {
        isDiarizing = true
        defer { isDiarizing = false }
        guard let diarizer else {
            throw TranscriptionError.notInitialized
        }
        return try await diarizer.process(audio: samples)
    }
}
#endif
