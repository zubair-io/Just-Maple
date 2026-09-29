import Foundation
import Testing
import MapleCore
import MapleNotebooks
@testable import Just_Maple

@MainActor struct AttachmentBridgeTests {
    @Test func attachmentCommandsUseManagedDocumentAuthorityAndBoundReferences() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer{try? FileManager.default.removeItem(at:root)}
        try FileManager.default.createDirectory(at:root.appendingPathComponent("Cloud/Fixture"),withIntermediateDirectories:true)
        let model=AppModel(),store=try KnowledgeStore(path:":memory:");model.store=store
        let library=try NotebookLibrary(registryURL:root.appendingPathComponent("notebooks.json"),cloudRoot:root.appendingPathComponent("Cloud"));model.notebooks=library
        let book=try #require(await library.catalog().notebooks.first),note=try await library.createNote(notebookID:book.id,name:"Synthetic")
        let coordinator=TodayDocumentCoordinator(store:store,library:library)
        _ = try await coordinator.register(notebookID:book.id,path:note.path,expectedRevision:note.revision)
        let record=try #require(await store.managedDocument(notebookID:book.id,path:note.path))
        let original=try await library.read(notebookID:book.id,path:note.path).content
        let bridge=Bridge(model:model),bytes=Data("Synthetic attachment".utf8).base64EncodedString()
        let imported=try #require(try await bridge.perform("attachmentImport",["documentID":record.documentID,"name":"Synthetic.txt","mimeType":"text/plain","base64":bytes]) as? [String:Any])
        let ref=try #require(imported["ref"] as? String)
        let read=try #require(try await bridge.perform("attachmentRead",["documentID":record.documentID,"ref":ref]) as? [String:Any])
        #expect(read["status"] as? String == "ready")
        #expect(read["dataURL"] as? String == "data:text/plain;base64,"+bytes)
        await #expect(throws:(any Error).self){_ = try await bridge.perform("attachmentRead",["documentID":"unregistered","ref":ref])}
        await #expect(throws:(any Error).self){_ = try await bridge.perform("attachmentRead",["documentID":record.documentID,"ref":"../secret"])}
        await #expect(throws:(any Error).self){_ = try await bridge.perform("attachmentImport",["documentID":record.documentID,"name":"Synthetic","mimeType":"text/plain","base64":"invalid"])}
        #expect(try await library.read(notebookID:book.id,path:note.path).content == original)
    }
}
