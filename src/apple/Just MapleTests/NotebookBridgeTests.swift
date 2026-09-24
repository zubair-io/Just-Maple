import Foundation
import Testing
import MapleCore
@testable import Just_Maple
@MainActor struct NotebookBridgeTests {
    @Test func fileSaveIndexesOnlySuccessfulMarkdownRevisions() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer{try? FileManager.default.removeItem(at:root)}
        try FileManager.default.createDirectory(at:root.appendingPathComponent("Cloud/Fixture"),withIntermediateDirectories:true)
        let model=AppModel();model.store=try KnowledgeStore(path:":memory:")
        let library=try NotebookLibrary(registryURL:root.appendingPathComponent("notebooks.json"),cloudRoot:root.appendingPathComponent("Cloud"));model.notebooks=library
        let id=try #require(await library.catalog().notebooks.first?.id),bridge=Bridge(model:model)
        let created=try #require(try await bridge.perform("noteCreate",["id":id,"name":"Fixture note"]) as? [String:Any])
        let revision=try #require(created["revision"] as? String)
        let path=try #require(created["path"] as? String)
        let content="# Fixture\n\n- [x] Kept\n"
        _ = try await bridge.perform("noteSave",["id":id,"path":path,"revision":revision,"content":content])
        #expect(try await model.store?.eventCount()==2)
        do {_ = try await bridge.perform("noteSave",["id":id,"path":path,"revision":revision,"content":"Stale edit"]);Issue.record("Stale bridge save accepted")}catch{}
        #expect(try await model.store?.eventCount()==2)
        #expect(try await library.read(notebookID:id,path:path).content==content)
    }
}
