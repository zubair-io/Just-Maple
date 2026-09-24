import Foundation
import Testing
@testable import Just_Maple

struct HomeSettingsTests {
    @Test func exposedModeDefaultsOnForNewAndExistingSettings() throws {
        #expect(HomeSettings().usesExposed)
        let legacy = try JSONDecoder().decode(HomeSettings.self, from: Data(#"{"url":"http://homeassistant.local:8123","enabled":true,"selected":["manual"]}"#.utf8))
        #expect(legacy.usesExposed)
        #expect(legacy.selected == ["manual"])
        var manual = legacy; manual.exposedOnly = false
        let saved = try JSONDecoder().decode(HomeSettings.self, from: JSONEncoder().encode(manual))
        #expect(!saved.usesExposed)
        #expect(saved.selected == ["manual"])
    }
}
