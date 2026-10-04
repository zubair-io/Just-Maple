import Foundation
import Testing
@testable import MapleCore

/// Synthetic storage/serialization interoperability only. No quality labels or live providers.
struct QualityExportIntegrationTests {
    private func instant(_ date:Date)->String {
        let formatter=ISO8601DateFormatter()
        formatter.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
        return formatter.string(from:date)
    }
    private func write(_ value:[String:Any],to url:URL)throws {
        try JSONSerialization.data(withJSONObject:value,options:[.sortedKeys]).write(to:url)
    }
    private func object(_ url:URL)throws->[String:Any] {
        try #require(JSONSerialization.jsonObject(with:Data(contentsOf:url)) as? [String:Any])
    }

    @Test func actualSwiftCaptureExportsThroughPythonWithBoundSourceAndTask()async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent("quality-export-integration-"+UUID().uuidString,isDirectory:true)
        try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
        defer {try? FileManager.default.removeItem(at:root)}
        let store=try KnowledgeStore(path:root.appendingPathComponent("synthetic.sqlite").path)
        let event=Event(type:"message.received",source:Source(connector:"gmail",account:"synthetic-local",externalID:"synthetic-message",revision:"1"),occurredAt:Date(timeIntervalSince1970:floor(Date().timeIntervalSince1970)-60),subjects:["person:self"],content:"Please return the synthetic café / form.")
        try await store.ingest(event)
        var inputTask=LifeTask();inputTask.title="Return synthetic café / form 📝 \"quoted\"\nSecond line\u{2028}Line separator\u{2029}Paragraph separator";inputTask.evidenceIDs=[event.id]
        let task=try await store.saveTask(inputTask,expectedVersion:0,requestID:UUID().uuidString)
        // Avoid formatting a fractional asOf up past capturedAt; all clocks describe current synthetic state.
        let world=try await store.worldSnapshot(at:Date(timeIntervalSince1970:floor(Date().timeIntervalSince1970)))
        let capturedAt=instant(Date()),worldJSON=try JSONCodec.string(world)
        let worldHash=KnowledgeStore.captureHash(Data(worldJSON.utf8))
        let node:[String:Any]=["id":"task:"+task.id,"version":task.version]
        let row:[String:Any]=["rankedNode":node,"renderedRow":node,"sourceEventIDs":[event.id]]
        let projection:[String:Any]=[
            "schemaVersion":1,"kind":"current-ui-task-projection","currentOnly":true,
            "scope":"unfiltered-task-tabs","visibility":"tab-membership-not-viewport","capturedAt":capturedAt,
            "world":["revision":world.revision,"asOf":instant(world.asOf),"hash":["algorithm":"SHA-256","value":worldHash]],
            "surfaces":["needsYou":[row],"waiting":[],"later":[]],"topTenNeedsYou":[row]]
        let projectionJSON=String(decoding:try JSONSerialization.data(withJSONObject:projection,options:[.sortedKeys]),as:UTF8.self)
        let capture=QualityCaptureRequest(captureID:UUID().uuidString,worldRevision:world.revision,worldJSON:worldJSON,worldSHA256:worldHash,projectionJSON:projectionJSON,projectionSHA256:KnowledgeStore.captureHash(Data(projectionJSON.utf8)),capturedAt:capturedAt)
        let receipt=try await store.captureQualitySnapshot(capture,expectedWorld:world,directory:root.appendingPathComponent("captures"))
        #expect(receipt.status=="saved")
        let directory=URL(fileURLWithPath:try #require(receipt.path))
        let names=["capture.json","core.sqlite","world.json","projection.json"]
        let before=try Dictionary(uniqueKeysWithValues:names.map{($0,try Data(contentsOf:directory.appendingPathComponent($0)))})
        let manifest:[String:Any]=[
            "schemaVersion":1,"kind":"manifest","id":"SYNTHETIC-SWIFT-EXPORT-INTEGRATION","datasetKind":"synthetic_scorer_test",
            "selection":["seed":"synthetic-fixture","method":"Explicit single synthetic source and canonical task","frozenAt":capturedAt,"holdoutFrozenBeforeTuning":true],
            "sourceSamples":[["id":"source-sample","stratum":"direct_obligation","split":"holdout","sourceIdentity":["connector":"gmail","accountRef":"synthetic-account","externalID":event.source.externalID,"revision":"1"],"occurredAt":instant(event.occurredAt),"snapshotAt":capturedAt,"eligible30Days":true]],
            "taskSamples":[["id":"task-sample","taskID":"task:"+task.id,"revision":task.version,"snapshotID":"snapshot","split":"holdout","sourceEventIDs":[event.id]]],
            "snapshots":[["id":"snapshot","at":capturedAt,"split":"holdout","needsYouVisibleCount":1,"needsYouTaskSampleIDs":["task-sample"]]]]
        let mapping:[String:Any]=[
            "schemaVersion":1,"snapshots":["snapshot":capture.captureID],
            "sources":["source-sample":["captureID":capture.captureID,"eventID":event.id]],
            "accounts":["synthetic-account":["connector":"gmail","account":"synthetic-local"]]]
        let manifestURL=root.appendingPathComponent("manifest.json"),mapURL=root.appendingPathComponent("snapshot-map.json"),output=root.appendingPathComponent("export")
        try write(manifest,to:manifestURL);try write(mapping,to:mapURL)
        var repository=URL(fileURLWithPath:#filePath)
        for _ in 0..<7 {repository.deleteLastPathComponent()}
        let script=repository.appendingPathComponent("scripts/daily-action-predictions.py")
        #expect(FileManager.default.fileExists(atPath:script.path))
        let process=Process(),pipe=Pipe()
        process.executableURL=URL(fileURLWithPath:"/usr/bin/python3")
        process.arguments=["-B",script.path,"--capture",directory.path,"--manifest",manifestURL.path,"--snapshot-map",mapURL.path,"--output",output.path,"--pipeline-version","synthetic-swift-integration"]
        process.currentDirectoryURL=root
        process.standardOutput=pipe;process.standardError=pipe
        try process.run()
        let console=String(decoding:pipe.fileHandleForReading.readDataToEndOfFile(),as:UTF8.self)
        process.waitUntilExit()
        try #require(process.terminationStatus==0,"Exporter failed: \(console)")
        let predictions=try object(output.appendingPathComponent("predictions.json")),diagnostics=try object(output.appendingPathComponent("diagnostics.json"))
        #expect(predictions["schemaVersion"] as? Int==2)
        #expect(predictions["manifestID"] as? String==manifest["id"] as? String)
        let run=try #require(predictions["run"] as? [String:Any]),runCoverage=try #require(run["coverage"] as? [String:Any])
        #expect(runCoverage["status"] as? String=="unknown")
        let sources=try #require(predictions["sourcePredictions"] as? [[String:Any]]),tasks=try #require(predictions["taskPredictions"] as? [[String:Any]])
        #expect(sources.count==1 && tasks.count==1)
        #expect(sources.first?["sampleID"] as? String=="source-sample")
        #expect(sources.first?["status"] as? String=="pending")
        #expect(sources.first?["surfacedTaskIDs"] as? [String]==["task:"+task.id])
        #expect(sources.first?["needsYouTaskIDs"] as? [String]==["task:"+task.id])
        #expect(tasks.first?["taskID"] as? String=="task:"+task.id)
        #expect(tasks.first?["surface"] as? String=="needs_you")
        #expect((predictions["automaticCompletions"] as? [Any])?.isEmpty==true)
        #expect(diagnostics["evaluation"] as? String=="not_run")
        #expect((diagnostics["capturedDispatches"] as? [Any])?.isEmpty==true)
        let bindings=try #require(diagnostics["captures"] as? [[String:Any]])
        #expect(bindings.first?["captureID"] as? String==capture.captureID)
        #expect(bindings.first?["worldSHA256"] as? String==capture.worldSHA256)
        #expect(bindings.first?["projectionSHA256"] as? String==capture.projectionSHA256)
        for name in names {#expect(try Data(contentsOf:directory.appendingPathComponent(name))==before[name])}
        #expect(!FileManager.default.fileExists(atPath:directory.appendingPathComponent("core.sqlite-wal").path))
        #expect(!FileManager.default.fileExists(atPath:directory.appendingPathComponent("core.sqlite-shm").path))
    }
}
