import Foundation
import Testing
@testable import MapleCore

struct QualityCaptureTests {
    private func directory()throws->URL {
        let url=FileManager.default.temporaryDirectory.appendingPathComponent("quality-fixture-"+UUID().uuidString,isDirectory:true)
        try FileManager.default.createDirectory(at:url,withIntermediateDirectories:true)
        return url
    }
    private func instant(_ date:Date)->String {
        let format=ISO8601DateFormatter();format.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
        return format.string(from:date)
    }
    private func request(_ world:WorldSnapshot,id:String=UUID().uuidString,rows:[[String:Any]]?=nil)throws->QualityCaptureRequest {
        let worldJSON=try JSONCodec.string(world),worldHash=KnowledgeStore.captureHash(Data(worldJSON.utf8))
        let captured=instant(Date().addingTimeInterval(1))
        let items=rows ?? world.tasks.map{task -> [String:Any] in
            let node:[String:Any]=["id":"task:"+task.id,"version":task.version]
            return ["rankedNode":node,"renderedRow":node,"sourceEventIDs":task.evidenceIDs]
        }
        let projection:[String:Any]=[
            "schemaVersion":1,"kind":"current-ui-task-projection","currentOnly":true,
            "scope":"unfiltered-task-tabs","visibility":"tab-membership-not-viewport","capturedAt":captured,
            "world":["revision":world.revision,"asOf":instant(world.asOf),"hash":["algorithm":"SHA-256","value":worldHash]],
            "surfaces":["needsYou":items,"waiting":[],"later":[]],"topTenNeedsYou":Array(items.prefix(10))]
        let json=String(decoding:try JSONSerialization.data(withJSONObject:projection,options:[.sortedKeys]),as:UTF8.self)
        return QualityCaptureRequest(captureID:id,worldRevision:world.revision,worldJSON:worldJSON,worldSHA256:worldHash,projectionJSON:json,projectionSHA256:KnowledgeStore.captureHash(Data(json.utf8)),capturedAt:captured)
    }
    private func seed(_ store:KnowledgeStore,title:String="Synthetic capture task")async throws->LifeTask {
        var task=LifeTask();task.title=title
        return try await store.saveTask(task,expectedVersion:0,requestID:UUID().uuidString)
    }
    private func replacement(_ input:QualityCaptureRequest,id:String?=nil,worldSHA:String?=nil,projectionSHA:String?=nil)->QualityCaptureRequest {
        QualityCaptureRequest(captureID:id ?? input.captureID,worldRevision:input.worldRevision,worldJSON:input.worldJSON,worldSHA256:worldSHA ?? input.worldSHA256,projectionJSON:input.projectionJSON,projectionSHA256:projectionSHA ?? input.projectionSHA256,capturedAt:input.capturedAt)
    }

    @Test func acceptedCaptureFreezesWALDataAndPrivateArtifactsAcrossRetry()async throws {
        let root=try directory();defer {try? FileManager.default.removeItem(at:root)}
        let database=root.appendingPathComponent("live.sqlite"),exports=root.appendingPathComponent("captures")
        let store=try KnowledgeStore(path:database.path)
        let task=try await seed(store)
        #expect(FileManager.default.fileExists(atPath:database.path+"-wal"))
        let world=try await store.worldSnapshot(),input=try request(world)
        let receipt=try await store.captureQualitySnapshot(input,expectedWorld:world,directory:exports)
        #expect(receipt.status=="saved" && receipt.evaluation=="not_run")
        let saved=URL(fileURLWithPath:try #require(receipt.path)),snapshot=saved.appendingPathComponent("core.sqlite")
        for dir in [exports,saved] {
            #expect((try FileManager.default.attributesOfItem(atPath:dir.path)[.posixPermissions] as? NSNumber)?.intValue==0o700)
        }
        for name in ["core.sqlite","world.json","projection.json","capture.json"] {
            #expect((try FileManager.default.attributesOfItem(atPath:saved.appendingPathComponent(name).path)[.posixPermissions] as? NSNumber)?.intValue==0o600)
        }
        #expect(try String(contentsOf:saved.appendingPathComponent("world.json"),encoding:.utf8)==input.worldJSON)
        #expect(try String(contentsOf:saved.appendingPathComponent("projection.json"),encoding:.utf8)==input.projectionJSON)
        let bytes=try Data(contentsOf:snapshot)
        let second=try await seed(store,title:"Synthetic task created after capture")
        // Idempotent retry succeeds despite current world drift or absent accepted-world cache.
        let retry=try await store.captureQualitySnapshot(input,expectedWorld:nil,directory:exports)
        #expect(try JSONCodec.string(retry)==JSONCodec.string(receipt))
        #expect(try Data(contentsOf:snapshot)==bytes)
        // Inspect a disposable copy; SQLite initialization may touch journal mode on open.
        let readCopy=root.appendingPathComponent("inspect.sqlite")
        try bytes.write(to:readCopy)
        let frozen=try SQLite(path:readCopy.path)
        #expect(try frozen.rows("PRAGMA integrity_check").first?["integrity_check"]=="ok")
        #expect(try frozen.rows("SELECT id FROM life_tasks").map{$0["id"]}==[task.id])
        #expect(try frozen.rows("SELECT id FROM life_tasks WHERE id=?",[second.id]).isEmpty)
        #expect(try FileManager.default.contentsOfDirectory(atPath:exports.path)==[input.captureID.lowercased()])
    }

    @Test func currentWorldDriftReturnsStaleAndDoesNotPublishCapture()async throws {
        let root=try directory();defer {try? FileManager.default.removeItem(at:root)}
        let store=try KnowledgeStore(path:":memory:")
        _ = try await seed(store)
        let old=try await store.worldSnapshot(),input=try request(old)
        _ = try await seed(store,title:"Synthetic later task")
        let receipt=try await store.captureQualitySnapshot(input,expectedWorld:old,directory:root)
        #expect(receipt.status=="stale" && receipt.path==nil)
        #expect(try FileManager.default.contentsOfDirectory(atPath:root.path).isEmpty)
        let missing=try await store.captureQualitySnapshot(input,expectedWorld:nil,directory:root)
        #expect(missing.status=="stale")
    }

    @Test func rejectsHashMismatchUnknownProjectionIdentityAndReusedCaptureID()async throws {
        let root=try directory();defer {try? FileManager.default.removeItem(at:root)}
        let store=try KnowledgeStore(path:":memory:")
        _ = try await seed(store)
        let world=try await store.worldSnapshot(),valid=try request(world)
        await #expect(throws:Error.self){try await store.captureQualitySnapshot(replacement(valid,worldSHA:"bad"),expectedWorld:world,directory:root)}
        await #expect(throws:Error.self){try await store.captureQualitySnapshot(replacement(valid,projectionSHA:"bad"),expectedWorld:world,directory:root)}
        let node:[String:Any]=["id":"task:unknown","version":1]
        let bad=try request(world,rows:[["rankedNode":node,"renderedRow":node,"sourceEventIDs":[]]])
        await #expect(throws:Error.self){try await store.captureQualitySnapshot(bad,expectedWorld:world,directory:root)}
        _ = try await store.captureQualitySnapshot(valid,expectedWorld:world,directory:root)
        let changed=try request(world,id:valid.captureID,rows:[])
        await #expect(throws:Error.self){try await store.captureQualitySnapshot(changed,expectedWorld:world,directory:root)}
    }

    @Test func corruptedDatabaseOrReceiptIsNotAcceptedAsIdempotentSuccess()async throws {
        let root=try directory();defer {try? FileManager.default.removeItem(at:root)}
        let store=try KnowledgeStore(path:":memory:")
        _ = try await seed(store)
        let world=try await store.worldSnapshot(),input=try request(world)
        let receipt=try await store.captureQualitySnapshot(input,expectedWorld:world,directory:root)
        let saved=URL(fileURLWithPath:try #require(receipt.path)),db=saved.appendingPathComponent("core.sqlite")
        let original=try Data(contentsOf:db)
        try Data("corrupted fixture".utf8).write(to:db)
        await #expect(throws:Error.self){try await store.captureQualitySnapshot(input,expectedWorld:nil,directory:root)}
        try original.write(to:db)
        let manifest=saved.appendingPathComponent("capture.json")
        var value=try #require(JSONSerialization.jsonObject(with:Data(contentsOf:manifest)) as? [String:Any])
        var altered=try #require(value["receipt"] as? [String:Any]);altered["path"]="/fixture/wrong-path";value["receipt"]=altered
        try JSONSerialization.data(withJSONObject:value).write(to:manifest)
        await #expect(throws:Error.self){try await store.captureQualitySnapshot(input,expectedWorld:nil,directory:root)}
    }

    @Test func backupUsesPinnedReadSnapshotWhileOtherConnectionCommitsNewWALRows()throws {
        let root=try directory();defer {try? FileManager.default.removeItem(at:root)}
        let source=root.appendingPathComponent("live.sqlite"),target=root.appendingPathComponent("snapshot.sqlite")
        let first=try SQLite(path:source.path),writer=try SQLite(path:source.path)
        try first.execute("CREATE TABLE fixture_items(id TEXT PRIMARY KEY)")
        try first.execute("INSERT INTO fixture_items VALUES ('before')")
        #expect(FileManager.default.createFile(atPath:target.path,contents:Data()))
        try first.readTransaction {
            #expect(try first.rows("SELECT id FROM fixture_items").map{$0["id"]}==["before"])
            try writer.execute("INSERT INTO fixture_items VALUES ('after')")
            #expect(try first.rows("SELECT id FROM fixture_items").map{$0["id"]}==["before"])
            try first.backup(to:target)
        }
        #expect(try first.rows("SELECT id FROM fixture_items").count==2)
        let frozen=try SQLite(path:target.path)
        #expect(try frozen.rows("SELECT id FROM fixture_items").map{$0["id"]}==["before"])
    }
}
