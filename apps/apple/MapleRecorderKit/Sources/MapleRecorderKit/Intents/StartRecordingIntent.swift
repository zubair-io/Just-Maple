import AppIntents
import Foundation

struct StartRecordingIntent: AppIntent {
    static var title: LocalizedStringResource = "Start Recording"
    static var description: IntentDescription = "Begins a new audio recording in Maple Recorder."
    static var openAppWhenRun = true

    func perform() async throws -> some IntentResult {
        try await RecorderWebController.shared.performShortcut(start: true)
        return .result()
    }
}

extension Notification.Name {
    static let startRecordingFromIntent = Notification.Name("com.maple.startRecording")
    static let stopRecordingFromIntent = Notification.Name("com.maple.stopRecording")
}

// Keep a cold-launch request until the host has mounted the Recorder area.
enum RecorderIntentRequests {
    static var shouldStart = false
}
