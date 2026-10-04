import Foundation
import Darwin
import Testing
import MapleNotebooks
@testable import MapleCore

private final class DocumentProcessTestBundle:NSObject {}
private struct DocumentProcessFixture:Codable {
    let documentID:String,notebookID:String,path:String,before:String,revision:String,after:String
    let receipts:[String],sourceBlockID:String,taskID:String
    let initialEventCount:Int,at:Date
}
extension KnowledgeStore {
    fileprivate func processFixtureRows(_ sql:String)throws->[[String:String]] {try db.rows(sql)}
    // Explicit synthetic successful routing, used only to exercise delivery/deletion receipts.
    fileprivate func processFixtureRoute(_ eventID:String,at:Date)throws {
        let assessment=Assessment(notify:0,askUser:0,reason:0,summarize:0,jobStage:.unchanged,stageConfidence:0,model:"synthetic-process-fixture",provider:"test-fixture")
        let decision=Decision(eventID:eventID,route:.summarize,assessment:assessment,context:try context(for:eventID),explanation:["Synthetic process-death storage fixture"],policyVersion:"test-fixture",createdAt:at)
        try db.execute("INSERT INTO decisions VALUES (?,?,?)",[eventID,try JSONCodec.string(decision),"test-fixture"])
        try db.execute("UPDATE processing_jobs SET status='succeeded' WHERE event_id=?",[eventID])
        try db.execute("INSERT INTO work_items VALUES (?,?,?,?)",["process-fixture:"+eventID,eventID,"summarize","proposed"])
    }
}

/// Exercises abrupt process death, not power loss or physical iCloud synchronization.
struct DocumentProcessTerminationTests {
    private let rootKey="MAPLE_DOCUMENT_PROCESS_TEST_ROOT"
    private let modeKey="MAPLE_DOCUMENT_PROCESS_TEST_MODE"
    private let checkpointKey="MAPLE_DOCUMENT_PROCESS_TEST_CHECKPOINT"
    private let command="synthetic-interrupted-commit"

    private func makeStore(_ root:URL)async throws->(KnowledgeStore,NotebookLibrary) {
        let store=try KnowledgeStore(path:root.appendingPathComponent("core.sqlite").path)
        let library=try NotebookLibrary(registryURL:root.appendingPathComponent("registry.json"),cloudRoot:root.appendingPathComponent("Cloud"))
        _ = try await library.catalog()
        return(store,library)
    }
    private func killFixture(_ root:URL,checkpoint:String)throws->Never {
        try Data(checkpoint.utf8).write(to:root.appendingPathComponent("reached"),options:.atomic)
        // SIGKILL runs no Swift defer, store deinit, or graceful SQLite checkpoint.
        Darwin.kill(Darwin.getpid(),SIGKILL)
        while true {Darwin.pause()}
    }
    private func seed(_ root:URL)async throws->DocumentProcessFixture {
        try FileManager.default.createDirectory(at:root.appendingPathComponent("Cloud/Fixture"),withIntermediateDirectories:true)
        let(store,library)=try await makeStore(root),coordinator=TodayDocumentCoordinator(store:store,library:library)
        let notebookID=try #require(try await library.catalog().notebooks.first?.id)
        let initial=try await coordinator.open(notebookID:notebookID,day:"2026-10-30",timeZone:"UTC")
        let original=initial.content+(try ManagedMarkdown.marker(["id":"process-old-block"]))+"Previously acknowledged synthetic writing.\n"
        let saved=try await coordinator.commit(documentID:initial.documentID,expectedRevision:initial.revision,content:original,commandID:"seed-writing")
        let at=try #require(ISO8601DateFormatter().date(from:"2026-10-30T16:00:00Z"))
        let event=Event(type:"message.received",source:.init(connector:"gmail",account:"synthetic",externalID:"process-source",revision:"1"),occurredAt:at.addingTimeInterval(-20),receivedAt:at,subjects:["person:self"],content:"Synthetic source accepted into the editor then deleted before autosave.")
        try await store.ingest(event);try await store.processFixtureRoute(event.id,at:at)
        let proposal=try await coordinator.automaticProposal(documentID:saved.documentID,at:at)
        let group=try #require(proposal.groups.first),block=try #require(group.blocks.first)
        var task=LifeTask();task.title="Synthetic canonical task stays open"
        task=try await store.saveTask(task,expectedVersion:0,requestID:"seed-task")
        let after=initial.content+(try ManagedMarkdown.marker(["id":"process-new-block"]))+"New synthetic writing survives abrupt process death.\n"
        let fixture=DocumentProcessFixture(documentID:saved.documentID,notebookID:notebookID,path:saved.path,before:saved.content,revision:saved.revision,after:after,receipts:[group.headingID,block.blockID],sourceBlockID:block.blockID,taskID:task.id,initialEventCount:try await store.eventCount(),at:at)
        try JSONCodec.encode(fixture).write(to:root.appendingPathComponent("fixture.json"),options:.atomic)
        return fixture
    }

    private func verify(_ root:URL,mode:String,checkpoint:String)async throws {
        let fixture=try JSONCodec.decode(DocumentProcessFixture.self,from:Data(contentsOf:root.appendingPathComponent("fixture.json")))
        let(store,library)=try await makeStore(root),coordinator=TodayDocumentCoordinator(store:store,library:library)
        let recovered=try await coordinator.open(documentID:fixture.documentID)
        if mode=="verify-conflict" {
            let external=fixture.before+"External synthetic editor writing after the process died.\n"
            #expect(recovered.content==external && recovered.warning != nil)
            #expect(try await library.read(notebookID:fixture.notebookID,path:fixture.path).content==external)
            #expect(recovered.draft?.content==fixture.after)
            #expect(Set(recovered.draft?.acceptedAutomaticBlockIDs ?? [])==Set(fixture.receipts))
            #expect(try await store.documentMutation(command)?.state=="conflict")
            #expect(try await store.documentMutation(command)?.after==fixture.after)
            #expect(try await store.documentBlock(id:"process-old-block")?.state=="active")
            #expect(try await store.eventCount()==fixture.initialEventCount)
            try Data("conflict-preserved".utf8).write(to:root.appendingPathComponent("verified-conflict"),options:.atomic)
            return
        }
        if checkpoint==DocumentCommitBoundary.draftPersisted.rawValue && mode=="verify" {
            // No journal was acknowledged yet. Preserve the existing file and resume from the durable draft explicitly.
            #expect(recovered.content==fixture.before && recovered.draft?.content==fixture.after)
            #expect(Set(recovered.draft?.acceptedAutomaticBlockIDs ?? [])==Set(fixture.receipts))
            #expect(try await store.documentMutation(command)==nil)
        } else {#expect(recovered.content==fixture.after)}
        let saved=try await coordinator.commit(documentID:fixture.documentID,expectedRevision:fixture.revision,content:fixture.after,commandID:command,acceptedAutomaticBlockIDs:fixture.receipts)
        #expect(saved.content==fixture.after && saved.state=="committed")
        #expect(saved.draft?.acceptedAutomaticBlockIDs==nil)
        #expect(try await store.documentMutation(command)?.state=="committed")
        #expect(try await store.documentBlock(id:"process-old-block")?.state=="removed")
        #expect(try await store.documentBlock(id:"process-new-block")?.state=="active")
        #expect(try await store.documentHistory(documentID:fixture.documentID).contains{$0.after==fixture.before})
        for receipt in fixture.receipts {#expect(try await !store.automaticIdentityUnused(receipt))}
        let proposed=try await coordinator.automaticProposal(documentID:fixture.documentID,at:fixture.at)
        #expect(!proposed.groups.flatMap(\.blocks).contains{$0.blockID==fixture.sourceBlockID})
        #expect(try await store.tasks().first{$0.id==fixture.taskID}?.status == .open)
        #expect(try await store.eventCount()==fixture.initialEventCount+1)
        #expect(try await store.processFixtureRows("SELECT command_id FROM document_outbox WHERE delivered=0").isEmpty)
        let rows=try await store.processFixtureRows("SELECT command_id,state FROM document_mutations ORDER BY command_id")
        #expect(rows.filter{$0["command_id"]==command}.count==1)
        let report:[String:Any]=["revision":saved.revision,"events":try await store.eventCount(),"mutations":rows,"oldBlockVersion":try await store.documentBlock(id:"process-old-block")!.version,"newBlockVersion":try await store.documentBlock(id:"process-new-block")!.version]
        try JSONSerialization.data(withJSONObject:report,options:[.sortedKeys]).write(to:root.appendingPathComponent(mode+".json"),options:.atomic)
    }

    @Test func subprocessWorker()async throws {
        let env=ProcessInfo.processInfo.environment
        guard let path=env[rootKey],let mode=env[modeKey],let checkpoint=env[checkpointKey] else{return}
        let root=URL(fileURLWithPath:path).standardizedFileURL
        // Explicit marker limits this test worker to a temporary synthetic fixture created by its parent.
        try #require(root.lastPathComponent.hasPrefix("maple-process-death-") && FileManager.default.fileExists(atPath:root.appendingPathComponent("synthetic-only").path))
        if mode=="write" {
            let fixture=try await seed(root),pair=try await makeStore(root)
            let coordinator=TodayDocumentCoordinator(store:pair.0,library:pair.1,commitObserver:{boundary,id in
                guard id==command,boundary.rawValue==checkpoint else{return}
                try! killFixture(root,checkpoint:checkpoint)
            })
            let saved=try await coordinator.commit(documentID:fixture.documentID,expectedRevision:fixture.revision,content:fixture.after,commandID:command,acceptedAutomaticBlockIDs:fixture.receipts)
            try #require(checkpoint=="acknowledged" && saved.content==fixture.after && saved.state=="committed")
            try killFixture(root,checkpoint:checkpoint)
        } else {try await verify(root,mode:mode,checkpoint:checkpoint)}
    }

    private func launch(_ root:URL,mode:String,checkpoint:String,expectKill:Bool)async throws {
        let process=Process()
        let bundle=Bundle(for:DocumentProcessTestBundle.self)
        let testBinary=try #require(bundle.executableURL)
        let helper=URL(fileURLWithPath:CommandLine.arguments[0])
        // SwiftPM's existing runner loads this same test bundle; no alternate app or nested build is launched.
        try #require(helper.lastPathComponent=="swiftpm-testing-helper")
        process.executableURL=helper
        process.arguments=["--test-bundle-path",testBinary.path,"--testing-library","swift-testing","--filter","DocumentProcessTerminationTests/subprocessWorker"]
        var environment=ProcessInfo.processInfo.environment
        environment[rootKey]=root.path;environment[modeKey]=mode;environment[checkpointKey]=checkpoint
        process.environment=environment
        let log=root.appendingPathComponent(mode+".log")
        FileManager.default.createFile(atPath:log.path,contents:Data())
        let output=try FileHandle(forWritingTo:log);defer{try? output.close()}
        process.standardOutput=output;process.standardError=output
        try process.run()
        defer {if process.isRunning {Darwin.kill(process.processIdentifier,SIGKILL)}}
        let deadline=ContinuousClock.now.advanced(by:.seconds(30))
        while process.isRunning && ContinuousClock.now<deadline {try await Task.sleep(for:.milliseconds(25))}
        if process.isRunning {Darwin.kill(process.processIdentifier,SIGKILL);Issue.record("Synthetic subprocess exceeded its 30-second deadline");throw MapleError.invalid("Process fixture timed out")}
        let details=(try? String(contentsOf:log,encoding:.utf8)) ?? "No child output"
        if expectKill {
            try #require(process.terminationReason == .uncaughtSignal && process.terminationStatus==SIGKILL,"Expected actual SIGKILL at \(checkpoint); \(details)")
            #expect(try String(contentsOf:root.appendingPathComponent("reached"),encoding:.utf8)==checkpoint)
        } else {try #require(process.terminationReason == .exit && process.terminationStatus==0,"Recovery child failed at \(checkpoint): \(details)")}
    }

    @Test func realProcessDeathRecoversEveryCommitCheckpointAndPreservesExternalConflict()async throws {
        guard ProcessInfo.processInfo.environment[rootKey]==nil else{return}
        for checkpoint in DocumentCommitBoundary.allCases.map(\.rawValue)+["acknowledged"] {
            let root=FileManager.default.temporaryDirectory.appendingPathComponent("maple-process-death-"+UUID().uuidString)
            try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
            defer{try? FileManager.default.removeItem(at:root)}
            try Data("Synthetic local storage fixture only".utf8).write(to:root.appendingPathComponent("synthetic-only"))
            try await launch(root,mode:"write",checkpoint:checkpoint,expectKill:true)
            try await launch(root,mode:"verify",checkpoint:checkpoint,expectKill:false)
            try await launch(root,mode:"verify-again",checkpoint:checkpoint,expectKill:false)
            #expect(try Data(contentsOf:root.appendingPathComponent("verify.json"))==Data(contentsOf:root.appendingPathComponent("verify-again.json")))
        }
        for checkpoint in [DocumentCommitBoundary.journalPrepared.rawValue,DocumentCommitBoundary.fileReplaced.rawValue] {
            let root=FileManager.default.temporaryDirectory.appendingPathComponent("maple-process-death-"+UUID().uuidString)
            try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
            defer{try? FileManager.default.removeItem(at:root)}
            try Data("Synthetic external-editor fixture only".utf8).write(to:root.appendingPathComponent("synthetic-only"))
            try await launch(root,mode:"write",checkpoint:checkpoint,expectKill:true)
            let fixture=try JSONCodec.decode(DocumentProcessFixture.self,from:Data(contentsOf:root.appendingPathComponent("fixture.json")))
            let file=root.appendingPathComponent("Cloud/Fixture").appendingPathComponent(fixture.path)
            try Data((fixture.before+"External synthetic editor writing after the process died.\n").utf8).write(to:file,options:.atomic)
            try await launch(root,mode:"verify-conflict",checkpoint:checkpoint,expectKill:false)
            #expect(FileManager.default.fileExists(atPath:root.appendingPathComponent("verified-conflict").path))
        }
    }
}
