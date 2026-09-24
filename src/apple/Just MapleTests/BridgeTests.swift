import Foundation
import Testing
import WebKit
import MapleCore
@testable import Just_Maple

@MainActor
struct BridgeTests {
    @Test func bundledAngularBootsAndReceivesNativeSnapshot() async throws {
        let model = AppModel()
        model.loaded = true
        model.name = "Angular integration test"
        let bridge = Bridge(model: model)
        bridge.step = -1
        let web = WebShell.makeWebView(bridge: bridge)
        defer { web.configuration.userContentController.removeScriptMessageHandler(forName: "maple", contentWorld: .page) }
        var text = ""
        for _ in 0..<50 {
            text = (try? await web.evaluateJavaScript("document.body.textContent") as? String) ?? ""
            if text.contains(", Angular integration test.") { break }
            try await Task.sleep(for: .milliseconds(100))
        }
        #expect(text.contains(", Angular integration test."))
        #expect(!text.contains("Untrusted request."))
        #expect(try await web.evaluateJavaScript("document.querySelector('maple-root').getAttribute('ng-version')") as? String != nil)
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
