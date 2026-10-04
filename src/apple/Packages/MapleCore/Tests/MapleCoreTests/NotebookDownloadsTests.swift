import Foundation
import Testing
@testable import MapleNotebooks

private actor DownloadFixture {
    var states:[NotebookDownloads.State]
    var requests=0,reads=0,pauses=0
    var failRequest=false,failState=false,cancelPause=false
    init(_ states:[NotebookDownloads.State],failRequest:Bool=false,failState:Bool=false,cancelPause:Bool=false) {
        self.states=states;self.failRequest=failRequest;self.failState=failState;self.cancelPause=cancelPause
    }
    func state() throws -> NotebookDownloads.State {
        reads+=1
        if failState {throw NotebookError.invalid("Fixture metadata unavailable")}
        let next=states[0];if states.count>1 {states.removeFirst()};return next
    }
    func request() throws {requests+=1;if failRequest {throw NotebookError.invalid("Fixture offline request")}}
    func pause() throws {pauses+=1;if cancelPause {throw CancellationError()}}
    nonisolated var environment:NotebookDownloads.Environment {
        .init(state:{_ in try await self.state()},request:{_ in try await self.request()},pause:{try await self.pause()})
    }
}

struct NotebookDownloadsTests {
    let url=URL(fileURLWithPath:"/fixture/Remote.md")
    func state(exists:Bool=false,readable:Bool=false,ubiquitous:Bool=true,placeholder:Bool=false)->NotebookDownloads.State {
        .init(ubiquitous:ubiquitous,placeholder:placeholder,exists:exists,locallyReadable:readable)
    }
    @Test func alreadyDownloadedAndOrdinaryLocalFilesDoNotNeedCloudRequest()async throws {
        for initial in [state(exists:true,readable:true),state(exists:true,ubiquitous:false)] {
            let fixture=DownloadFixture([initial],failRequest:true)
            try await NotebookDownloads.prepare(url,environment:fixture.environment,attempts:2)
            #expect(await fixture.requests==0);#expect(await fixture.reads==1)
        }
    }
    @Test func waitsForPositiveMaterializationEvenIfPlaceholderBytesAlreadyExist()async throws {
        let fixture=DownloadFixture([state(placeholder:true),state(exists:true),state(exists:true,readable:true)])
        try await NotebookDownloads.prepare(url,environment:fixture.environment,attempts:3)
        #expect(await fixture.requests==1);#expect(await fixture.reads==3);#expect(await fixture.pauses==1)
    }
    @Test func missingLocalFileDoesNotBecomeReadableJustBecauseMetadataSaysDownloaded()async throws {
        let fixture=DownloadFixture([state(readable:true)])
        await #expect(throws:NotebookError.self) {try await NotebookDownloads.prepare(url,environment:fixture.environment,attempts:2)}
        #expect(await fixture.requests==1);#expect(await fixture.pauses==2)
    }
    @Test func unavailableMetadataRequestAndCancellationRemainErrors()async throws {
        let metadata=DownloadFixture([state()],failState:true)
        await #expect(throws:NotebookError.self) {try await NotebookDownloads.prepare(url,environment:metadata.environment,attempts:2)}
        #expect(await metadata.requests==0)
        let offline=DownloadFixture([state()],failRequest:true)
        await #expect(throws:NotebookError.self) {try await NotebookDownloads.prepare(url,environment:offline.environment,attempts:2)}
        #expect(await offline.reads==1)
        let cancelled=DownloadFixture([state()],cancelPause:true)
        await #expect(throws:CancellationError.self) {try await NotebookDownloads.prepare(url,environment:cancelled.environment,attempts:2)}
        #expect(await cancelled.reads==2)
    }
    @Test func unavailableCloudReadKeepsDraftAndPlaceholderAndCannotCreateReplacement()async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer {try? FileManager.default.removeItem(at:root)}
        let folder=root.appendingPathComponent("Cloud/Book")
        try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
        let file=folder.appendingPathComponent("Remote.md"),placeholder=folder.appendingPathComponent(".Remote.md.icloud")
        let metadata=Data("Fixture cloud metadata".utf8);try metadata.write(to:placeholder)
        let fixture=DownloadFixture([state(placeholder:true)])
        let registry=root.appendingPathComponent("Local/registry.json")
        let library=try NotebookLibrary(registryURL:registry,cloudRoot:root.appendingPathComponent("Cloud"),prepareForRead:{url in
            try await NotebookDownloads.prepare(url,environment:fixture.environment,attempts:2)
        })
        let book=try #require(await library.catalog().notebooks.first)
        let draft=NotebookDocument(notebookID:book.id,path:"Remote.md",content:"User-owned unsaved draft",revision:"prior-version")
        try await library.saveDraft(draft)
        await #expect(throws:NotebookError.self) {try await library.readIfPresent(notebookID:book.id,path:"Remote.md")}
        await #expect(throws:NotebookError.self) {try await library.createNote(notebookID:book.id,name:"Remote")}
        #expect(!FileManager.default.fileExists(atPath:file.path));#expect(try Data(contentsOf:placeholder)==metadata)
        let reopened=try NotebookLibrary(registryURL:registry,cloudRoot:root.appendingPathComponent("Cloud"))
        _ = try await reopened.catalog()
        #expect(try await reopened.readDraft(notebookID:book.id,path:"Remote.md")?.content==draft.content)
    }
    @Test func unavailableNotebookFolderCannotBeReplacedByAnEmptyNotebook()async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer {try? FileManager.default.removeItem(at:root)}
        let cloud=root.appendingPathComponent("Cloud")
        try FileManager.default.createDirectory(at:cloud,withIntermediateDirectories:true)
        let placeholder=cloud.appendingPathComponent(".Existing.icloud"),metadata=Data("Fixture directory metadata".utf8)
        try metadata.write(to:placeholder)
        let library=try NotebookLibrary(registryURL:root.appendingPathComponent("registry.json"),cloudRoot:cloud)
        await #expect(throws:NotebookError.self) {try await library.createNotebook(name:"Existing")}
        #expect(!FileManager.default.fileExists(atPath:cloud.appendingPathComponent("Existing").path))
        #expect(try Data(contentsOf:placeholder)==metadata)
    }
}
