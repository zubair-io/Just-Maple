import AppIntents
import Foundation

struct GetTranscriptIntent: AppIntent {
    static var title: LocalizedStringResource = "Get Transcript"
    static var description: IntentDescription = "Returns the transcript text for a recording."

    @Parameter(title: "Recording")
    var recording: RecordingEntity

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let text: String = try await MainActor.run {
            let store = RecordingStore()
            guard let found = store.recordings.first(where: { $0.id == recording.id }) else {
                throw IntentError.recordingNotFound
            }

            return found.transcript.map { segment in
                let speaker = found.speakers.first { $0.id == segment.speakerId }?.displayName ?? segment.speakerId
                return "[\(speaker)] \(segment.text)"
            }.joined(separator: "\n")
        }

        return .result(value: text)
    }
}

enum IntentError: Error, CustomLocalizedStringResourceConvertible {
    case recordingNotFound
    case promptNotFound
    case noTranscript

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .recordingNotFound: "Recording not found."
        case .promptNotFound: "Prompt not found."
        case .noTranscript: "This recording has no transcript yet."
        }
    }
}
