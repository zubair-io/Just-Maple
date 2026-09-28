import Foundation
import Testing
import MapleNotebooks

struct NotebookAttachmentTests {
    func fixture() throws -> (URL,NotebookLibrary) {try NotebookTests().fixture()}
    @Test func copiesImmutableBoundedBytesAndSharesReferencesAcrossDailyFolders() async throws {
        let(root,library)=try fixture();defer{try? FileManager.default.removeItem(at:root)}
        let book=try #require(await library.catalog().notebooks.first)
        let bytes=Data("Synthetic attachment".utf8)
        let a=try await library.importAttachment(notebookID:book.id,path:"2026/09/27.md",name:"A.txt",mimeType:"text/plain",base64:bytes.base64EncodedString())
        let b=try await library.importAttachment(notebookID:book.id,path:"2026/10/01.md",name:"B.txt",mimeType:"text/plain",base64:bytes.base64EncodedString())
        #expect(a.ref==b.ref && a.byteCount==bytes.count)
        #expect(FileManager.default.fileExists(atPath:root.appendingPathComponent("Cloud/Everyday/"+a.ref).path))
        let loaded=try await library.readAttachment(notebookID:book.id,path:"2026/10/01.md",ref:a.ref)
        #expect(loaded.status=="ready" && loaded.dataURL=="data:text/plain;base64,"+bytes.base64EncodedString())
        try Data("Tampered".utf8).write(to:root.appendingPathComponent("Cloud/Everyday/"+a.ref))
        await #expect(throws:(any Error).self){_ = try await library.readAttachment(notebookID:book.id,path:"27.md",ref:a.ref)}
        await #expect(throws:(any Error).self){_ = try await library.importAttachment(notebookID:book.id,path:"27.md",name:"A.txt",mimeType:"text/plain",base64:bytes.base64EncodedString())}
    }
    @Test func concurrentImportsKeepOneCompleteImmutableFile() async throws {
        let(root,first)=try fixture();defer{try? FileManager.default.removeItem(at:root)}
        let second=try NotebookLibrary(registryURL:root.appendingPathComponent("second.json"),cloudRoot:root.appendingPathComponent("Cloud"))
        let book=try #require(await first.catalog().notebooks.first)
        _ = try await second.catalog()
        let bytes=Data(repeating:42,count:128_000).base64EncodedString()
        let refs=try await withThrowingTaskGroup(of:String.self) { group in
            for index in 0..<8 {
                let library=index.isMultiple(of:2) ? first:second
                group.addTask {try await library.importAttachment(notebookID:book.id,path:"note.md",name:"Synthetic.bin",mimeType:"application/octet-stream",base64:bytes).ref}
            }
            var values:[String]=[];for try await value in group {values.append(value)};return values
        }
        #expect(Set(refs).count==1)
        #expect(try FileManager.default.contentsOfDirectory(atPath:root.appendingPathComponent("Cloud/Everyday/Attachments").path).count==1)
        #expect(try await first.readAttachment(notebookID:book.id,path:"note.md",ref:refs[0]).byteCount==128_000)
    }
    @Test func rejectsTraversalSymlinksUnboundedAndActiveImages() async throws {
        let(root,library)=try fixture();defer{try? FileManager.default.removeItem(at:root)}
        let book=try #require(await library.catalog().notebooks.first)
        for ref in ["../secret", "file:///secret", "https://example.com/a.png", "Attachments/"+String(repeating:"a",count:64)+".html"] {
            await #expect(throws:(any Error).self){_ = try await library.readAttachment(notebookID:book.id,path:"27.md",ref:ref)}
        }
        for (mime,bytes) in [("image/svg+xml",Data("<svg/>".utf8)),("image/png",Data("not an image".utf8)),("text/plain",Data())] {
            await #expect(throws:(any Error).self){_ = try await library.importAttachment(notebookID:book.id,path:"27.md",name:"Fixture",mimeType:mime,base64:bytes.base64EncodedString())}
        }
        await #expect(throws:(any Error).self){_ = try await library.importAttachment(notebookID:book.id,path:"27.md",name:"Fixture",mimeType:"text/plain",base64:String(repeating:"A",count:NotebookLibrary.attachmentBase64Limit+1))}
        let outside=root.appendingPathComponent("outside");try FileManager.default.createDirectory(at:outside,withIntermediateDirectories:false)
        try FileManager.default.createSymbolicLink(at:root.appendingPathComponent("Cloud/Everyday/Attachments"),withDestinationURL:outside)
        await #expect(throws:(any Error).self){_ = try await library.importAttachment(notebookID:book.id,path:"27.md",name:"Fixture",mimeType:"text/plain",base64:Data("Synthetic".utf8).base64EncodedString())}
        #expect(try FileManager.default.contentsOfDirectory(atPath:outside.path).isEmpty)
    }
    @Test func rasterValidationAndMissingState() async throws {
        let(root,library)=try fixture();defer{try? FileManager.default.removeItem(at:root)}
        let book=try #require(await library.catalog().notebooks.first)
        let png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGd8AAAAASUVORK5CYII="
        let image=try await library.importAttachment(notebookID:book.id,path:"note.md",name:"Synthetic.png",mimeType:"image/png",base64:png)
        #expect(image.kind=="image" && image.mimeType=="image/png")
        #expect(try await library.readAttachment(notebookID:book.id,path:"note.md",ref:image.ref).status=="ready")
        try FileManager.default.removeItem(at:root.appendingPathComponent("Cloud/Everyday/"+image.ref))
        #expect(try await library.readAttachment(notebookID:book.id,path:"note.md",ref:image.ref).status=="missing")
    }
}
