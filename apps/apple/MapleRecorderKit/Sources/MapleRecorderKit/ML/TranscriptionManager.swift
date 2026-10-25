#if !os(watchOS)
import FluidAudio
import Foundation
import Observation

enum TranscriptionError: Error, Sendable {
    case notInitialized
}

// `nonisolated` so FluidAudio ASR inference runs off the main actor (the project
// defaults unmarked types to `@MainActor`, which would block the UI).
@Observable
nonisolated final class TranscriptionManager {
    var isModelReady = false
    var isTranscribing = false

    private var asrManager: AsrManager?

    func initialize() async throws {
        let models: AsrModels
        if try await AsrModels.isModelValid(version: .v3) {
            models = try await AsrModels.loadFromCache(version: .v3)
        } else {
            models = try await AsrModels.downloadAndLoad(version: .v3)
        }
        let manager = AsrManager(config: .default)
        try await manager.loadModels(models)
        self.asrManager = manager
        self.isModelReady = true
    }

    func transcribe(_ samples: [Float]) async throws -> ASRResult {
        isTranscribing = true
        defer { isTranscribing = false }
        guard let manager = asrManager else { throw TranscriptionError.notInitialized }
        return try await manager.transcribe(samples)
    }
}
#endif
