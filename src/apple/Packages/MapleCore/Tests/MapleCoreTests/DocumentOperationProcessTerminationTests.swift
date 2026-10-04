import Foundation
import Darwin
import Testing
import MapleNotebooks
@testable import MapleCore

private final class OperationProcessTestBundle:NSObject {}
private struct OperationProcessFixture:Codable {
    let notebookID:String,sourceID:String,sourcePath:String,sourceBefore:String,targetID:String,targetPath:String,targetBefore:String
    let input:DocumentBlockMutation,taskID:String
}
extension KnowledgeStore {
    fileprivate func operationProcessRows(_ sql:String)throws->[[String:String]] {try db.rows(sql)}
}

/// Real SIGKILL of synthetic SwiftPM helpers. This proves process recovery, not power-loss atomicity.
struct DocumentOperationProcessTerminationTests {
    private let rootKey="MAPLE_OPERATION_PROCESS_TEST_ROOT",modeKey="MAPLE_OPERATION_PROCESS_TEST_MODE",checkpointKey="MAPLE_OPERATION_PROCESS_TEST_CHECKPOINT",kindKey="MAPLE_OPERATION_PROCESS_TEST_KIND"
    private let command="synthetic-operation",blockID="operation-linked",itemID="operation-item"

    private func makeStore(_ root:URL)async throws->(KnowledgeStore,NotebookLibrary) {
        let store=try KnowledgeStore(path:root.appendingPathComponent("core.sqlite").path)
        let library=try NotebookLibrary(registryURL:root.appendingPathComponent("registry.json"),cloudRoot:root.appendingPathComponent("Cloud"))
        _ = try await library.catalog()
        return(store,library)
    }
    private func killFixture(_ root:URL,checkpoint:String)throws->Never {
        try Data(checkpoint.utf8).write(to:root.appendingPathComponent("reached"),options:.atomic)
        Darwin.kill(Darwin.getpid(),SIGKILL)
        while true {Darwin.pause()}
    }
    private func seed(_ root:URL,kind:String)async throws->OperationProcessFixture {
        try FileManager.default.createDirectory(at:root.appendingPathComponent("Cloud/Fixture"),withIntermediateDirectories:true)
        let(store,library)=try await makeStore(root),coordinator=TodayDocumentCoordinator(store:store,library:library)
        let notebookID=try #require(try await library.catalog().notebooks.first?.id)
        var task=LifeTask();task.title="Synthetic operation task"
        task=try await store.saveTask(task,expectedVersion:0,requestID:"seed-task")
        let initial=try await coordinator.open(notebookID:notebookID,day:"2026-10-30",timeZone:"UTC")
        let body=(try ManagedMarkdown.marker(["id":blockID,"taskID":"task:"+task.id]))+"- [ ] <!-- maple:item {\"v\":1,\"id\":\"\(itemID)\"} --> Synthetic operation task\n\n"+(try ManagedMarkdown.marker(["id":"source-stays"]))+"Synthetic source prose stays.\n"
        let source=try await coordinator.commit(documentID:initial.documentID,expectedRevision:initial.revision,content:initial.content+body,commandID:"seed-source")
        let emptyTarget=try await coordinator.open(notebookID:notebookID,day:"2026-10-31",timeZone:"UTC")
        let target=try await coordinator.commit(documentID:emptyTarget.documentID,expectedRevision:emptyTarget.revision,content:emptyTarget.content+(try ManagedMarkdown.marker(["id":"target-stays"]))+"Synthetic target prose stays.\n",commandID:"seed-target")
        let input=DocumentBlockMutation(commandID:command,documentID:source.documentID,expectedRevision:source.revision,blockID:blockID,expectedBlockVersion:1,kind:kind,targetDay:["move","copy"].contains(kind) ? "2026-10-31":nil,expectedTaskVersion:kind=="complete" ? 1:nil)
        let fixture=OperationProcessFixture(notebookID:notebookID,sourceID:source.documentID,sourcePath:source.path,sourceBefore:source.content,targetID:target.documentID,targetPath:target.path,targetBefore:target.content,input:input,taskID:task.id)
        try JSONCodec.encode(fixture).write(to:root.appendingPathComponent("fixture.json"),options:.atomic)
        return fixture
    }
    private func load(_ root:URL)throws->OperationProcessFixture {
        try JSONCodec.decode(OperationProcessFixture.self,from:Data(contentsOf:root.appendingPathComponent("fixture.json")))
    }
    private func verify(_ root:URL,mode:String,checkpoint:String)async throws {
        let fixture=try load(root),pair=try await makeStore(root),store=pair.0,library=pair.1
        let coordinator=TodayDocumentCoordinator(store:store,library:library)
        let pending=try await store.documentOperation(commandID:command)
        if mode=="verify",!checkpoint.hasPrefix("draftPersisted") {
            let intent=try #require(pending)
            // During a partial move the only surviving block may be in the journal, never lost.
            #expect(intent.files[0].before?.contains(blockID)==true)
            if fixture.input.kind=="move" {#expect(intent.files[1].after.contains(blockID))}
            if fixture.input.kind=="complete",["prepared","fileApplied:0"].contains(checkpoint) {
                #expect(try await store.tasks().first?.status == .open)
                #expect(try await store.operationProcessRows("SELECT * FROM task_mutation_reservations").count==1)
            }
        }
        if mode=="verify-conflict" {
            let beforeSource=try await library.read(notebookID:fixture.notebookID,path:fixture.sourcePath)
            let beforeTarget=try await library.read(notebookID:fixture.notebookID,path:fixture.targetPath)
            let recovered=try await coordinator.open(documentID:fixture.sourceID)
            #expect(recovered.warning != nil)
            #expect(try await library.read(notebookID:fixture.notebookID,path:fixture.sourcePath).content==beforeSource.content)
            #expect(try await library.read(notebookID:fixture.notebookID,path:fixture.targetPath).content==beforeTarget.content)
            let conflict=try #require(try await store.documentOperation(commandID:command))
            #expect(conflict.state=="conflict")
            #expect(conflict.files[0].before==fixture.sourceBefore)
            #expect(conflict.files[0].after==pending?.files[0].after)
            if fixture.input.kind=="move" {
                #expect(conflict.files[1].before==fixture.targetBefore)
                #expect(conflict.files[1].after.contains(blockID))
                // Source already removed: explicit abandonment must refuse to strand its identity.
                if checkpoint=="fileApplied:0" {
                    await #expect(throws:MapleError.self) {try await coordinator.resolveOperation(documentID:fixture.sourceID,commandID:command,resolution:"abandon")}
                }
            }
            #expect(try await store.tasks().first?.status == .open)
            #expect(try await store.tasks().first?.version==1)
            try Data("both files and intent preserved".utf8).write(to:root.appendingPathComponent("verified-conflict"))
            return
        }
        if checkpoint.hasPrefix("draftPersisted"),mode=="verify" {
            #expect(pending==nil)
            #expect(try await library.read(notebookID:fixture.notebookID,path:fixture.sourcePath).content==fixture.sourceBefore)
            #expect(try await library.read(notebookID:fixture.notebookID,path:fixture.targetPath).content==fixture.targetBefore)
            #expect(try await library.readDraft(notebookID:fixture.notebookID,path:fixture.sourcePath) != nil)
        }
        // Open the destination first after a partial move, exercising either participant as recovery entry.
        if !checkpoint.hasPrefix("draftPersisted"),fixture.input.kind=="move" {_ = try await coordinator.open(documentID:fixture.targetID)}
        _ = try await coordinator.open(documentID:fixture.sourceID)
        _ = try await coordinator.mutateBlock(fixture.input) // replay exact persisted command, including original expected revisions
        let source=try await coordinator.open(documentID:fixture.sourceID),target=try await coordinator.open(documentID:fixture.targetID)
        let operation=try #require(try await store.documentOperation(commandID:command))
        #expect(operation.state=="committed")
        #expect(source.content.contains("Synthetic source prose stays."))
        #expect(target.content.contains("Synthetic target prose stays."))
        let sourceIDs=try ManagedMarkdown.identities(source.content),targetIDs=try ManagedMarkdown.identities(target.content)
        switch fixture.input.kind {
        case "move":
            #expect(!sourceIDs.contains(blockID) && !sourceIDs.contains(itemID))
            #expect(targetIDs.filter{$0==blockID}.count==1 && targetIDs.filter{$0==itemID}.count==1)
            #expect(try await store.documentBlock(id:blockID)?.documentID==fixture.targetID)
        case "copy":
            #expect(sourceIDs.contains(blockID) && sourceIDs.contains(itemID))
            #expect(!targetIDs.contains(blockID) && !targetIDs.contains(itemID))
            for id in [blockID,itemID] {#expect(targetIDs.filter{$0=="copy-"+ManagedMarkdown.hash(command+":"+id)}.count==1)}
            #expect(try await store.documentBlock(id:blockID)?.documentID==fixture.sourceID)
        case "clear":
            #expect(!sourceIDs.contains(blockID) && !targetIDs.contains(blockID))
            #expect(try await store.documentBlock(id:blockID)?.state=="cleared")
        case "complete":
            #expect(sourceIDs.contains(blockID) && sourceIDs.contains(itemID))
            #expect(source.content.contains("- [x]"))
        default:Issue.record("Unsupported fixture action")
        }
        let task=try #require(try await store.tasks().first{$0.id==fixture.taskID})
        #expect(task.status == (fixture.input.kind=="complete" ? .completed:.open))
        #expect(task.version == (fixture.input.kind=="complete" ? 2:1))
        #expect(try await store.operationProcessRows("SELECT * FROM task_mutation_reservations").isEmpty)
        #expect(try await store.operationProcessRows("SELECT * FROM document_identity_reservations").isEmpty)
        #expect(try await store.operationProcessRows("SELECT * FROM document_outbox WHERE delivered=0").isEmpty)
        let report:[String:Any]=["source":source.content,"target":target.content,"events":try await store.eventCount(),"taskVersion":task.version,
            "blocks":try await store.operationProcessRows("SELECT block_id,document_id,version,state FROM document_block_index ORDER BY block_id"),
            "identities":try await store.operationProcessRows("SELECT * FROM document_identities ORDER BY block_id")]
        try JSONSerialization.data(withJSONObject:report,options:.sortedKeys).write(to:root.appendingPathComponent(mode+".json"),options:.atomic)
    }

    @Test func subprocessWorker()async throws {
        let env=ProcessInfo.processInfo.environment
        guard let path=env[rootKey],let mode=env[modeKey],let checkpoint=env[checkpointKey],let kind=env[kindKey] else{return}
        let root=URL(fileURLWithPath:path).standardizedFileURL
        try #require(root.lastPathComponent.hasPrefix("maple-operation-death-") && FileManager.default.fileExists(atPath:root.appendingPathComponent("synthetic-only").path))
        if mode=="write" {
            let fixture=try await seed(root,kind:kind),pair=try await makeStore(root)
            let coordinator=TodayDocumentCoordinator(store:pair.0,library:pair.1)
            await coordinator.observeOperation {boundary,id,index in
                let point=boundary.rawValue+(index.map{":"+String($0)} ?? "")
                guard id==command,point==checkpoint else{return}
                try! killFixture(root,checkpoint:checkpoint)
            }
            _ = try await coordinator.mutateBlock(fixture.input)
            try #require(checkpoint=="acknowledged")
            try killFixture(root,checkpoint:checkpoint)
        } else {try await verify(root,mode:mode,checkpoint:checkpoint)}
    }
    private func launch(_ root:URL,mode:String,checkpoint:String,kind:String,expectKill:Bool)async throws {
        let process=Process(),bundle=Bundle(for:OperationProcessTestBundle.self)
        let binary=try #require(bundle.executableURL),helper=URL(fileURLWithPath:CommandLine.arguments[0])
        try #require(helper.lastPathComponent=="swiftpm-testing-helper")
        process.executableURL=helper
        process.arguments=["--test-bundle-path",binary.path,"--testing-library","swift-testing","--filter","DocumentOperationProcessTerminationTests/subprocessWorker"]
        var env=ProcessInfo.processInfo.environment
        env[rootKey]=root.path;env[modeKey]=mode;env[checkpointKey]=checkpoint;env[kindKey]=kind;process.environment=env
        let log=root.appendingPathComponent(mode+".log")
        FileManager.default.createFile(atPath:log.path,contents:Data())
        let output=try FileHandle(forWritingTo:log);defer{try? output.close()}
        process.standardOutput=output;process.standardError=output
        try process.run();defer{if process.isRunning{Darwin.kill(process.processIdentifier,SIGKILL)}}
        let deadline=ContinuousClock.now.advanced(by:.seconds(30))
        while process.isRunning && ContinuousClock.now<deadline {try await Task.sleep(for:.milliseconds(25))}
        if process.isRunning {Darwin.kill(process.processIdentifier,SIGKILL);throw MapleError.invalid("Synthetic operation helper timed out")}
        let details=(try? String(contentsOf:log,encoding:.utf8)) ?? "No child output"
        if expectKill {
            try #require(process.terminationReason == .uncaughtSignal && process.terminationStatus==SIGKILL,"Expected SIGKILL at \(kind)/\(checkpoint): \(details)")
            #expect(try String(contentsOf:root.appendingPathComponent("reached"),encoding:.utf8)==checkpoint)
        } else {try #require(process.terminationReason == .exit && process.terminationStatus==0,"Recovery failed at \(kind)/\(checkpoint): \(details)")}
    }
    private func fixtureRoot()throws->URL {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent("maple-operation-death-"+UUID().uuidString)
        try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
        try Data("Synthetic temporary operation test only".utf8).write(to:root.appendingPathComponent("synthetic-only"))
        return root
    }
    @Test func realProcessDeathRecoversMoveCopyAndCanonicalCompletionIdempotently()async throws {
        guard ProcessInfo.processInfo.environment[rootKey]==nil else{return}
        let scenarios:[(String,[String])]=[
            ("move",["draftPersisted:0","draftPersisted:1","prepared","fileApplied:0","fileApplied:1","finalized","outboxDrained","acknowledged"]),
            ("copy",["prepared","fileApplied:1","finalized"]),
            ("complete",["prepared","fileApplied:0","finalized","outboxDrained","acknowledged"]),
            ("clear",["prepared","finalized"])
        ]
        for(kind,checkpoints) in scenarios {for checkpoint in checkpoints {
            let root=try fixtureRoot();defer{try? FileManager.default.removeItem(at:root)}
            try await launch(root,mode:"write",checkpoint:checkpoint,kind:kind,expectKill:true)
            try await launch(root,mode:"verify",checkpoint:checkpoint,kind:kind,expectKill:false)
            try await launch(root,mode:"verify-again",checkpoint:checkpoint,kind:kind,expectKill:false)
            #expect(try Data(contentsOf:root.appendingPathComponent("verify.json"))==Data(contentsOf:root.appendingPathComponent("verify-again.json")))
        }}
    }
    @Test func externalEditAfterProcessDeathPreservesBothFilesAndPendingIntent()async throws {
        guard ProcessInfo.processInfo.environment[rootKey]==nil else{return}
        for(kind,checkpoint) in [("move","prepared"),("move","fileApplied:0"),("complete","fileApplied:0")] {
            let root=try fixtureRoot();defer{try? FileManager.default.removeItem(at:root)}
            try await launch(root,mode:"write",checkpoint:checkpoint,kind:kind,expectKill:true)
            let fixture=try load(root),path=kind=="move" ? fixture.targetPath:fixture.sourcePath
            let file=root.appendingPathComponent("Cloud/Fixture").appendingPathComponent(path)
            let current=try String(contentsOf:file,encoding:.utf8)
            try Data((current+"External synthetic writing after process death.\n").utf8).write(to:file,options:.atomic)
            try await launch(root,mode:"verify-conflict",checkpoint:checkpoint,kind:kind,expectKill:false)
            #expect(FileManager.default.fileExists(atPath:root.appendingPathComponent("verified-conflict").path))
        }
    }
}
