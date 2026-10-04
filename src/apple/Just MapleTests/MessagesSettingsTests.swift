import Foundation
import Testing
@testable import Just_Maple

@MainActor
struct MessagesSettingsTests {
    @Test func explicitConnectionAndPauseSurviveRelaunch() async throws {
        let suite = "maple.synthetic.messages." + UUID().uuidString
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let first = AppModel(classificationDefaults: defaults)
        // No store is attached: exercise real connection commands without reading
        // the user's Messages database or starting any live processing.
        _ = try await Bridge(model: first).perform("messages", [:])
        #expect(first.messagesEnabled)
        #expect(defaults.bool(forKey: "messagesEnabled"))
        let reopened = AppModel(classificationDefaults: defaults)
        #expect(reopened.messagesEnabled)
        #expect(reopened.messagesStatus == "Connected · waiting for the next import")
        _ = try await Bridge(model: reopened).perform("pauseMessages", [:])
        #expect(!defaults.bool(forKey: "messagesEnabled"))
        #expect(!AppModel(classificationDefaults: defaults).messagesEnabled)
    }

    @Test func unconfiguredMessagesStayDisconnected() throws {
        let suite = "maple.synthetic.messages.unconfigured." + UUID().uuidString
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let model = AppModel(classificationDefaults: defaults)
        #expect(!model.messagesEnabled)
        #expect(model.messagesStatus == "Not connected")
    }
}
