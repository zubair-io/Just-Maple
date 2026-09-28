import Foundation
import Testing
import WebKit
import MapleCore
import MapleNotebooks
@testable import Just_Maple

@MainActor
struct BridgeTests {
    @Test func automaticRefreshDefersForPresenceAndBackgroundCreatesToday() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer {try? FileManager.default.removeItem(at:root)}
        try FileManager.default.createDirectory(at:root.appendingPathComponent("Cloud"),withIntermediateDirectories:true)
        let library=try NotebookLibrary(registryURL:root.appendingPathComponent("registry.json"),cloudRoot:root.appendingPathComponent("Cloud"))
        let model=AppModel(directory:root);model.notebooks=library;model.store=try KnowledgeStore(path:":memory:")
        let bridge=Bridge(model:model)
        model.loaded=true
        await model.automaticTodayTick()
        let notebook=try await library.ensureJustMapleDailyNotebook()
        let day=try ManagedMarkdown.day()
        let record=try #require(try await model.store?.managedDailyDocument(notebookID:notebook,day:day))
        let response=try #require(try await bridge.perform("documentAutoRefresh",["documentID":record.documentID,"editing":true]) as? [String:Any])
        #expect(response["deferred"] as? Bool==true)
        #expect(model.isTodayEditing(documentID:record.documentID))
        _ = try await bridge.perform("documentPresence",["documentID":record.documentID,"editing":false])
        #expect(!model.isTodayEditing(documentID:record.documentID))
        let refreshed=try #require(try await bridge.perform("documentAutoRefresh",["documentID":record.documentID,"editing":false]) as? [String:Any])
        #expect(refreshed["document"] != nil)
    }
    @Test func editorPresenceExpiresAndCanBeReleased() {
        let model=AppModel(),now=Date(timeIntervalSince1970:1000)
        model.setTodayEditing(documentID:"doc",editing:true,at:now)
        #expect(model.isTodayEditing(documentID:"doc",at:now.addingTimeInterval(5)))
        #expect(!model.isTodayEditing(documentID:"doc",at:now.addingTimeInterval(7)))
        #expect(!model.isTodayEditing(documentID:"other",at:now))
        model.setTodayEditing(documentID:"doc",editing:false,at:now)
        #expect(!model.isTodayEditing(documentID:"doc",at:now))
    }

    @Test func overlappingMutationRefreshWaitsForTheFreshTrailingRead() async {
        let coordinator=WorkspaceRefreshCoordinator()
        var stored=0,visible = -1,passes=0
        var release:CheckedContinuation<Void,Never>?
        let read: () async -> Void = {
            passes += 1
            visible=stored
            if passes==1 {await withCheckedContinuation {release=$0}}
        }
        let initial=Task {await coordinator.run(read)}
        while release==nil {await Task.yield()}
        stored=1 // A user mutation commits after the first pass read old data.
        var mutationReturned=false
        let mutation=Task {await coordinator.run(read);mutationReturned=true}
        while coordinator.waitingCount==0 {await Task.yield()}
        #expect(!mutationReturned && visible==0)
        release?.resume()
        await initial.value;await mutation.value
        #expect(mutationReturned && visible==1 && passes==2)
    }

    @Test func workspaceOpensBeforeCloudAndBackgroundContextHydration() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer {try? FileManager.default.removeItem(at:root)}
        let model=AppModel(directory:root)
        let store=try KnowledgeStore(path:":memory:")
        try await store.correct(subject:"person:self",predicate:"person.name",value:"Startup test")
        model.store=store
        try await model.openWorkspace()
        #expect(model.loaded && model.ready)
        #expect(model.name=="Startup test")
        #expect(model.world==nil && model.notebooks==nil)
        let bridge=Bridge(model:model)
        let snapshot=try #require(try await bridge.perform("snapshot",[:]) as? [String:Any])
        #expect(snapshot["loaded"] as? Bool==true)
        #expect(snapshot["world"] is NSNull)
        #expect(model.world==nil) // Polling does not synchronously rebuild the context graph.
    }

    @Test func failedStartupIsVisibleAndCanRecoverWithoutResettingData() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer {try? FileManager.default.removeItem(at:root)}
        try Data("Existing file".utf8).write(to:root)
        let model=AppModel(directory:root)
        await model.start()
        #expect(!model.loaded && !model.starting)
        #expect(model.startupError != nil)
        #expect(try String(contentsOf:root,encoding:.utf8)=="Existing file")
        let snapshot=try #require(try Bridge(model:model).snapshot() as? [String:Any])
        #expect(!(snapshot["startupError"] as? String ?? "").isEmpty)
        // Resolving the unavailable location allows a fresh attempt; no reset is needed.
        try FileManager.default.removeItem(at:root)
        try await model.openWorkspace()
        #expect(model.loaded && model.startupError==nil)
    }

    @Test func todayUsesAppCloudYearMonthDespiteStaleNotebookSelection() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer {try? FileManager.default.removeItem(at:root)}
        try FileManager.default.createDirectory(at:root.appendingPathComponent("Cloud/Other Notebook"),withIntermediateDirectories:true)
        let library=try NotebookLibrary(registryURL:root.appendingPathComponent("registry.json"),cloudRoot:root.appendingPathComponent("Cloud"))
        let otherID=try #require(await library.catalog().notebooks.first?.id)
        let previous=UserDefaults.standard.string(forKey:"todayNotebookID")
        UserDefaults.standard.set(otherID,forKey:"todayNotebookID")
        defer {UserDefaults.standard.set(previous,forKey:"todayNotebookID")}
        let model=AppModel();model.notebooks=library;model.store=try KnowledgeStore(path:":memory:")
        let bridge=Bridge(model:model)
        let result=try #require(try await bridge.todayDocumentCommand("todayOpen",["notebookID":otherID,"day":"2026-09-27","timeZone":"America/New_York"]) as? [String:Any])
        #expect(result["path"] as? String == "2026/09/2026-09-27.md")
        #expect(result["notebookID"] as? String != otherID)
        #expect(FileManager.default.fileExists(atPath:root.appendingPathComponent("Cloud/Just Maple/2026/09/2026-09-27.md").path))
        #expect(!FileManager.default.fileExists(atPath:root.appendingPathComponent("Cloud/Other Notebook/2026").path))
    }

    @Test func todayRequiresAppCloudWithoutLocalFallback() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer {try? FileManager.default.removeItem(at:root)}
        let library=try NotebookLibrary(registryURL:root.appendingPathComponent("registry.json"),cloudRoot:nil)
        let model=AppModel();model.notebooks=library;model.store=try KnowledgeStore(path:":memory:")
        let bridge=Bridge(model:model)
        await #expect(throws:NotebookError.self) {try await bridge.todayDocumentCommand("todayOpen",["day":"2026-09-27"])}
    }

    @Test func bundledAngularBootsAndReceivesNativeSnapshot() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at:root.appendingPathComponent("Cloud/Fixture"),withIntermediateDirectories:true)
        let library=try NotebookLibrary(registryURL:root.appendingPathComponent("registry.json"),cloudRoot:root.appendingPathComponent("Cloud"))
        defer {try? FileManager.default.removeItem(at:root)}
        let model = AppModel()
        model.notebooks=library
        model.store = try KnowledgeStore(path: ":memory:")
        model.loaded = true
        model.name = "Angular integration test"
        let bridge = Bridge(model: model)
        bridge.step = -1
        let web = WebShell.makeWebView(bridge: bridge)
        defer { web.configuration.userContentController.removeScriptMessageHandler(forName: "maple", contentWorld: .page) }
        var text = ""
        for _ in 0..<50 {
            text = (try? await web.evaluateJavaScript("document.body.textContent") as? String) ?? ""
            if (try? await web.evaluateJavaScript("!!document.querySelector('maple-today .tiptap')") as? Bool) == true { break }
            try await Task.sleep(for: .milliseconds(100))
        }
        #expect(try await web.evaluateJavaScript("document.querySelector('maple-today .date-chip')?.textContent?.trim()") as? String == "Today")
        #expect(try await web.evaluateJavaScript("!!document.querySelector('maple-today .tiptap')") as? Bool == true)
        #expect(try await web.evaluateJavaScript("document.querySelector('maple-today .maple-editor-tools, maple-today .document-location, maple-today .document-status, maple-today h1') === null") as? Bool == true)
        #expect(!text.contains("Untrusted request."))
        #expect(try await web.evaluateJavaScript("document.querySelector('maple-root').getAttribute('ng-version')") as? String != nil)
    }
    @Test func todayAndSourcesBridgePreserveRevisionAndReplayInlineAfterEdits() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at:root.appendingPathComponent("Cloud/Fixture"),withIntermediateDirectories:true)
        defer{try? FileManager.default.removeItem(at:root)}
        let library=try NotebookLibrary(registryURL:root.appendingPathComponent("registry.json"),cloudRoot:root.appendingPathComponent("Cloud"))
        let notebookID=try #require(await library.catalog().notebooks.first?.id)
        let model=AppModel();model.notebooks=library
        let store=try KnowledgeStore(path:root.appendingPathComponent("store.db").path);model.store=store
        let coordinator=TodayDocumentCoordinator(store:store,library:library);model.todayDocuments=coordinator
        let bridge=Bridge(model:model)
        let opened=try await coordinator.open(notebookID:notebookID,day:"2026-10-30")
        let content=opened.content+"\n"+(try ManagedMarkdown.marker(["id":"request","kind":"maple-request"]))+"\n@maple Find my emails.\n"
        let saved=try #require(try await bridge.perform("documentCommit",["documentID":opened.documentID,"expectedRevision":opened.revision,"content":content,"commandID":"native-save"]) as? [String:Any])
        let revision=try #require(saved["revision"] as? String)
        let request=InlineMapleRequest(commandID:"native-inline",documentID:opened.documentID,requestBlockID:"request",expectedRevision:revision,text:"Find my emails.")
        let run=try await store.queueInlineMaple(request,provider:"synthetic-never-executed")
        _ = try await store.cancelInlineMaple(run.runID)
        _ = try await coordinator.commit(documentID:opened.documentID,expectedRevision:revision,content:content+"\nLater writing.\n",commandID:"later")
        let replay=try #require(try await bridge.perform("mapleSubmit",["commandID":request.commandID,"documentID":request.documentID,"requestBlockID":request.requestBlockID,"expectedRevision":request.expectedRevision,"text":request.text]) as? [String:Any])
        #expect(replay["runID"] as? String == run.runID)
        #expect(replay["status"] as? String == "canceled")
        #expect(model.inlineTasks.isEmpty)
        let page=try #require(try await bridge.perform("sourceList",["query":["types":[],"connectors":[],"accounts":[],"states":[],"receivedAfter":"2000-01-01T00:00:00.000Z","receivedBefore":"2099-12-31T23:59:59.999Z"]]) as? [String:Any])
        #expect((page["total"] as? Int ?? 0)>0)
    }
    @Test func routerFragmentsStayWithinBundledDocument() {
        let bridge = Bridge(model: AppModel())
        bridge.page = URL(string: "app://localhost/")
        #expect(bridge.isBundledPage(URL(string: "app://localhost/#/calendar")))
        #expect(!bridge.isBundledPage(URL(string: "app://localhost/other.html#/calendar")))
        #expect(!bridge.isBundledPage(URL(string: "https://example.com/index.html")))
    }
    @Test func unknownAndOversizedCommandsAreRejected() async throws {
        let bridge = Bridge(model: AppModel())
        do { _ = try await bridge.perform("evaluate", ["code": "anything"]); Issue.record("Unknown command accepted") } catch {}
        do { _ = try await bridge.perform("capture", ["text": String(repeating: "x", count: 262145)]); Issue.record("Oversized content accepted") } catch {}
        do { _ = try await bridge.perform("step", ["value": -1]); Issue.record("Incomplete onboarding accepted") } catch {}
    }
    @Test func snapshotNeverIncludesAPIKey() throws {
        let model = AppModel()
        model.key = "SENTINEL-SECRET-DO-NOT-EXPOSE"
        model.homeToken = "HOME-SECRET-SENTINEL"
        let snapshot = try Bridge(model: model).snapshot()
        let encoded = try JSONSerialization.data(withJSONObject: snapshot)
        #expect(!String(decoding: encoded, as: UTF8.self).contains(model.key))
        #expect(!String(decoding: encoded, as: UTF8.self).contains(model.homeToken!))
    }
    @Test func webCaptureUsesNormalIngestionAndSearch() async throws {
        let model = AppModel()
        model.store = try KnowledgeStore(path: ":memory:")
        let bridge = Bridge(model: model)
        _ = try await bridge.perform("capture", ["text": "Remember the alpine project <script>alert('test')</script>"])
        #expect(try await model.store?.eventCount() == 1)
        let result = try await bridge.perform("search", ["query": "alpine"]) as? [[String: Any]]
        #expect(result?.count == 1)
        #expect((result?.first?["content"] as? String)?.contains("<script>") == true)
        #expect(try await model.store?.queue().count == 1)
    }
    @Test func worldCommandsPersistCanonicalTaskThroughNativeBridge() async throws {
        let model=AppModel();model.store=try KnowledgeStore(path:":memory:")
        let bridge=Bridge(model:model)
        var activity=LifeActivity();activity.name="Bridge fixture"
        let activityJSON=try JSONSerialization.jsonObject(with:JSONCodec.encode(activity))
        _ = try await bridge.perform("saveActivity",["record":activityJSON,"expectedVersion":0,"requestID":"activity"])
        var task=LifeTask();task.title="Bridge fixture task";task.activityIDs=[activity.id]
        let taskJSON=try JSONSerialization.jsonObject(with:JSONCodec.encode(task))
        _ = try await bridge.perform("saveTask",["record":taskJSON,"expectedVersion":0,"requestID":"task"])
        #expect(model.world?.tasks.count==1)
        task=try #require(model.world?.tasks.first);task.status = .completed
        let completedJSON=try JSONSerialization.jsonObject(with:JSONCodec.encode(task))
        _ = try await bridge.perform("saveTask",["record":completedJSON,"expectedVersion":1,"requestID":"complete"])
        #expect(model.world?.tasks.first?.status == .completed)
        #expect(model.world?.activities.count==1)
        #expect(model.world?.history.contains{$0.type=="task.completed"} == true)
    }

    @Test func loopsRequireConnectionAndCannotOverlapAuditButCanPause() async throws {
        let model=AppModel(); let bridge=Bridge(model:model)
        do {_ = try await bridge.perform("loop",[:]);Issue.record("Started without Jev")} catch {}
        #expect(!model.running)
        model.connected=true
        #expect(model.running)
        _ = try await bridge.perform("loop",[:]);#expect(!model.running)
        model.auditRunning=true
        do {_ = try await bridge.perform("loop",[:]);Issue.record("Started during audit")} catch {}
        #expect(!model.running)
        model.auditRunning=false
        _ = try await bridge.perform("loop",[:]);#expect(model.running)
        model.busy=true
        _ = try await bridge.perform("loop",[:]);#expect(!model.running)
        model.connected=false;#expect(!model.running)
        model.connected=true;#expect(model.running)
    }

}
