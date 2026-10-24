#if !os(watchOS)
import AppIntents
import Foundation

struct RunPromptIntent: AppIntent {
    static var title: LocalizedStringResource = "Run Prompt"
    static var description: IntentDescription = "Applies a custom prompt to a recording's transcript."

    @Parameter(title: "Recording")
    var recording: RecordingEntity

    @Parameter(title: "Prompt Name")
    var promptName: String

    @Parameter(title: "Additional Context", default: nil)
    var additionalContext: String?

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let (prompt, transcript, speakers, provider) = try await MainActor.run {
            let store = RecordingStore()
            guard let found = store.recordings.first(where: { $0.id == recording.id }) else {
                throw IntentError.recordingNotFound
            }
            guard !found.transcript.isEmpty else {
                throw IntentError.noTranscript
            }

            let promptStore = PromptStore()
            guard let prompt = promptStore.prompts.first(where: { $0.name.lowercased() == promptName.lowercased() }) else {
                throw IntentError.promptNotFound
            }

            let settingsManager = SettingsManager()
            return (prompt, found.transcript, found.speakers, settingsManager.preferredProvider)
        }

        let result = try await PromptRunner.execute(
            prompt: prompt,
            additionalContext: additionalContext,
            transcript: transcript,
            speakers: speakers,
            provider: provider
        )

        return .result(value: result.result)
    }
}
#endif
