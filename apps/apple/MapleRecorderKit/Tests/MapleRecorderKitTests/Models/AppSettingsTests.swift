import Foundation
import Testing
@testable import MapleRecorderKit

struct AppSettingsTests {
    @Test func assistPromptRoundTrips() throws {
        let settings = AppSettings(
            assistPrompt: "Help answer what is visible.",
            shareAssistScreenshotsWithCloudAI: true
        )
        let data = try JSONEncoder().encode(settings)
        let decoded = try JSONDecoder().decode(AppSettings.self, from: data)

        #expect(decoded.assistPrompt == "Help answer what is visible.")
        #expect(decoded.shareAssistScreenshotsWithCloudAI)
    }

    @Test func legacySettingsReceiveDefaultAssistPrompt() throws {
        let settings = AppSettings()
        let data = try JSONEncoder().encode(settings)
        var object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        object.removeValue(forKey: "assist_prompt")
        object.removeValue(forKey: "share_assist_screenshots_with_cloud_ai")
        let legacyData = try JSONSerialization.data(withJSONObject: object)

        let decoded = try JSONDecoder().decode(AppSettings.self, from: legacyData)

        #expect(decoded.assistPrompt == AppSettings.defaultAssistPrompt)
        #expect(!decoded.shareAssistScreenshotsWithCloudAI)
    }

    @Test func singleCalendarSettingMigratesToArray() throws {
        let settings = AppSettings()
        let data = try JSONEncoder().encode(settings)
        var object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        object["selected_calendar_identifiers"] = "calendar-1"
        let legacyData = try JSONSerialization.data(withJSONObject: object)

        let decoded = try JSONDecoder().decode(AppSettings.self, from: legacyData)

        #expect(decoded.selectedCalendarIdentifiers == ["calendar-1"])
    }
}
