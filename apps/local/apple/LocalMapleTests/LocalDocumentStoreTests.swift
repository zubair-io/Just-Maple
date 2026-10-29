import Foundation
import Testing
@testable import LocalMaple

struct LocalDocumentStoreTests {
    private func fixture() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    @Test func savesExactMarkdownAndRefusesStaleReplacement() throws {
        let root = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let store = LocalDocumentStore(); store.grant(root)
        let file = root.appendingPathComponent("note.md")
        try store.write(file.path, content: "# Hello\n\nFirst line 🪴\n", expectedVersion: nil)
        let opened = try store.read(file.path)
        #expect(opened.content == "# Hello\n\nFirst line 🪴\n")
        try "# Changed elsewhere\n".write(to: file, atomically: true, encoding: .utf8)
        #expect(throws: (any Error).self) {
            try store.write(file.path, content: "# My edits\n", expectedVersion: opened.version)
        }
        #expect(try String(contentsOf: file, encoding: .utf8) == "# Changed elsewhere\n")
        let recovery = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
            .first { $0.lastPathComponent.contains(".conflict-") }!
        #expect(try String(contentsOf: recovery, encoding: .utf8) == "# My edits\n")
    }

    @Test func rejectsUnknownFoldersTraversalAndSymlinkEscapes() throws {
        let root = try fixture(); let outside = try fixture()
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: outside) }
        let store = LocalDocumentStore(); store.grant(root)
        #expect(throws: (any Error).self) { try store.resolve(outside.appendingPathComponent("secret.md").path) }
        #expect(throws: (any Error).self) { try store.resolve(root.path + "/../outside.md") }
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("escape"), withDestinationURL: outside)
        #expect(throws: (any Error).self) { try store.resolve(root.appendingPathComponent("escape/secret.md").path) }
    }

    @Test func refusesCreateOverExistingFileAndReportsMissingFolder() throws {
        let root = try fixture()
        defer { try? FileManager.default.removeItem(at: root) }
        let store = LocalDocumentStore(); store.grant(root)
        let file = root.appendingPathComponent("existing.md")
        try "Original".write(to: file, atomically: true, encoding: .utf8)
        #expect(throws: (any Error).self) { try store.write(file.path, content: "Duplicate", expectedVersion: nil) }
        #expect(try String(contentsOf: file, encoding: .utf8) == "Original")
        #expect(throws: (any Error).self) {
            try store.write(root.appendingPathComponent("missing/note.md").path, content: "Draft", expectedVersion: nil)
        }
    }

    @Test func confinesBundledAssetsAndResolvesClientRoutes() throws {
        let root = try fixture(); let outside = try fixture()
        defer { try? FileManager.default.removeItem(at: root); try? FileManager.default.removeItem(at: outside) }
        try "UI".write(to: root.appendingPathComponent("index.html"), atomically: true, encoding: .utf8)
        #expect(LocalAssetPath.resolve(URL(string: "app://localhost/settings")!, root: root)?.lastPathComponent == "index.html")
        #expect(LocalAssetPath.resolve(URL(string: "app://other/index.html")!, root: root) == nil)
        #expect(LocalAssetPath.resolve(URL(string: "app://localhost/../secret")!, root: root) == nil)
        #expect(LocalAssetPath.resolve(URL(string: "app://localhost/missing.js")!, root: root) == nil)
        try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("escape"), withDestinationURL: outside)
        #expect(LocalAssetPath.resolve(URL(string: "app://localhost/escape/secret.js")!, root: root) == nil)
    }
}
