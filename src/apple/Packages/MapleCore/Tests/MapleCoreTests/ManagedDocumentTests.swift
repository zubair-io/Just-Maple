import Foundation
import Testing
import MapleNotebooks
@testable import MapleCore

struct ManagedDocumentTests {
    func fixture() async throws -> (URL,NotebookLibrary,KnowledgeStore,TodayDocumentCoordinator,String) {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at:root.appendingPathComponent("Cloud/Everyday"),withIntermediateDirectories:true)
        let library=try NotebookLibrary(registryURL:root.appendingPathComponent("registry.json"),cloudRoot:root.appendingPathComponent("Cloud"))
        let id=try #require(await library.catalog().notebooks.first?.id)
        let store=try KnowledgeStore(path:root.appendingPathComponent("store.db").path)
        return (root,library,store,TodayDocumentCoordinator(store:store,library:library),id)
    }
    @Test func localDateValidatesCalendarAndAvoidsUTCDate() throws {
        let date=Date(timeIntervalSince1970:1790811000)
        #expect(try ManagedMarkdown.day(at:date,timeZone:"America/New_York") != ManagedMarkdown.day(at:date,timeZone:"Asia/Tokyo"))
        #expect(throws:MapleError.self){try ManagedMarkdown.validateDay("2026-02-30",timeZone:"America/New_York")}
        #expect(throws:MapleError.self){try ManagedMarkdown.validateDay("2026-11-01",timeZone:"Made/Up")}
        try ManagedMarkdown.validateDay("2028-02-29",timeZone:"America/New_York")
    }
    @Test func createSaveReplayAndDurableOutbox() async throws {
        let (root,library,store,coordinator,id)=try await fixture();defer{try? FileManager.default.removeItem(at:root)}
        let first=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"America/New_York")
        #expect(first.path=="Daily/2026-10-30.md");#expect(!first.readOnly)
        #expect(ManagedMarkdown.documentID(first.content)==first.documentID)
        let content=first.content+"Hello 👋\n"
        let saved=try await coordinator.commit(documentID:first.documentID,expectedRevision:first.revision,content:content,commandID:"edit1")
        let replay=try await coordinator.commit(documentID:first.documentID,expectedRevision:first.revision,content:content,commandID:"edit1")
        #expect(saved.revision==replay.revision)
        #expect(try await store.eventCount()==2)
        #expect(try await store.documentHistory(documentID:first.documentID).count==2)
        #expect(try await library.read(notebookID:id,path:first.path).content==content)
        await #expect(throws:MapleError.self){try await coordinator.commit(documentID:first.documentID,expectedRevision:first.revision,content:content+"other",commandID:"edit1")}
    }
    @Test func staleRevisionPreservesExternalFileAndDraft() async throws {
        let (root,library,_,coordinator,id)=try await fixture();defer{try? FileManager.default.removeItem(at:root)}
        let first=try await coordinator.open(notebookID:id,day:"2026-10-30")
        let external=first.content+"External change\n"
        _ = try await library.save(notebookID:id,path:first.path,content:external,expectedRevision:first.revision)
        await #expect(throws:MapleError.self){try await coordinator.commit(documentID:first.documentID,expectedRevision:first.revision,content:first.content+"Draft\n",commandID:"stale")}
        #expect(try await library.read(notebookID:id,path:first.path).content==external)
        #expect(try await library.readDraft(notebookID:id,path:first.path)?.content==first.content+"Draft\n")
    }
    @Test func recoveryCompletesPreparedBeforeAndAfterFileWriteExactlyOnce() async throws {
        let (root,library,store,coordinator,id)=try await fixture();defer{try? FileManager.default.removeItem(at:root)}
        var current=try await coordinator.open(notebookID:id,day:"2026-10-30")
        for afterWrite in [false,true] {
            let content=current.content+"Recovered \(afterWrite)\n"
            let mutation=DocumentMutationRecord(commandID:"crash-\(afterWrite)",documentID:current.documentID,expectedRevision:current.revision,targetRevision:ManagedMarkdown.hash(content),before:current.content,after:content,state:"prepared",createdAt:Date())
            _ = try await store.prepareDocumentMutation(mutation)
            if afterWrite {_ = try await library.save(notebookID:id,path:current.path,content:content,expectedRevision:current.revision)}
            // A fresh coordinator simulates a host restart, using the persisted journal only.
            let reopened=TodayDocumentCoordinator(store:store,library:library)
            current=try await reopened.open(documentID:current.documentID)
            #expect(current.content==content)
            #expect(try await store.documentMutation(mutation.commandID)?.state=="committed")
            _ = try await reopened.open(documentID:current.documentID)
        }
        #expect(try await store.eventCount()==3)
    }
    @Test func recoveryNeverOverwritesUnknownExternalHash() async throws {
        let (root,library,store,coordinator,id)=try await fixture();defer{try? FileManager.default.removeItem(at:root)}
        let first=try await coordinator.open(notebookID:id,day:"2026-10-30")
        let content=first.content+"Proposed\n"
        _ = try await store.prepareDocumentMutation(DocumentMutationRecord(commandID:"conflict",documentID:first.documentID,expectedRevision:first.revision,targetRevision:ManagedMarkdown.hash(content),before:first.content,after:content,state:"prepared",createdAt:Date()))
        let external=first.content+"External\n"
        _ = try await library.save(notebookID:id,path:first.path,content:external,expectedRevision:first.revision)
        let recovered=try await TodayDocumentCoordinator(store:store,library:library).open(documentID:first.documentID)
        #expect(recovered.content==external);#expect(recovered.warning != nil)
        #expect(try await store.documentMutation("conflict")?.state=="conflict")
    }
    @Test func initialRegistryAndIntentAreAtomicAndRecoverable() async throws {
        let (root,library,store,_,id)=try await fixture();defer{try? FileManager.default.removeItem(at:root)}
        let documentID=UUID().uuidString.lowercased(),day="2026-10-30"
        let content=ManagedMarkdown.header(documentID:documentID,day:day,timeZone:"America/New_York")+"Recovered creation\n"
        try await library.prepareDailyDirectory(notebookID:id)
        try await store.registerManagedDocument(ManagedDocumentRecord(documentID:documentID,notebookID:id,path:"Daily/\(day).md",day:day,timeZone:"America/New_York",revision:nil),initialContent:content)
        let recovered=try await TodayDocumentCoordinator(store:store,library:library).open(notebookID:id,day:day)
        #expect(recovered.content==content)
    }
    @Test func migrationIsExplicitPreservesIDsTombstonesAndRejectsOldWriters() async throws {
        let (root,_,store,coordinator,id)=try await fixture();defer{try? FileManager.default.removeItem(at:root)}
        let day="2026-10-30",zone="America/New_York"
        for block in ["visible","cleared"] {_ = try await store.mutateDailyBlock(.init(kind:.create,blockID:block,expectedVersion:0,requestID:"create-"+block,day:day,timeZone:zone,content:block,blockKind:.text))}
        _ = try await store.mutateDailyBlock(.init(kind:.clear,blockID:"cleared",expectedVersion:1,requestID:"clear",day:day,timeZone:zone))
        _ = try await store.mutateDailyBlock(.init(kind:.edit,blockID:"visible",expectedVersion:1,requestID:"edit-visible",day:day,timeZone:zone,content:"visible edited"))
        let preview=try await coordinator.open(notebookID:id,day:day,timeZone:zone)
        #expect(preview.readOnly && preview.legacyMigrationAvailable)
        let migrated=try await coordinator.open(notebookID:id,day:day,timeZone:zone,migrateLegacy:true)
        #expect(migrated.blocks.first?.version==2);#expect(migrated.blocks.first?.userEdited==true)
        #expect(migrated.cleared.first?.blockID=="cleared");#expect(migrated.content.contains("\"id\":\"visible\""));#expect(!migrated.content.contains("\"id\":\"cleared\""))
        #expect(try await store.dailyNote(day:day,timeZone:zone).cleared.first?.id=="cleared")
        await #expect(throws:MapleError.self){try await store.mutateDailyBlock(.init(kind:.edit,blockID:"visible",expectedVersion:2,requestID:"legacy-write",day:day,timeZone:zone,content:"bad"))}
        #expect(try await coordinator.open(notebookID:id,day:day,timeZone:zone,migrateLegacy:true).documentID==migrated.documentID)
    }
    @Test func fileCollisionAndDuplicateBlockIDsAreVisible() async throws {
        let (root,library,_,coordinator,id)=try await fixture();defer{try? FileManager.default.removeItem(at:root)}
        try await library.prepareDailyDirectory(notebookID:id)
        _ = try await library.save(notebookID:id,path:"Daily/2026-10-30.md",content:"Existing user file",expectedRevision:nil)
        let collision=try await coordinator.open(notebookID:id,day:"2026-10-30")
        #expect(collision.readOnly);#expect(collision.content=="Existing user file")
        let other=try await coordinator.open(notebookID:id,day:"2026-10-31")
        let marker=try ManagedMarkdown.marker(["id":"same"])
        await #expect(throws:MapleError.self){try await coordinator.commit(documentID:other.documentID,expectedRevision:other.revision,content:other.content+marker+"one\n"+marker+"two\n",commandID:"duplicate")}
    }
}

struct ManagedDocumentOperationTests {
    @Test func clearRestoreMoveRetainIdentityAndVersionsWithoutCompletingTask() async throws {
        let (root,_,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        var task=LifeTask();task.title="Do the work"
        task=try await store.saveTask(task,expectedVersion:0,requestID:"task-create")
        let first=try await coordinator.open(notebookID:id,day:"2026-10-30")
        let text=first.content+(try ManagedMarkdown.marker(["id":"stable","taskID":"task:"+task.id]))+"- [ ] Do the work\n"
        var note=try await coordinator.commit(documentID:first.documentID,expectedRevision:first.revision,content:text,commandID:"insert-task")
        #expect(note.blocks.first?.blockID=="stable")
        note=try await coordinator.mutateBlock(.init(commandID:"clear",documentID:note.documentID,expectedRevision:note.revision,blockID:"stable",expectedBlockVersion:note.blocks[0].version,kind:"clear"))
        #expect(note.blocks.isEmpty);#expect(note.cleared.count==1)
        #expect(try await store.tasks().first?.status != .completed)
        await #expect(throws:MapleError.self){try await coordinator.commit(documentID:note.documentID,expectedRevision:note.revision,content:text,commandID:"refresh-cleared")}
        note=try await coordinator.mutateBlock(.init(commandID:"restore",documentID:note.documentID,expectedRevision:note.revision,blockID:"stable",expectedBlockVersion:note.cleared[0].version,kind:"restore"))
        #expect(note.blocks[0].version==3)
        _ = try await coordinator.mutateBlock(.init(commandID:"move",documentID:note.documentID,expectedRevision:note.revision,blockID:"stable",expectedBlockVersion:note.blocks[0].version,kind:"move",targetDay:"2026-10-31"))
        let target=try await coordinator.open(notebookID:id,day:"2026-10-31")
        #expect(target.blocks.first?.blockID=="stable");#expect(target.content.contains("Do the work"))
        #expect(try await coordinator.open(documentID:first.documentID).blocks.isEmpty)
        #expect(try await store.tasks().first?.status != .completed)
    }
    @Test func completionReservesAllWritersAndRecoversAfterFileWriteExactlyOnce() async throws {
        let (root,library,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        var task=LifeTask();task.title="Reserved task";task=try await store.saveTask(task,expectedVersion:0,requestID:"task")
        let first=try await coordinator.open(notebookID:id,day:"2026-10-30")
        let text=first.content+(try ManagedMarkdown.marker(["id":"linked","taskID":"task:"+task.id]))+"- [ ] Reserved task\n"
        let note=try await coordinator.commit(documentID:first.documentID,expectedRevision:first.revision,content:text,commandID:"link")
        let after=text.replacingOccurrences(of:"- [ ]",with:"- [x]")
        let input=DocumentBlockMutation(commandID:"done",documentID:note.documentID,expectedRevision:note.revision,blockID:"linked",expectedBlockVersion:1,kind:"complete",expectedTaskVersion:1)
        let file=DocumentMutationRecord(commandID:"done:0",documentID:note.documentID,expectedRevision:note.revision,targetRevision:ManagedMarkdown.hash(after),before:text,after:after,state:"operationPrepared",createdAt:Date())
        _ = try await store.prepareDocumentOperation(.init(input:input,files:[file],taskID:"task:"+task.id,state:"prepared"))
        var edit=task;edit.title="Concurrent writer"
        await #expect(throws:MapleError.self){try await store.saveTask(edit,expectedVersion:1,requestID:"concurrent")}
        await #expect(throws:MapleError.self){try await store.applyTaskAction(nodeID:"task:"+task.id,change:.init(kind:"done",issuedAt:Date()),expectedVersion:1,requestID:"companion",scope:"phone")}
        _ = try await library.save(notebookID:id,path:note.path,content:after,expectedRevision:note.revision)
        #expect(try await store.tasks().first?.status != .completed)
        let restarted=TodayDocumentCoordinator(store:store,library:library)
        let recovered=try await restarted.open(documentID:note.documentID)
        #expect(recovered.blocks.first?.taskStatus=="completed")
        #expect(try await store.tasks().first?.version==2)
        _ = try await restarted.mutateBlock(input)
        #expect(try await store.tasks().first?.version==2)
    }
    @Test func publicCompletionUpdatesCanonicalStateAndKeepsAttentionVisible() async throws {
        let (root,_,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        var task=LifeTask();task.title="Complete me";task=try await store.saveTask(task,expectedVersion:0,requestID:"task")
        let first=try await coordinator.open(notebookID:id,day:"2026-10-30")
        let text=first.content+(try ManagedMarkdown.marker(["id":"linked","taskID":"task:"+task.id]))+"- [ ] Complete me\n"
        let note=try await coordinator.commit(documentID:first.documentID,expectedRevision:first.revision,content:text,commandID:"link")
        let done=try await coordinator.mutateBlock(.init(commandID:"done",documentID:note.documentID,expectedRevision:note.revision,blockID:"linked",expectedBlockVersion:1,kind:"complete",expectedTaskVersion:1))
        #expect(done.content.contains("- [x] Complete me"));#expect(done.blocks.count==1);#expect(done.cleared.isEmpty)
        #expect(done.blocks[0].taskStatus=="completed")
        let reopened=try await coordinator.mutateBlock(.init(commandID:"undo-done",documentID:done.documentID,expectedRevision:done.revision,blockID:"linked",expectedBlockVersion:done.blocks[0].version,kind:"reopen",expectedTaskVersion:2))
        #expect(reopened.content.contains("- [ ] Complete me"));#expect(reopened.blocks[0].taskStatus=="open")
    }
    @Test func moveRecoveryAfterOneFileWriteFinishesBothAndPreservesSingleIdentity() async throws {
        let (root,library,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let first=try await coordinator.open(notebookID:id,day:"2026-10-30"),target=try await coordinator.open(notebookID:id,day:"2026-10-31")
        let block=(try ManagedMarkdown.marker(["id":"moving"]))+"Move me\n"
        let source=try await coordinator.commit(documentID:first.documentID,expectedRevision:first.revision,content:first.content+block,commandID:"insert")
        let input=DocumentBlockMutation(commandID:"move",documentID:source.documentID,expectedRevision:source.revision,blockID:"moving",expectedBlockVersion:1,kind:"move",targetDay:"2026-10-31")
        let files=[DocumentMutationRecord(commandID:"move:0",documentID:source.documentID,expectedRevision:source.revision,targetRevision:ManagedMarkdown.hash(first.content),before:source.content,after:first.content,state:"operationPrepared",createdAt:Date()),DocumentMutationRecord(commandID:"move:1",documentID:target.documentID,expectedRevision:target.revision,targetRevision:ManagedMarkdown.hash(target.content+block),before:target.content,after:target.content+block,state:"operationPrepared",createdAt:Date())]
        _ = try await store.prepareDocumentOperation(.init(input:input,files:files,state:"prepared"))
        _ = try await library.save(notebookID:id,path:source.path,content:first.content,expectedRevision:source.revision)
        _ = try await TodayDocumentCoordinator(store:store,library:library).open(documentID:source.documentID)
        #expect(try await store.documentBlock(id:"moving")?.documentID==target.documentID)
        #expect(try await library.read(notebookID:id,path:target.path).content==target.content+block)
        #expect(try await store.documentOperation(commandID:"move")?.state=="committed")
    }
    @Test func externalConflictKeepsReservationUntilExplicitAbandon() async throws {
        let (root,library,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        var task=LifeTask();task.title="Do not falsely complete";task=try await store.saveTask(task,expectedVersion:0,requestID:"task")
        let first=try await coordinator.open(notebookID:id,day:"2026-10-30")
        let content=first.content+(try ManagedMarkdown.marker(["id":"linked","taskID":"task:"+task.id]))+"- [ ] Task\n"
        let note=try await coordinator.commit(documentID:first.documentID,expectedRevision:first.revision,content:content,commandID:"link")
        let after=content.replacingOccurrences(of:"[ ]",with:"[x]")
        let input=DocumentBlockMutation(commandID:"pending",documentID:note.documentID,expectedRevision:note.revision,blockID:"linked",expectedBlockVersion:1,kind:"complete",expectedTaskVersion:1)
        let file=DocumentMutationRecord(commandID:"pending:0",documentID:note.documentID,expectedRevision:note.revision,targetRevision:ManagedMarkdown.hash(after),before:content,after:after,state:"operationPrepared",createdAt:Date())
        _ = try await store.prepareDocumentOperation(.init(input:input,files:[file],taskID:"task:"+task.id,state:"prepared"))
        let external=content+"An external edit\n"
        _ = try await library.save(notebookID:id,path:note.path,content:external,expectedRevision:note.revision)
        let reopened=try await coordinator.open(documentID:note.documentID)
        #expect(reopened.warning != nil);#expect(try await store.tasks().first?.status != .completed)
        _ = try await coordinator.resolveOperation(documentID:note.documentID,commandID:"pending",resolution:"abandon")
        _ = try await store.saveTask(task,expectedVersion:1,requestID:"after-abandon")
        #expect(try await library.read(notebookID:id,path:note.path).content==external)
        #expect(try await store.documentOperation(commandID:"pending")?.state=="abandoned")
    }
}

struct ManagedNotebookTests {
    @Test func ordinaryRegistrationPreservesOtherFrontmatterAndIndexesReferenceBacklinks() async throws {
        let (root,library,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let original="---\ntitle: My work\ntags: [a, b]\n---\n\nA user paragraph.\n"
        let note=try await library.save(notebookID:id,path:"Work.md",content:original,expectedRevision:nil)
        let managed=try await coordinator.register(notebookID:id,path:note.path,expectedRevision:note.revision)
        #expect(managed.day.isEmpty);#expect(managed.path==note.path)
        #expect(managed.content.hasPrefix("---\ntitle: My work\ntags: [a, b]\n"));#expect(managed.content.hasSuffix("A user paragraph.\n"))
        let event=Event(type:"email.received",source:Source(connector:"email",account:"a",externalID:"1",revision:"1"),occurredAt:Date(),subjects:["person:self"],content:"Reference evidence")
        _ = try await store.ingest(event)
        let inserted=try await coordinator.insertSource(documentID:managed.documentID,expectedRevision:managed.revision,commandID:"source-insert",eventID:event.id)
        let backlinks=try await store.managedSourceBacklinks(eventID:event.id)
        #expect(backlinks.count==1);#expect(backlinks[0].path=="Work.md");#expect(backlinks[0].revision==inserted.revision)
        #expect(inserted.blocks.first?.eventID==event.id)
        _ = try await coordinator.insertSource(documentID:managed.documentID,expectedRevision:managed.revision,commandID:"source-insert",eventID:event.id)
        #expect(try await store.managedSourceBacklinks(eventID:event.id).count==1)
        _ = try await coordinator.mutateBlock(.init(commandID:"copy-ref",documentID:inserted.documentID,expectedRevision:inserted.revision,blockID:inserted.blocks[0].blockID,expectedBlockVersion:inserted.blocks[0].version,kind:"copy",targetDay:"2026-11-01"))
        let copied=try await coordinator.open(notebookID:id,day:"2026-11-01")
        #expect(copied.blocks[0].blockID != inserted.blocks[0].blockID);#expect(copied.blocks[0].eventID==event.id)
        #expect(try await store.managedSourceBacklinks(eventID:event.id).count==2)
    }
    @Test func reservedNamespaceAndCloudPlaceholderNeverOverwriteUserBytes() async throws {
        let (root,library,_,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let original="---\nmaple:\n  custom: user-owned\n---\nText\n"
        let note=try await library.save(notebookID:id,path:"Custom.md",content:original,expectedRevision:nil)
        await #expect(throws:MapleError.self){try await coordinator.register(notebookID:id,path:note.path,expectedRevision:note.revision)}
        #expect(try await library.read(notebookID:id,path:note.path).content==original)
        try await library.prepareDailyDirectory(notebookID:id)
        let placeholder=root.appendingPathComponent("Cloud/Everyday/Daily/.2026-10-30.md.icloud")
        try Data().write(to:placeholder)
        let unavailable=try NotebookLibrary(registryURL:root.appendingPathComponent("other.json"),cloudRoot:root.appendingPathComponent("Cloud"),prepareForRead:{_ in throw NotebookError.invalid("Unavailable cloud content")})
        _ = try await unavailable.catalog()
        await #expect(throws:NotebookError.self){try await unavailable.readIfPresent(notebookID:id,path:"Daily/2026-10-30.md")}
        #expect(!FileManager.default.fileExists(atPath:root.appendingPathComponent("Cloud/Everyday/Daily/2026-10-30.md").path))
    }
}

extension KnowledgeStore {
    func seedDocumentOutboxForValidationTest(_ event:Event) throws {
        try db.execute("INSERT INTO document_outbox(command_id,event_json) VALUES ('malformed-fixture',?)",[try JSONCodec.string(event)])
    }
}
struct DocumentOutboxValidationTests {
    @Test func outboxUsesTheValidatedObservationBoundary() async throws {
        let store=try KnowledgeStore(path:":memory:")
        let event=Event(type:"user.correction",source:Source(connector:"notes",account:"fixture",externalID:"doc",revision:"1"),occurredAt:Date(),subjects:["person:self"],content:"This corrupted outbox record must not enter connector ingestion.")
        try await store.seedDocumentOutboxForValidationTest(event)
        await #expect(throws:MapleError.self){try await store.drainDocumentOutbox()}
        #expect(try await store.eventCount()==0)
    }
    @Test func startupRecoveryFindsOldDayWithoutOpeningThatDate() async throws {
        let (root,library,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let note=try await coordinator.open(notebookID:id,day:"2020-01-01")
        let after=note.content+"Recovered past work\n"
        _ = try await store.prepareDocumentMutation(.init(commandID:"old-day",documentID:note.documentID,expectedRevision:note.revision,targetRevision:ManagedMarkdown.hash(after),before:note.content,after:after,state:"prepared",createdAt:Date()))
        let report=try await TodayDocumentCoordinator(store:store,library:library).recoverPendingDocuments()
        #expect(report.recoveredCount==1);#expect(report.issues.isEmpty)
        #expect(try await library.read(notebookID:id,path:note.path).content==after)
    }
}

struct ManagedDocumentContentSafetyTests {
    @Test func codeExamplesNeverBecomeActionableBlocks() throws {
        let id=UUID().uuidString
        let fake="<!-- maple:block {\"v\":1,\"id\":\"literal\"} -->"
        let text=ManagedMarkdown.header(documentID:id,day:"2026-10-30",timeZone:"America/New_York")+(try ManagedMarkdown.marker(["id":"real"]))+"````markdown\n"+fake+"\n```maple-ref\n{\"eventID\":\"fake\"}\n```\n````\n"+fake
        try ManagedMarkdown.validate(text,documentID:id)
        #expect(try ManagedMarkdown.identities(text)==["real","literal"])
        let blocks=try ManagedMarkdown.segments(text)
        #expect(blocks.map(\.id)==["real","literal"])
        #expect(blocks[0].content.contains(fake));#expect(blocks[0].eventID==nil)
    }
    @Test func generatedWritesAndReplayPreserveNewerDurableUserDraft() async throws {
        let (root,library,_,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let note=try await coordinator.open(notebookID:id,day:"2026-10-30")
        let saved=try await coordinator.commit(documentID:note.documentID,expectedRevision:note.revision,content:note.content+"Saved user work\n",commandID:"user-save")
        let draft=saved.content+"Unsaved newer user work\n"
        try await coordinator.draft(documentID:note.documentID,revision:saved.revision,content:draft)
        await #expect(throws:MapleError.self){try await coordinator.commit(documentID:note.documentID,expectedRevision:saved.revision,content:saved.content+"Generated reply\n",commandID:"bot-save",preserveDraft:true)}
        _ = try await coordinator.commit(documentID:note.documentID,expectedRevision:note.revision,content:saved.content,commandID:"user-save")
        let reopened=try await coordinator.open(documentID:note.documentID)
        #expect(reopened.draft?.content==draft)
        #expect(try await library.read(notebookID:id,path:note.path).content==saved.content)
    }
}

struct ConcurrentDraftSafetyTests {
    @Test func capturedSaveCannotReplaceDifferentNewerDraft() async throws {
        let (root,library,_,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let note=try await coordinator.open(notebookID:id,day:"2026-10-30")
        let captured=note.content+"Captured at debounce\n",newer=captured+"More keystrokes after dispatch\n"
        // Models bridge ordering where a newer draft reaches the actor while the old commit
        // is awaiting its file read. The atomic draft check must preserve that newer value.
        try await coordinator.draft(documentID:note.documentID,revision:note.revision,content:newer)
        _ = try await coordinator.commit(documentID:note.documentID,expectedRevision:note.revision,content:captured,commandID:"captured")
        #expect(try await library.readDraft(notebookID:id,path:note.path)?.content==newer)
        #expect(try await library.read(notebookID:id,path:note.path).content==captured)
        let recovered=try await coordinator.open(documentID:note.documentID)
        #expect(recovered.draft?.content==newer)
    }
}

struct CommittedDocumentReplayTests {
    @Test func replayAfterExternalEditCannotAcknowledgeAnAdvancedRevision() async throws {
        let (root,library,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let initial=try await coordinator.open(notebookID:id,day:"2026-10-30")
        let submitted=initial.content+"Original saved content\n"
        let committed=try await coordinator.commit(documentID:initial.documentID,expectedRevision:initial.revision,content:submitted,commandID:"lost-response")
        let external=submitted+"Later external edit\n"
        _ = try await library.save(notebookID:id,path:initial.path,content:external,expectedRevision:committed.revision)
        let newerDraft=submitted+"Newer editor draft\n"
        try await coordinator.draft(documentID:initial.documentID,revision:committed.revision,content:newerDraft)
        await #expect(throws:MapleError.self) {
            try await coordinator.commit(documentID:initial.documentID,expectedRevision:initial.revision,content:submitted,commandID:"lost-response")
        }
        #expect(try await library.read(notebookID:id,path:initial.path).content==external)
        #expect(try await library.readDraft(notebookID:id,path:initial.path)?.content==newerDraft)
        let history=try #require(await store.documentMutation("lost-response"))
        #expect(history.state=="committed")
        #expect(history.targetRevision==committed.revision)
        #expect(history.after==submitted)
        #expect(try await store.documentHistory(documentID:initial.documentID).count==2)
    }
}

private actor CommitReadInterference {
    var remaining:Int?
    func arm() {remaining=2}
    func prepare(_ url:URL) throws {
        guard let count=remaining else{return}
        remaining=count-1
        if remaining==0 {
            remaining=nil
            let text=try String(contentsOf:url,encoding:.utf8)
            try Data((text+"External edit after durable save\n").utf8).write(to:url,options:.atomic)
        }
    }
}
extension CommittedDocumentReplayTests {
    @Test func externalChangeBetweenFinalizeAndAcknowledgmentIsAConflict() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer{try? FileManager.default.removeItem(at:root)}
        try FileManager.default.createDirectory(at:root.appendingPathComponent("Cloud/Everyday"),withIntermediateDirectories:true)
        let interference=CommitReadInterference()
        let library=try NotebookLibrary(registryURL:root.appendingPathComponent("registry.json"),cloudRoot:root.appendingPathComponent("Cloud"),prepareForRead:{try await interference.prepare($0)})
        let id=try #require(await library.catalog().notebooks.first?.id)
        let store=try KnowledgeStore(path:root.appendingPathComponent("store.db").path)
        let coordinator=TodayDocumentCoordinator(store:store,library:library)
        let initial=try await coordinator.open(notebookID:id,day:"2026-10-30")
        let submitted=initial.content+"Captured editor contents\n"
        await interference.arm()
        await #expect(throws:MapleError.self){try await coordinator.commit(documentID:initial.documentID,expectedRevision:initial.revision,content:submitted,commandID:"changed-before-ack")}
        let current=try await library.read(notebookID:id,path:initial.path)
        #expect(current.content==submitted+"External edit after durable save\n")
        let mutation=try #require(await store.documentMutation("changed-before-ack"))
        #expect(mutation.state=="committed");#expect(mutation.after==submitted)
        #expect(mutation.targetRevision != current.revision)
    }
}
