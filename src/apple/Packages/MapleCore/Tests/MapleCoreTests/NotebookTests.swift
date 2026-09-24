import Foundation
import Testing
import MapleNotebooks
@testable import MapleCore
struct NotebookTests {
    func fixture() throws -> (URL,NotebookLibrary) {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at:root.appendingPathComponent("Cloud/Everyday"),withIntermediateDirectories:true)
        return (root,try NotebookLibrary(registryURL:root.appendingPathComponent("settings/notebooks.json"),cloudRoot:root.appendingPathComponent("Cloud")))
    }
    @Test func waitsForCloudMaterializationAndNeverReplacesUnavailableContent() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer {try? FileManager.default.removeItem(at:root)}
        let folder=root.appendingPathComponent("Cloud/Book")
        try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
        let library=try NotebookLibrary(registryURL:root.appendingPathComponent("registry.json"),cloudRoot:root.appendingPathComponent("Cloud"),prepareForRead:{url in
            try await Task.sleep(for:.milliseconds(20))
            try Data("# Downloaded original".utf8).write(to:url)
        })
        let book=try #require(await library.catalog().notebooks.first)
        let doc=try await library.read(notebookID:book.id,path:"Remote.md")
        #expect(doc.content=="# Downloaded original")
        let unavailable=try NotebookLibrary(registryURL:root.appendingPathComponent("other.json"),cloudRoot:root.appendingPathComponent("Cloud"),prepareForRead:{_ in throw NotebookError.invalid("Still downloading")})
        let other=try #require(await unavailable.catalog().notebooks.first)
        await #expect(throws:NotebookError.self){try await unavailable.read(notebookID:other.id,path:"Missing.md")}
        #expect(!FileManager.default.fileExists(atPath:folder.appendingPathComponent("Missing.md").path))
        #expect(try String(contentsOf:folder.appendingPathComponent("Remote.md"),encoding:.utf8)=="# Downloaded original")
    }
    @Test func discoversFoldersAndPreservesExternalChanges() async throws {
        let (root,library)=try fixture();defer{try? FileManager.default.removeItem(at:root)}
        let book=try #require(await library.catalog().notebooks.first)
        #expect(book.name=="Everyday");#expect(book.cloud)
        let note=try await library.createNote(notebookID:book.id,name:"Morning")
        var draft=note;draft.content="# Unsaved\n";try await library.saveDraft(draft)
        let url=root.appendingPathComponent("Cloud/Everyday/Morning.md")
        try Data("# Changed elsewhere\n".utf8).write(to:url)
        do {_ = try await library.save(notebookID:book.id,path:note.path,content:draft.content,expectedRevision:note.revision);Issue.record("Stale save accepted")}catch{}
        #expect(try String(contentsOf:url,encoding:.utf8)=="# Changed elsewhere\n")
        #expect(try await library.readDraft(notebookID:book.id,path:note.path)?.content==draft.content)
        let current=try await library.read(notebookID:book.id,path:note.path)
        _ = try await library.save(notebookID:book.id,path:note.path,content:draft.content,expectedRevision:current.revision)
        #expect(try await library.readDraft(notebookID:book.id,path:note.path)==nil)
        #expect(try await library.catalog().notebooks.first?.notes.count==1)
        try FileManager.default.createDirectory(at:root.appendingPathComponent("Cloud/New folder"),withIntermediateDirectories:false)
        #expect(try await library.catalog().notebooks.count==2)
    }
    @Test func bookmarksSurviveRestartAndDisconnectDoesNotDeleteFiles() async throws {
        let (root,library)=try fixture();defer{try? FileManager.default.removeItem(at:root)}
        let folder=root.appendingPathComponent("Manual");try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:false)
        let first=try await library.connect(folder);_ = try await library.connect(folder)
        #expect(try await library.catalog().notebooks.count==2)
        let id=try #require(first.notebooks.first{$0.name=="Manual"}?.id)
        _ = try await library.createNote(notebookID:id,name:"Kept")
        let restored=try NotebookLibrary(registryURL:root.appendingPathComponent("settings/notebooks.json"),cloudRoot:nil)
        #expect(try await restored.catalog().notebooks.first?.notes.count==1)
        _ = try await restored.disconnect(id)
        #expect(FileManager.default.fileExists(atPath:folder.appendingPathComponent("Kept.md").path))
        #expect(try await restored.catalog().notebooks.isEmpty)
    }
    @Test func rejectsTraversalSymlinksAndAccidentalReplacement() async throws {
        let (root,library)=try fixture();defer{try? FileManager.default.removeItem(at:root)}
        let id=try #require(await library.catalog().notebooks.first?.id)
        _ = try await library.createNote(notebookID:id,name:"Unique")
        do {_ = try await library.createNote(notebookID:id,name:"Unique");Issue.record("Overwrote existing note")}catch{}
        do {_ = try await library.createNote(notebookID:id,name:"../Outside");Issue.record("Accepted traversal")}catch{}
        let outside=root.appendingPathComponent("outside.md");try Data("Private".utf8).write(to:outside)
        try FileManager.default.createSymbolicLink(at:root.appendingPathComponent("Cloud/Everyday/link.md"),withDestinationURL:outside)
        do {_ = try await library.read(notebookID:id,path:"link.md");Issue.record("Read escaped link")}catch{}
        #expect(try await library.catalog().notebooks.first?.notes.count==1)
    }
}
