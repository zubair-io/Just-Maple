#if !os(watchOS)
import Foundation
import Observation

enum ModelDownloadStep: String, Sendable {
    case idle = ""
    case downloadingASR = "Downloading speech model…"
    case downloadingDiarization = "Downloading speaker model…"
    case downloadingS1 = "Downloading S1-mini by Superwhisper…"
    case loadingASR = "Loading speech model…"
    case loadingDiarization = "Loading speaker model…"
    case loadingS1 = "Loading S1-mini by Superwhisper…"
    case compilingModels = "Compiling models…"
    case ready = "Models ready"
    case failed = "Download failed"
}

@Observable
final class ModelManager {
    var isReady = false
    var isDownloading = false
    var downloadStep: ModelDownloadStep = .idle
    var downloadProgress: Double = 0 // 0.0 to 1.0
    var error: String?

    let transcriptionManager = TranscriptionManager()
    let diarizationManager = DiarizationManager()
    let textNormalizer = S1TextNormalizer()

    func ensureModelsReady() async {
        guard !isReady else { return }
        isDownloading = true
        error = nil
        downloadProgress = 0

        let asrCached = transcriptionManager.isModelReady
        let diarCached = diarizationManager.isModelReady
        let s1Cached = textNormalizer.isModelReady

        do {
            // Step 1: ASR model
            downloadStep = asrCached ? .loadingASR : .downloadingASR
            downloadProgress = 0.05
            try await transcriptionManager.initialize()
            downloadProgress = 0.45

            // Step 2: Diarization model
            downloadStep = diarCached ? .loadingDiarization : .downloadingDiarization
            downloadProgress = 0.5
            try await diarizationManager.initialize()
            downloadProgress = 0.72

            // Step 3: S1 transcript normalizer (4-bit MLX, downloaded on-device)
            downloadStep = s1Cached ? .loadingS1 : .downloadingS1
            downloadProgress = 0.75
            try await textNormalizer.initialize()
            downloadProgress = 0.95

            // Step 4: Done
            downloadStep = .ready
            downloadProgress = 1.0
            isReady = true
        } catch {
            downloadStep = .failed
            self.error = error.localizedDescription
        }

        isDownloading = false
    }

    func createPipeline() -> ProcessingPipeline {
        ProcessingPipeline(textNormalizer: textNormalizer)
    }
}
#endif
