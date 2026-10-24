#if !os(watchOS)
import FluidAudio
import Foundation
import Observation

enum ProcessingState: Sendable {
    case idle
    case converting
    case transcribing
    case merging
    case normalizing
    case summarizing
    case complete
    case failed(String)
}

/// MainActor-isolated (the project default, `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor`).
/// `state`/`progress` are `@Observable` and read by SwiftUI, so they must only ever be
/// mutated on the main actor — making the whole class `nonisolated` would let those
/// mutations resume off-main after an `await` (SwiftUI undefined behavior).
///
/// The heavy CPU work that would otherwise freeze the UI — `loadAndResample`,
/// `mixSamples`, and `TranscriptMerger` over millions of samples — is offloaded to a
/// background GCD queue via `runOffMain`, not by un-isolating the class. The remaining
/// main-actor work (orchestration plus the O(tokens) result mapping) is cheap.
@Observable
final class ProcessingPipeline {
    var state: ProcessingState = .idle
    var progress: String = ""

    private let textNormalizer: S1TextNormalizer

    init(textNormalizer: S1TextNormalizer) {
        self.textNormalizer = textNormalizer
    }

    func process(
        audioURLs: [URL],
        systemAudioURLs: [URL] = [],
        transcriptionManager: TranscriptionManager,
        diarizationManager: DiarizationManager,
        summarizationProvider: LLMProvider = .none
    ) async throws -> (segments: [TranscriptSegment], speakers: [Speaker], summary: String, notes: String, generatedTitle: String, tags: [String]) {
        do {
            state = .converting
            progress = "Converting audio…"

            // Run blocking audio conversion off the main thread (GCD global queue —
            // see `runOffMain`; `Task.detached` is not reliably off-main here).
            let capturedAudioURLs = audioURLs
            let capturedSystemURLs = systemAudioURLs
            let (micSamples, systemSamples) = try await runOffMain { () -> ([Float], [Float]) in
                let mic: [Float]
                if capturedAudioURLs.count == 1 {
                    mic = try MapleAudioConverter.loadAndResample(url: capturedAudioURLs[0])
                } else {
                    mic = try MapleAudioConverter.loadAndResampleChunks(urls: capturedAudioURLs)
                }
                let sys: [Float] = capturedSystemURLs.isEmpty
                    ? []
                    : try MapleAudioConverter.loadAndResampleChunks(urls: capturedSystemURLs)
                return (mic, sys)
            }

            state = .transcribing
            progress = "Transcribing…"

            let asrSegments: [RawASRSegment]
            let diaSegments: [RawDiarizationSegment]

            if systemSamples.isEmpty {
                // Mic-only path — same as before
                async let asrResult = transcriptionManager.transcribe(micSamples)
                async let diaResult = diarizationManager.diarize(micSamples)

                let (asr, dia) = try await (asrResult, diaResult)
                asrSegments = mapASRResult(asr)
                diaSegments = mapDiarizationResult(dia)
            } else {
                // Two-track path: mix for ASR, diarize each track independently.
                // Mixing iterates millions of samples — keep it off the main thread.
                let combinedSamples = try await runOffMain {
                    MapleAudioConverter.mixSamples(micSamples, systemSamples)
                }

                async let asrResult = transcriptionManager.transcribe(combinedSamples)
                async let micDiaResult = diarizationManager.diarize(micSamples)
                async let sysDiaResult = diarizationManager.diarize(systemSamples)

                let (asr, micDia, sysDia) = try await (asrResult, micDiaResult, sysDiaResult)

                asrSegments = mapASRResult(asr)

                // Namespace speaker IDs so mic and system speakers never merge
                let micDiaSegments = mapDiarizationResult(micDia).map { seg in
                    RawDiarizationSegment(speakerId: "mic_\(seg.speakerId)", start: seg.start, end: seg.end)
                }
                let sysDiaSegments = mapDiarizationResult(sysDia).map { seg in
                    RawDiarizationSegment(speakerId: "sys_\(seg.speakerId)", start: seg.start, end: seg.end)
                }
                diaSegments = micDiaSegments + sysDiaSegments
            }

            state = .merging
            progress = "Aligning transcript…"

            let merged = try await runOffMain {
                TranscriptMerger.merge(asrSegments: asrSegments, diarizationSegments: diaSegments)
            }

            state = .normalizing
            progress = "Cleaning transcript with S1-mini by Superwhisper…"
            let notes = try await textNormalizer.normalize(
                transcript: merged.segments,
                speakers: merged.speakers
            ) { completed, total in
                self.progress = "Cleaning transcript with S1-mini by Superwhisper… \(completed)/\(total)"
            }

            // Summarize and generate title if provider is configured
            var summary = ""
            var generatedTitle = ""
            var tags: [String] = []
            if summarizationProvider != .none {
                state = .summarizing
                progress = "Generating summary…"
                let result = (try? await Summarizer.summarize(
                    transcript: merged.segments,
                    speakers: merged.speakers,
                    provider: summarizationProvider
                )) ?? SummaryResult(title: "", tags: [], summary: "")
                generatedTitle = result.title
                tags = result.tags
                summary = result.summary
            }

            state = .complete
            progress = ""
            return (
                segments: merged.segments,
                speakers: merged.speakers,
                summary: summary,
                notes: notes,
                generatedTitle: generatedTitle,
                tags: tags
            )
        } catch {
            state = .failed(error.localizedDescription)
            progress = ""
            throw error
        }
    }

    // MARK: - Off-main execution

    /// Runs CPU-bound work on a GCD global queue and awaits the result.
    ///
    /// The project builds with `SWIFT_APPROACHABLE_CONCURRENCY = YES`, under which
    /// `nonisolated`/`Task.detached` async work can still run on the main actor's
    /// executor. A GCD global queue never runs on the main thread, so this reliably
    /// keeps heavy synchronous work (audio resampling, mixing, transcript merge) off
    /// the UI thread. Confirmed via a main-thread `sample` that showed resampling
    /// pegging the main thread from inside a `Task.detached` block.
    nonisolated private func runOffMain<T: Sendable>(_ work: @Sendable @escaping () throws -> T) async throws -> T {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    continuation.resume(returning: try work())
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    // MARK: - FluidAudio Result Mapping

    private func mapASRResult(_ result: ASRResult) -> [RawASRSegment] {
        // ASRResult provides tokenTimings for word-level timing.
        // Group tokens into sentence-like segments by punctuation or fixed chunks.
        guard let timings = result.tokenTimings, !timings.isEmpty else {
            // Fallback: single segment from full text with duration
            guard !result.text.isEmpty else { return [] }
            return [RawASRSegment(text: result.text, start: 0, end: result.duration)]
        }

        // Group tokens into segments split at sentence-ending punctuation
        var segments: [RawASRSegment] = []
        var currentTokens: [TokenTiming] = []

        for token in timings {
            currentTokens.append(token)
            let trimmed = token.token.trimmingCharacters(in: .whitespaces)
            let isSentenceEnd = trimmed.hasSuffix(".") || trimmed.hasSuffix("?")
                || trimmed.hasSuffix("!")

            if isSentenceEnd && !currentTokens.isEmpty {
                let text = currentTokens.map(\.token).joined()
                    .replacingOccurrences(of: "  ", with: " ")
                    .trimmingCharacters(in: .whitespaces)
                let start = currentTokens.first!.startTime
                let end = currentTokens.last!.endTime
                segments.append(RawASRSegment(text: text, start: start, end: end))
                currentTokens = []
            }
        }

        // Remaining tokens form a final segment
        if !currentTokens.isEmpty {
            let text = currentTokens.map(\.token).joined(separator: " ")
                .trimmingCharacters(in: .whitespaces)
            let start = currentTokens.first!.startTime
            let end = currentTokens.last!.endTime
            segments.append(RawASRSegment(text: text, start: start, end: end))
        }

        return segments
    }

    private func mapDiarizationResult(_ result: DiarizationResult) -> [RawDiarizationSegment] {
        result.segments.map { segment in
            RawDiarizationSegment(
                speakerId: segment.speakerId,
                start: TimeInterval(segment.startTimeSeconds),
                end: TimeInterval(segment.endTimeSeconds)
            )
        }
    }
}
#endif
