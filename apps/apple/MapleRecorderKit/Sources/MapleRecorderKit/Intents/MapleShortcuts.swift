import AppIntents

struct MapleShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartRecordingIntent(),
            phrases: [
                "Start a \(.applicationName) recording",
                "Start recording with \(.applicationName)",
                "Record with \(.applicationName)",
            ],
            shortTitle: "Start Recording",
            systemImageName: "mic.fill"
        )

        AppShortcut(
            intent: StopRecordingIntent(),
            phrases: [
                "Stop \(.applicationName) recording",
                "Stop recording in \(.applicationName)",
            ],
            shortTitle: "Stop Recording",
            systemImageName: "stop.fill"
        )

        AppShortcut(
            intent: ListRecordingsIntent(),
            phrases: [
                "Show my \(.applicationName) recordings",
                "List \(.applicationName) recordings",
            ],
            shortTitle: "List Recordings",
            systemImageName: "list.bullet"
        )

        AppShortcut(
            intent: GetTranscriptIntent(),
            phrases: [
                "Get transcript from \(.applicationName)",
            ],
            shortTitle: "Get Transcript",
            systemImageName: "text.alignleft"
        )
    }
}
