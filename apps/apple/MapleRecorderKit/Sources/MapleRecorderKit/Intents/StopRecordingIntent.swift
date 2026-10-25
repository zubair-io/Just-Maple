import AppIntents
import Foundation

struct StopRecordingIntent: AppIntent {
    static var title: LocalizedStringResource = "Stop Recording"
    static var description: IntentDescription = "Stops the current recording and triggers processing."
    static var openAppWhenRun = true

    func perform() async throws -> some IntentResult {
        try await RecorderWebController.shared.performShortcut(start: false)
        return .result()
    }
}
