import Foundation
import Testing
import MapleCore
import CryptoKit
import MapleNotebooks
import WebKit
@testable import Just_Maple

@MainActor
struct QualityCaptureBridgeTests {
    private func hash(_ text:String)->String {SHA256.hash(data:Data(text.utf8)).map{String(format:"%02x",$0)}.joined()}
    @Test func bundledProcessingPanelCapturesThroughRealWebKitBridge()async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer {try? FileManager.default.removeItem(at:root)}
        try FileManager.default.createDirectory(at:root.appendingPathComponent("Cloud"),withIntermediateDirectories:true)
        let model=AppModel(directory:root),store=try KnowledgeStore(path:":memory:")
        model.store=store;model.loaded=true;model.name="Synthetic quality capture integration"
        model.world=try await store.worldSnapshot(at:Date().addingTimeInterval(-2))
        model.notebooks=try NotebookLibrary(registryURL:root.appendingPathComponent("registry.json"),cloudRoot:root.appendingPathComponent("Cloud"))
        let bridge=Bridge(model:model);bridge.step = -1
        let web=WebShell.makeWebView(bridge:bridge)
        web.load(URLRequest(url:URL(string:"app://localhost/#/processing")!))
        defer {web.configuration.userContentController.removeScriptMessageHandler(forName:"maple",contentWorld:.page)}
        for _ in 0..<100 {
            if (try? await web.evaluateJavaScript("!!document.querySelector('a.processing-link')") as? Bool)==true {break}
            try await Task.sleep(for:.milliseconds(50))
        }
        for _ in 0..<100 {
            if (try? await web.evaluateJavaScript("!!document.querySelector('maple-quality-capture button:not(:disabled)')") as? Bool)==true {break}
            try await Task.sleep(for:.milliseconds(50))
        }
        #expect(try await web.evaluateJavaScript("typeof crypto.subtle?.digest === 'function' && typeof crypto.randomUUID === 'function'") as? Bool == true)
        _ = try await web.evaluateJavaScript("document.querySelector('maple-quality-capture details').open=true; document.querySelector('maple-quality-capture button').click(); true")
        var text=""
        for _ in 0..<150 {
            text=(try? await web.evaluateJavaScript("document.querySelector('maple-quality-capture').textContent") as? String) ?? ""
            if text.contains("Saved privately on this Mac") {break}
            if (try? await web.evaluateJavaScript("!!document.querySelector('maple-quality-capture [role=alert]')") as? Bool)==true {break}
            try await Task.sleep(for:.milliseconds(50))
        }
        #expect(text.contains("Saved privately on this Mac"),Comment(rawValue:text))
        let children=try FileManager.default.contentsOfDirectory(at:root.appendingPathComponent("QualityCaptures"),includingPropertiesForKeys:nil)
        #expect(children.filter{!$0.lastPathComponent.hasPrefix(".")}.count==1)
    }
    @Test func explicitNativeCaptureMatchesReceiptAndRecoversAfterCachedWorldMoves()async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer {try? FileManager.default.removeItem(at:root)}
        let model=AppModel(directory:root),store=try KnowledgeStore(path:":memory:");model.store=store;model.loaded=true
        let at=Date().addingTimeInterval(-2),world=try await store.worldSnapshot(at:at);model.world=world
        let worldJSON=String(decoding:try JSONCodec.encode(world),as:UTF8.self),worldHash=hash(worldJSON)
        let formatter=ISO8601DateFormatter();formatter.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
        let capturedAt=formatter.string(from:Date()),id=UUID().uuidString.lowercased()
        let projection:[String:Any]=["schemaVersion":1,"kind":"current-ui-task-projection","currentOnly":true,"scope":"unfiltered-task-tabs","visibility":"tab-membership-not-viewport","capturedAt":capturedAt,
            "world":["revision":world.revision,"asOf":formatter.string(from:at),"hash":["algorithm":"SHA-256","value":worldHash,"verified":false,"source":"caller-supplied"]],
            "surfaces":["needsYou":[],"waiting":[],"later":[]],"topTenNeedsYou":[]]
        let projectionJSON=String(decoding:try JSONSerialization.data(withJSONObject:projection,options:[.sortedKeys]),as:UTF8.self)
        let request=QualityCaptureRequest(captureID:id,worldRevision:world.revision,worldJSON:worldJSON,worldSHA256:worldHash,projectionJSON:projectionJSON,projectionSHA256:hash(projectionJSON),capturedAt:capturedAt)
        let body=try #require(try JSONSerialization.jsonObject(with:JSONCodec.encode(request)) as? [String:Any]),bridge=Bridge(model:model)
        let result=try #require(try await bridge.perform("qualityCapture",body) as? [String:Any])
        #expect(result["status"] as? String == "saved" && result["evaluation"] as? String == "not_run")
        #expect(result["worldSHA256"] as? String == worldHash && result["captureID"] as? String == id)
        let path=try #require(result["path"] as? String)
        #expect(path.hasPrefix(root.appendingPathComponent("QualityCaptures").path))
        #expect(FileManager.default.fileExists(atPath:URL(fileURLWithPath:path).appendingPathComponent("core.sqlite").path))
        model.world=nil // A lost receipt retry must not require the old mutable UI cache.
        let retried=try #require(try await bridge.perform("qualityCapture",body) as? [String:Any])
        #expect(NSDictionary(dictionary:retried).isEqual(to:result))
        var fresh=body;fresh["captureID"]=UUID().uuidString.lowercased()
        let stale=try #require(try await bridge.perform("qualityCapture",fresh) as? [String:Any])
        #expect(stale["status"] as? String == "stale")
        model.loaded=false
        await #expect(throws:Error.self){_ = try await bridge.perform("qualityCapture",body)}
    }
}
