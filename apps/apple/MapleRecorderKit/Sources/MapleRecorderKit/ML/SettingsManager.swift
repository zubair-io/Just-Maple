import Foundation
import Observation

@Observable
final class SettingsManager {
    var settings: AppSettings

    private let fileManager = FileManager.default

    init() {
        self.settings = Self.load() ?? AppSettings(preferredLLMProvider: .appleFoundationModels)
    }

    func save() throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(settings)
        try fileManager.createDirectory(at: Self.settingsURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: Self.settingsURL, options: .atomic)
    }

    var preferredProvider: LLMProvider {
        get { settings.preferredLLMProvider }
        set {
            settings.preferredLLMProvider = newValue
            try? save()
        }
    }

    var claudeAPIKey: String {
        get { KeychainManager.load(key: .claudeAPIKey) ?? "" }
        set {
            if newValue.isEmpty {
                KeychainManager.delete(key: .claudeAPIKey)
            } else {
                try? KeychainManager.save(key: .claudeAPIKey, value: newValue)
            }
        }
    }

    var openAIAPIKey: String {
        get { KeychainManager.load(key: .openAIAPIKey) ?? "" }
        set {
            if newValue.isEmpty {
                KeychainManager.delete(key: .openAIAPIKey)
            } else {
                try? KeychainManager.save(key: .openAIAPIKey, value: newValue)
            }
        }
    }

    var assistPrompt: String {
        get { settings.assistPrompt }
        set {
            settings.assistPrompt = newValue
            try? save()
        }
    }

    var shareAssistScreenshotsWithCloudAI: Bool {
        get { settings.shareAssistScreenshotsWithCloudAI }
        set {
            settings.shareAssistScreenshotsWithCloudAI = newValue
            try? save()
        }
    }

    // MARK: - Calendar Settings

    var calendarEnabled: Bool {
        get { settings.calendarEnabled }
        set {
            settings.calendarEnabled = newValue
            try? save()
        }
    }

    var calendarTitleMode: CalendarTitleMode {
        get { settings.calendarTitleMode }
        set {
            settings.calendarTitleMode = newValue
            try? save()
        }
    }

    var selectedCalendarIdentifiers: [String] {
        get { settings.selectedCalendarIdentifiers }
        set {
            settings.selectedCalendarIdentifiers = newValue
            try? save()
        }
    }

    // MARK: - Persistence

    private static var settingsURL: URL {
        FileManager.default
            .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("settings.json")
    }

    private static func load() -> AppSettings? {
        guard let data = try? Data(contentsOf: settingsURL) else { return nil }
        return try? JSONDecoder().decode(AppSettings.self, from: data)
    }
}
