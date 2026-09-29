import Foundation
import Testing
import MapleCore
@testable import Just_Maple

struct HomeSettingsTests {
    @Test @MainActor func automaticImportsWaitTenMinutesButManualImportsAreImmediate() throws {
        let model = AppModel()
        model.store = try KnowledgeStore(path: ":memory:")
        model.homeSettings.enabled = true
        model.homeToken = "synthetic-test-token"
        let completed = Date(timeIntervalSince1970: 1_000)
        // A newly opened connection imports immediately; subsequent snapshots wait a full window.
        #expect(model.shouldPollHome(at: completed))
        model.lastHomePoll = completed
        #expect(!model.shouldPollHome(at: completed))
        #expect(!model.shouldPollHome(at: completed.addingTimeInterval(60)))
        #expect(!model.shouldPollHome(at: completed.addingTimeInterval(599.999)))
        #expect(model.shouldPollHome(at: completed.addingTimeInterval(600)))
        #expect(model.shouldPollHome(at: completed.addingTimeInterval(601)))
        #expect(model.shouldPollHome(at: completed, force: true))
        // A manual import also resets the automatic window when it finishes.
        model.lastHomePoll = completed.addingTimeInterval(120)
        #expect(!model.shouldPollHome(at: completed.addingTimeInterval(600)))
        #expect(model.shouldPollHome(at: completed.addingTimeInterval(720)))
    }

    @Test @MainActor func forcedImportsStillRequireAnIdleEnabledConnection() throws {
        let model = AppModel()
        model.store = try KnowledgeStore(path: ":memory:")
        model.homeSettings.enabled = true
        model.homeToken = "synthetic-test-token"
        #expect(model.shouldPollHome(force: true))
        model.homeImporting = true
        #expect(!model.shouldPollHome(force: true))
        model.homeImporting = false
        model.homeSettings.enabled = false
        #expect(!model.shouldPollHome(force: true))
        model.homeSettings.enabled = true
        model.homeToken = nil
        #expect(!model.shouldPollHome(force: true))
        model.homeToken = "synthetic-test-token"
        model.store = nil
        #expect(!model.shouldPollHome(force: true))
    }

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
