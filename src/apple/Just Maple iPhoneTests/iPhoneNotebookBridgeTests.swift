import Foundation
import Testing
import MapleNotebooks
@testable import Just_Maple_iPhone

private actor NotebookDownloadGate {
    var paths:[String]=[]
    private var blocked=true
    func prepare(_ url:URL)throws {
        paths.append(url.path)
        if blocked {throw NotebookError.invalid("Fixture note is still downloading")}
    }
    func allow(){blocked=false}
}
private actor NotebookCloudRootFixture {
    var root:URL?
    var lookups=0
    func resolve()->URL? {lookups+=1;return root}
    func restore(_ value:URL){root=value}
}
private actor NotebookCloudInitializationRace {
    let root:URL
    private var calls=0,paused=false
    private var entered:CheckedContinuation<Void,Never>?,release:CheckedContinuation<Void,Never>?
    init(root:URL){self.root=root}
    func resolve()->URL? {calls+=1;return calls==1 ? root:nil}
    func checkpoint(_ root:URL?)async {
        guard root != nil else{return}
        paused=true;entered?.resume();entered=nil
        await withCheckedContinuation{release=$0}
    }
    func waitUntilPaused()async {if !paused {await withCheckedContinuation{entered=$0}}}
    func resume(){release?.resume();release=nil}
}

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
    @Test func todayReadsExactMacFileAndNeverCreatesCompetingNote() async throws {
        let(root,store,bridge)=try fixture();defer{try? FileManager.default.removeItem(at:root)}
        let folder=root.appendingPathComponent("Cloud/Just Maple/2026/09")
        try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
        let file=folder.appendingPathComponent("2026-09-29.md")
        let original="---\nmaple:\n  format: 1\n  document: \"shared-mac-id\"\n---\nExact Mac writing.\n"
        try Data(original.utf8).write(to:file)
        let result=try #require(try await bridge.command("todayRead",body:["day":"2026-09-29","id":"ignore-stale-notebook"],store:store) as? [String:Any])
        #expect(result["content"] as? String == original)
        #expect(result["path"] as? String == "2026/09/2026-09-29.md")
        #expect(result["readOnly"] as? Bool == true)
        #expect(store.snapshot.captures.isEmpty)
        try Data((original+"Updated on Mac.\n").utf8).write(to:file)
        let refreshed=try #require(try await bridge.command("todayRead",body:["day":"2026-09-29"],store:store) as? [String:Any])
        #expect(refreshed["content"] as? String == original+"Updated on Mac.\n")
        #expect(refreshed["revision"] as? String != result["revision"] as? String)
        do {_ = try await bridge.command("todayRead",body:["day":"2026-09-30"],store:store);Issue.record("Missing day should wait for iCloud")}catch{}
        #expect(!FileManager.default.fileExists(atPath:folder.appendingPathComponent("2026-09-30.md").path))
        do {_ = try await bridge.command("todayRead",body:["day":"2026-02-30"],store:store);Issue.record("Invalid day accepted")}catch{}
        #expect(store.snapshot.captures.isEmpty)
    }
    @Test func todayUsesLegacyFileOnlyWhenCanonicalFileIsAbsent() async throws {
        let(root,store,bridge)=try fixture();defer{try? FileManager.default.removeItem(at:root)}
        let folder=root.appendingPathComponent("Cloud/Just Maple/Daily")
        try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
        try Data("Legacy Mac document".utf8).write(to:folder.appendingPathComponent("2026-09-29.md"))
        let result=try #require(try await bridge.command("todayRead",body:["day":"2026-09-29"],store:store) as? [String:Any])
        #expect(result["content"] as? String == "Legacy Mac document")
        #expect(result["path"] as? String == "Daily/2026-09-29.md")
    }
    @Test func unavailableCanonicalDownloadNeverFallsBackOrDiscardsLocalDraft() async throws {
        let(root,store,_)=try fixture();defer{try? FileManager.default.removeItem(at:root)}
        let cloud=root.appendingPathComponent("Cloud"),folder=cloud.appendingPathComponent("Just Maple/2026/09")
        try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
        let canonical=folder.appendingPathComponent("2026-09-29.md")
        let content="Exact cached Mac writing";try Data(content.utf8).write(to:canonical)
        let legacy=cloud.appendingPathComponent("Just Maple/Daily")
        try FileManager.default.createDirectory(at:legacy,withIntermediateDirectories:true)
        try Data("Outdated legacy writing".utf8).write(to:legacy.appendingPathComponent("2026-09-29.md"))
        let gate=NotebookDownloadGate()
        let library=try NotebookLibrary(registryURL:root.appendingPathComponent("Library/notebooks.json"),cloudRoot:cloud,prepareForRead:{url in try await gate.prepare(url)})
        let id=try await library.ensureJustMapleDailyNotebook()
        let path="2026/09/2026-09-29.md"
        try await library.saveDraft(NotebookDocument(notebookID:id,path:path,content:"Retained phone draft",revision:"prior"))
        let bridge=iPhoneNotebookBridge(directory:root.appendingPathComponent("Library"),library:library)
        do {_ = try await bridge.command("todayRead",body:["day":"2026-09-29"],store:store);Issue.record("Unavailable download appeared ready")}catch{}
        #expect(await gate.paths==[canonical.path])
        #expect(try String(contentsOf:canonical,encoding:.utf8)==content)
        #expect(try await library.readDraft(notebookID:id,path:path)?.content=="Retained phone draft")
        #expect(store.snapshot.captures.isEmpty)
        await gate.allow()
        let result=try #require(try await bridge.command("todayRead",body:["day":"2026-09-29"],store:store) as? [String:Any])
        #expect(result["content"] as? String == content);#expect(result["readOnly"] as? Bool == true)
        #expect(try await library.readDraft(notebookID:id,path:path)?.content=="Retained phone draft")
        #expect(store.snapshot.captures.isEmpty)
    }
    @Test func retryDiscoversRestoredCloudContainerWithoutDroppingConnectedNotebookOrDraft() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer{try? FileManager.default.removeItem(at:root)}
        let local=root.appendingPathComponent("User chosen folder")
        try FileManager.default.createDirectory(at:local,withIntermediateDirectories:true)
        let directory=root.appendingPathComponent("Library"),registry=directory.appendingPathComponent("notebooks.json")
        let seed=try NotebookLibrary(registryURL:registry,cloudRoot:nil)
        let catalog=try await seed.connect(local),id=try #require(catalog.notebooks.first?.id)
        let note=try await seed.createNote(notebookID:id,name:"Kept")
        try await seed.saveDraft(NotebookDocument(notebookID:id,path:note.path,content:"Unsaved local writing",revision:note.revision))
        let resolver=NotebookCloudRootFixture()
        let bridge=iPhoneNotebookBridge(directory:directory,cloudRootProvider:{await resolver.resolve()})
        let store=try CompanionStore(directory:root.appendingPathComponent("Outbox"))
        let unavailable=try #require(try await bridge.command("notebookCatalog",body:[:],store:store) as? [String:Any])
        #expect(unavailable["cloudAvailable"] as? Bool == false)
        let lookupCount=await resolver.lookups
        _ = try await bridge.command("noteDraft",body:["record":["notebookID":id,"path":note.path,"revision":note.revision,"content":"Unsaved local writing"]],store:store)
        #expect(await resolver.lookups==lookupCount)
        do {_ = try await bridge.command("todayRead",body:["day":"2026-09-29"],store:store);Issue.record("Missing iCloud accepted")}catch{}
        #expect(!FileManager.default.fileExists(atPath:local.appendingPathComponent("2026").path))
        let cloud=root.appendingPathComponent("App container/Documents"),daily=cloud.appendingPathComponent("Just Maple/2026/09")
        try FileManager.default.createDirectory(at:daily,withIntermediateDirectories:true)
        try Data("Mac cloud note".utf8).write(to:daily.appendingPathComponent("2026-09-29.md"))
        await resolver.restore(cloud)
        let recovered=try #require(try await bridge.command("todayRead",body:["day":"2026-09-29"],store:store) as? [String:Any])
        #expect(recovered["content"] as? String == "Mac cloud note")
        #expect(recovered["path"] as? String == "2026/09/2026-09-29.md")
        let draft=try #require(try await bridge.command("noteReadDraft",body:["id":id,"path":note.path],store:store) as? [String:Any])
        #expect(draft["content"] as? String == "Unsaved local writing")
        let restored=try #require(try await bridge.command("notebookCatalog",body:[:],store:store) as? [String:Any])
        let books=try #require(restored["notebooks"] as? [[String:Any]])
        #expect(books.contains{$0["id"] as? String == id})
        #expect(restored["cloudAvailable"] as? Bool == true);#expect(store.snapshot.captures.isEmpty)
    }
    @Test func concurrentInitialLookupAdoptsAvailableRootOnAlreadyInstalledLocalLibrary()async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer{try? FileManager.default.removeItem(at:root)}
        let cloud=root.appendingPathComponent("Container/Documents"),folder=cloud.appendingPathComponent("Just Maple/2026/09")
        try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
        try Data("Exact cloud document".utf8).write(to:folder.appendingPathComponent("2026-09-29.md"))
        let race=NotebookCloudInitializationRace(root:cloud)
        let bridge=iPhoneNotebookBridge(directory:root.appendingPathComponent("Library"),cloudRootProvider:{await race.resolve()},afterInitialCatalog:{await race.checkpoint($0)})
        let store=try CompanionStore(directory:root.appendingPathComponent("Outbox"))
        let available=Task { @MainActor in
            let catalog=try #require(try await bridge.command("notebookCatalog",body:[:],store:store) as? [String:Any])
            return catalog["cloudAvailable"] as? Bool
        }
        await race.waitUntilPaused()
        let local=try #require(try await bridge.command("notebookCatalog",body:[:],store:store) as? [String:Any])
        #expect(local["cloudAvailable"] as? Bool == false)
        await race.resume()
        #expect(try await available.value == true)
        let result=try #require(try await bridge.command("todayRead",body:["day":"2026-09-29"],store:store) as? [String:Any])
        #expect(result["content"] as? String == "Exact cloud document")
        #expect(store.snapshot.captures.isEmpty)
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
    @Test func managedNotebookRefusesDirectPhoneSaveAndKeepsDraft() async throws {
        let(root,store,bridge)=try fixture();defer{try? FileManager.default.removeItem(at:root)}
        let id=try await notebook(bridge,store)
        let file=root.appendingPathComponent("Cloud/Fixture notebook/Managed.md")
        let original="---\nmaple:\n  format: 1\n  document: \"fixture\"\n---\nMac-owned note.\n"
        try Data(original.utf8).write(to:file)
        var draft=try #require(try await bridge.command("noteRead",body:["id":id,"path":"Managed.md"],store:store) as? [String:Any])
        #expect(draft["readOnly"] as? Bool == true)
        draft["content"]="Local pending draft"
        _ = try await bridge.command("noteDraft",body:["record":draft],store:store)
        do {_ = try await bridge.command("noteSave",body:["id":id,"path":"Managed.md","revision":draft["revision"]!,"content":"Local pending draft"],store:store);Issue.record("Managed note changed directly on phone")}catch{}
        #expect(try String(contentsOf:file,encoding:.utf8)==original)
        #expect(store.snapshot.captures.isEmpty)
        let retained=try #require(try await bridge.command("noteReadDraft",body:["id":id,"path":"Managed.md"],store:store) as? [String:Any])
        #expect(retained["content"] as? String == "Local pending draft")
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
