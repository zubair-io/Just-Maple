import Foundation
import Testing
import MapleCore
@testable import Just_Maple

private struct SyntheticLocalClassifier: FactCheckingClassifier {
    let providerID = "synthetic-local"
    func classify(_ context: Context) async throws -> ClassifierResult {
        throw MapleError.invalid("This host-selection fixture does not perform inference.")
    }
    func checkFacts(_ context: Context, audit: @escaping ProviderAuditSink) async throws -> (probability: Double, model: String, rawResponse: Data) {
        throw MapleError.invalid("This host-selection fixture does not perform inference.")
    }
}
private actor DelayedLocalLoader {
    private var continuations: [CheckedContinuation<any FactCheckingClassifier, Error>] = []
    func load() async throws -> any FactCheckingClassifier {
        try await withCheckedThrowingContinuation { continuations.append($0) }
    }
    func count() -> Int { continuations.count }
    func succeed(_ index: Int) { continuations[index].resume(returning: SyntheticLocalClassifier()) }
    func fail(_ index: Int) { continuations[index].resume(throwing: MapleError.invalid("Old synthetic load failed")) }
}
@MainActor struct ClassifierSelectionTests {
    private func temporaryDirectory() throws -> URL {
        let path=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString,isDirectory:true)
        try FileManager.default.createDirectory(at:path,withIntermediateDirectories:true)
        return path
    }
    private func preferences(selection: String? = "laya") -> UserDefaults {
        let prefs = UserDefaults(suiteName:"maple-classifier-test-"+UUID().uuidString)!
        if let selection { prefs.set(selection, forKey:"classificationProvider") }
        return prefs
    }
    private func waitForLoad(_ model: AppModel) async {
        for _ in 0..<100 {
            if model.classificationState != "loading" {return}
            try? await Task.sleep(for:.milliseconds(10))
        }
        Issue.record("Synthetic classifier load did not settle")
    }
    private func approve(_ path: URL, revision: String = LayaClassifier.modelRevision, approved: Bool = true, adapter: String = LayaClassifier.adapterVersion) throws {
        try JSONSerialization.data(withJSONObject:["approved":approved,"modelRevision":revision,"adapter":adapter]).write(to:path.appendingPathComponent("validation.json"))
    }
    @Test func defaultRolloutRequiresApprovedPinnedModelAndPreservesExplicitChoice() throws {
        let path=try temporaryDirectory();defer{try? FileManager.default.removeItem(at:path)}
        let prefs=preferences(selection:nil)
        #expect(AppModel(classificationDefaults:prefs,layaDirectory:path).classificationProvider=="jev")
        prefs.set("codex",forKey:"extractionProvider")
        prefs.set("obsolete",forKey:"classificationProvider")
        #expect(AppModel(classificationDefaults:prefs,layaDirectory:path).classificationProvider=="jev")
        try approve(path,approved:false)
        #expect(AppModel(classificationDefaults:prefs,layaDirectory:path).classificationProvider=="jev")
        try approve(path,revision:"different-model")
        #expect(AppModel(classificationDefaults:prefs,layaDirectory:path).classificationProvider=="jev")
        try approve(path)
        let approved=AppModel(classificationDefaults:prefs,layaDirectory:path)
        #expect(approved.classificationProvider=="laya")
        #expect(!approved.connected);#expect(!approved.running)
        prefs.set("jev",forKey:"classificationProvider")
        #expect(AppModel(classificationDefaults:prefs,layaDirectory:path).classificationProvider=="jev")
        try approve(path,approved:false)
        prefs.set("laya",forKey:"classificationProvider")
        #expect(AppModel(classificationDefaults:prefs,layaDirectory:path).classificationProvider=="laya")
    }
    @Test func missingAndFailedModelsRemainLocalAndKeepPendingEvents() async throws {
        let path=try temporaryDirectory();defer{try? FileManager.default.removeItem(at:path)}
        let model=AppModel(classificationDefaults:preferences(),layaDirectory:path.appendingPathComponent("missing"),layaLoader:{_ in SyntheticLocalClassifier()})
        model.store=try KnowledgeStore(path:":memory:")
        _=try await model.store?.ingest(Event(type:"note.created",source:.init(connector:"fixture",account:"test",externalID:"1",revision:"1"),occurredAt:Date(),subjects:["person:self"],content:"Synthetic queued note"))
        model.beginClassifierLoad();await waitForLoad(model)
        #expect(model.classificationState=="model_missing");#expect(model.classificationProvider=="laya")
        #expect(model.classifier==nil);#expect(!model.running);#expect(try await model.store?.eventCount()==1)
        let failed=AppModel(classificationDefaults:preferences(),layaDirectory:path,layaLoader:{_ in throw MapleError.invalid("Synthetic invalid model")})
        failed.beginClassifierLoad();await waitForLoad(failed)
        #expect(failed.classificationState=="load_failed");#expect(!failed.connected);#expect(!failed.classificationCanRun)
        #expect(failed.classificationStatus.contains("Queued events are retained"))
    }
    @Test func loadedButUnapprovedModelCannotStartLoopManualFactsOrAudit() async throws {
        let path=try temporaryDirectory();defer{try? FileManager.default.removeItem(at:path)}
        let model=AppModel(classificationDefaults:preferences(),layaDirectory:path,layaLoader:{_ in SyntheticLocalClassifier()})
        model.beginClassifierLoad();await waitForLoad(model)
        #expect(model.connected);#expect(!model.running);#expect(!model.classificationCanRun)
        #expect(model.classificationState=="validation_required")
        let bridge=Bridge(model:model)
        do{_ = try await bridge.perform("loop",[:]);Issue.record("Unvalidated model started")}catch{}
        do{_ = try await bridge.perform("checkFacts",["id":"synthetic"]);Issue.record("Unvalidated model checked facts")}catch{}
        await model.runConnectorAudit(query:"synthetic",local:true)
        #expect(!model.auditRunning);#expect(model.auditStatus.contains("validated"))
    }
    @Test func approvalMustMatchPinnedRevisionBeforeProcessingRuns() async throws {
        let path=try temporaryDirectory();defer{try? FileManager.default.removeItem(at:path)}
        try approve(path,revision:"wrong-model")
        #expect(!AppModel.layaValidationApproved(directory:path))
        try approve(path,approved:false)
        #expect(!AppModel.layaValidationApproved(directory:path))
        try approve(path,adapter:"older-prompts")
        #expect(!AppModel.layaValidationApproved(directory:path))
        try approve(path)
        let model=AppModel(classificationDefaults:preferences(),layaDirectory:path,layaLoader:{_ in SyntheticLocalClassifier()})
        model.beginClassifierLoad();await waitForLoad(model)
        #expect(model.classificationState=="ready");#expect(model.classificationCanRun);#expect(model.running)
        #expect(model.classifier?.providerID=="synthetic-local")
    }
    @Test func validationReasonIsBoundedAndVisible() async throws {
        let path=try temporaryDirectory();defer{try? FileManager.default.removeItem(at:path)}
        let reason="Routing validation failed: 9/15 screening cases passed. " + String(repeating:"x",count:600)
        try JSONSerialization.data(withJSONObject:["approved":false,"reason":reason]).write(to:path.appendingPathComponent("validation.json"))
        #expect(AppModel.layaValidationReason(directory:path)?.count==512)
        let model=AppModel(classificationDefaults:preferences(),layaDirectory:path,layaLoader:{_ in SyntheticLocalClassifier()})
        model.beginClassifierLoad();await waitForLoad(model)
        #expect(model.classificationStatus.contains("9/15 screening cases passed"))
        #expect(!model.classificationCanRun)
    }
    @Test func staleLoadFailureDoesNotReplaceTheNewlySelectedModel() async throws {
        let path=try temporaryDirectory();defer{try? FileManager.default.removeItem(at:path)}
        try approve(path);let loader=DelayedLocalLoader()
        let model=AppModel(classificationDefaults:preferences(),layaDirectory:path,layaLoader:{_ in try await loader.load()})
        model.beginClassifierLoad()
        while await loader.count()<1 {await Task.yield()}
        model.beginClassifierLoad()
        while await loader.count()<2 {await Task.yield()}
        await loader.succeed(1);await waitForLoad(model)
        await loader.fail(0);await Task.yield()
        #expect(model.classificationState=="ready");#expect(model.running)
    }
}
