import Foundation
import MapleRecorderKit

/// Adapts the web bridge to the same local speech engine as the native recorder.
class TranscriptionService {
    static let shared = TranscriptionService()
    private let transcriber = LocalTranscriber()

    func initialize() async throws {
        try await transcriber.initialize()
    }

    func transcribe(audioFileURL: URL, onProgress: ((String) -> Void)? = nil) async throws -> String {
        onProgress?("Loading local speech model…")
        let text = try await transcriber.transcribeText(audioFileURL)
        onProgress?("Transcription complete")
        return text
    }

    // MARK: - Multi-Track Transcription

    struct TranscriptSegment: Codable {
        let speaker: Speaker
        let text: String
        let startTime: TimeInterval
        let endTime: TimeInterval

        enum Speaker: String, Codable {
            case microphone = "You"
            case system = "Other"
        }
    }

    struct MultiTrackTranscription: Codable {
        let segments: [TranscriptSegment]
        let duration: TimeInterval

        func toFormattedText() -> String {
            var output = ""
            for segment in segments {
                let timestamp = formatTime(segment.startTime)
                output += "[\(timestamp)] \(segment.speaker.rawValue): \(segment.text)\n"
            }
            return output
        }

        private func formatTime(_ time: TimeInterval) -> String {
            let minutes = Int(time) / 60
            let seconds = Int(time) % 60
            return String(format: "%02d:%02d", minutes, seconds)
        }
    }


    func transcribeMultiTrack(
        micAudioURL: URL,
        systemAudioURL: URL,
        startTime: Date,
        onProgress: ((String) -> Void)? = nil
    ) async throws -> MultiTrackTranscription {
        onProgress?("Transcribing microphone…")
        let mic = try await transcriber.transcribe(micAudioURL)
        onProgress?("Transcribing system audio…")
        let system = try await transcriber.transcribe(systemAudioURL)
        let segments = (mic.map {
            TranscriptSegment(speaker: .microphone, text: $0.text, startTime: $0.start, endTime: $0.end)
        } + system.map {
            TranscriptSegment(speaker: .system, text: $0.text, startTime: $0.start, endTime: $0.end)
        }).sorted { $0.startTime < $1.startTime }
        return MultiTrackTranscription(segments: segments, duration: segments.map(\.endTime).max() ?? 0)
    }
}
