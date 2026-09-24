import Foundation
import Testing
import MapleNotebooks
@testable import Just_Maple_iPhone

@MainActor struct iPhoneNotebookBridgeTests {
    func fixture() throws -> (URL, CompanionStore, iPhoneNotebookBridge) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let cloud = root.appendingPathComponent("Cloud")
        let store = try CompanionStore(directory: root.appendingPathComponent("Outbox"))
        let bridge = iPhoneNotebookBridge(directory: root.appendingPathComponent("Library"), cloudRootProvider: { cloud })
        return (root, store, bridge)
    }
    func notebook(_ bridge: iPhoneNotebookBridge, _ store: CompanionStore) async throws -> String {
        let value = try await bridge.command("notebookCreate", body: ["name": "Fixture notebook"], store: store)
        let catalog = try #require(value as? [String: Any])
        let notebooks = try #require(catalog["notebooks"] as? [[String: Any]])
        return try #require(notebooks.first?["id"] as? String)
    }
    @Test func realFilesCreateReadSaveAndOnlyEditsQueueOncePerRevision() async throws {
        let (root,store,bridge) = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        let id = try await notebook(bridge, store)
        let created = try #require(try await bridge.command("noteCreate", body: ["id": id, "name": "Morning"], store: store) as? [String: Any])
        let revision = try #require(created["revision"] as? String)
        let file = root.appendingPathComponent("Cloud/Fixture notebook/Morning.md")
        #expect(try String(contentsOf: file, encoding: .utf8) == "# Morning\n\n")
        #expect(store.snapshot.captures.count == 1)
        _ = try await bridge.command("noteRead", body: ["id": id, "path": "Morning.md"], store: store)
        #expect(store.snapshot.captures.count == 1)
        let body: [String: Any] = ["id": id, "path": "Morning.md", "content": "# Actual edit\n", "revision": revision]
        let saved = try #require(try await bridge.command("noteSave", body: body, store: store) as? [String: Any])
        #expect(try String(contentsOf: file, encoding: .utf8) == "# Actual edit\n")
        #expect(store.snapshot.captures.count == 2)
        var again = body; again["revision"] = saved["revision"]
        _ = try await bridge.command("noteSave", body: again, store: store)
        #expect(store.snapshot.captures.count == 2)
        let reopened = try CompanionStore(directory: root.appendingPathComponent("Outbox"))
        #expect(reopened.snapshot.captures == store.snapshot.captures)
    }
    @Test func conflictingExternalEditKeepsDraftAndDoesNotQueueFailedSave() async throws {
        let (root,store,bridge) = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        let id = try await notebook(bridge, store)
        var draft = try #require(try await bridge.command("noteCreate", body: ["id": id, "name": "Conflict"], store: store) as? [String: Any])
        draft["content"] = "Fixture unsaved draft"
        _ = try await bridge.command("noteDraft", body: ["record": draft], store: store)
        let file = root.appendingPathComponent("Cloud/Fixture notebook/Conflict.md")
        try Data("External fixture edit".utf8).write(to: file)
        do {
            _ = try await bridge.command("noteSave", body: ["id": id, "path": "Conflict.md", "content": "Fixture unsaved draft", "revision": draft["revision"]!], store: store)
            Issue.record("Overwrote externally changed file")
        } catch {}
        #expect(try String(contentsOf: file, encoding: .utf8) == "External fixture edit")
        #expect(store.snapshot.captures.count == 1)
        let reopened = iPhoneNotebookBridge(directory: root.appendingPathComponent("Library"), cloudRootProvider: { root.appendingPathComponent("Cloud") })
        let savedDraft = try #require(try await reopened.command("noteReadDraft", body: ["id": id, "path": "Conflict.md"], store: store) as? [String: Any])
        #expect(savedDraft["content"] as? String == "Fixture unsaved draft")
    }
    @Test func largeNotesRemainIntactWithExplicitIndexingNoticeAndOldReadsNeverQueue() async throws {
        let (root,store,bridge) = try fixture(); defer { try? FileManager.default.removeItem(at: root) }
        let id = try await notebook(bridge, store)
        let file = root.appendingPathComponent("Cloud/Fixture notebook/Old.md")
        try Data("Existing historical fixture".utf8).write(to: file)
        try FileManager.default.setAttributes([.modificationDate: Date().addingTimeInterval(-90 * 86400)], ofItemAtPath: file.path)
        let read = try #require(try await bridge.command("noteRead", body: ["id": id, "path": "Old.md"], store: store) as? [String: Any])
        #expect(store.snapshot.captures.isEmpty)
        let large = String(repeating: "é", count: 9000)
        let saved = try #require(try await bridge.command("noteSave", body: ["id": id, "path": "Old.md", "content": large, "revision": read["revision"]!], store: store) as? [String: Any])
        #expect(saved["indexingWarning"] as? String != nil)
        #expect(try String(contentsOf: file, encoding: .utf8) == large)
        #expect(store.snapshot.captures.isEmpty)
    }
}
