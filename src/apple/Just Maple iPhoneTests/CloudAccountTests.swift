import Foundation
import Testing
import MapleCompanionTransport
@testable import Just_Maple_iPhone

@MainActor struct CloudAccountTests {
    @Test func cloudOwnerPersistsAndSameAccountBindingIsIdempotent() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try CompanionStore(directory: directory)
        let owner = String(repeating: "a", count: 64)
        let capture = UUID()
        try store.capture(id: capture.uuidString, text: "Synthetic cloud-owned capture")
        let device = try #require(UUID(uuidString: store.snapshot.deviceID))
        try store.accept(.init(deviceID: device, receivedIDs: [capture], tasks: [.init(id: "fixture-task", title: "Synthetic cached task", status: "open", activities: [], due: nil)]), sentIDs: [capture])
        try store.bindCloudAccount(owner)
        let diskBefore = try Data(contentsOf: directory.appendingPathComponent("captures.json"))
        try store.bindCloudAccount(owner)
        #expect(try Data(contentsOf: directory.appendingPathComponent("captures.json")) == diskBefore)
        let reopened = try CompanionStore(directory: directory)
        #expect(reopened.snapshot.cloudAccountID == owner)
        let webSnapshot=try #require(try reopened.reply() as? [String:Any])
        #expect(webSnapshot["cloudAccountID"] == nil)
        #expect(reopened.snapshot.deviceID == device.uuidString)
        #expect(reopened.snapshot.captures == store.snapshot.captures)
        #expect(reopened.snapshot.mac?.tasks.first?.title == "Synthetic cached task")
        #expect(reopened.snapshot.receivedIDs == [capture.uuidString.lowercased()])
        #expect(reopened.pending.isEmpty)
    }

    @Test func changedAccountClearsCachedMacButNeverReassignsCapturesOrReceipts() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try CompanionStore(directory: directory)
        let originalOwner = String(repeating: "a", count: 64), otherOwner = String(repeating: "b", count: 64)
        let delivered = UUID(), pending = UUID()
        try store.capture(id: delivered.uuidString, text: "Synthetic delivered original-account capture")
        try store.capture(id: pending.uuidString, text: "Synthetic pending original-account capture")
        try store.bindCloudAccount(originalOwner)
        let originalCaptures = store.snapshot.captures
        let device = try #require(UUID(uuidString: store.snapshot.deviceID))
        try store.accept(.init(deviceID: device, receivedIDs: [delivered], tasks: [.init(id: "private-fixture", title: "Original-account cached task", status: "open", activities: [], due: nil)], states: [.init(property: "presence", status: "known", value: "Synthetic home")]), sentIDs: [delivered])

        do { try store.bindCloudAccount(otherOwner); Issue.record("A new iCloud account must not adopt the outbox") }
        catch CompanionError.accountChanged { }
        #expect(store.snapshot.mac == nil)
        #expect(store.snapshot.cloudAccountID == originalOwner)
        #expect(store.snapshot.captures == originalCaptures)
        #expect(store.snapshot.receivedIDs == [delivered.uuidString.lowercased()])
        #expect(store.pending.map(\.id) == [pending.uuidString])

        let reopened = try CompanionStore(directory: directory)
        #expect(reopened.snapshot.mac == nil)
        #expect(reopened.snapshot.cloudAccountID == originalOwner)
        #expect(reopened.snapshot.captures == originalCaptures)
        #expect(reopened.snapshot.receivedIDs == [delivered.uuidString.lowercased()])
        #expect(reopened.pending.map(\.id) == [pending.uuidString])
        do { try reopened.bindCloudAccount(otherOwner); Issue.record("Restart must not bypass account ownership") }
        catch CompanionError.accountChanged { }
        try reopened.bindCloudAccount(originalOwner)
        #expect(reopened.snapshot.mac == nil)
        #expect(reopened.pending.map(\.id) == [pending.uuidString])
        #expect(reopened.snapshot.deviceID == device.uuidString)
    }
}
