import Foundation
import Testing
import MapleNotebooks
@testable import MapleCore

struct LocalDocumentSessionTests {
    @Test func departedOwnerCannotReleaseOrRenewSuccessorsSession() async throws {
        let (root,_,_,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let initial=try await coordinator.open(notebookID:id,day:"2026-10-30",collaborative:true,editorSessionID:"today-owner")
        _ = try await coordinator.open(documentID:initial.documentID,collaborative:true,editorSessionID:"notebook-owner")
        try await coordinator.setEditorSession(documentID:initial.documentID,active:false,editorSessionID:"today-owner")
        #expect(await coordinator.hasEditorSession(documentID:initial.documentID))
        await #expect(throws:Error.self) {try await coordinator.setEditorSession(documentID:initial.documentID,active:true,editorSessionID:"today-owner")}
        try await coordinator.setEditorSession(documentID:initial.documentID,active:false)
        #expect(await coordinator.hasEditorSession(documentID:initial.documentID))
        _ = try await coordinator.open(documentID:initial.documentID,collaborative:true)
        try await coordinator.setEditorSession(documentID:initial.documentID,active:true,editorSessionID:"notebook-owner")
        try await coordinator.setEditorSession(documentID:initial.documentID,active:false,editorSessionID:"notebook-owner")
        #expect(!((await coordinator.hasEditorSession(documentID:initial.documentID))))
        await #expect(throws:Error.self) {try await coordinator.setEditorSession(documentID:initial.documentID,active:true,editorSessionID:"notebook-owner")}
    }

    @Test func abandonedMoveCannotBeRetriedOrFinalizedFromStaleOperation() async throws {
        let (root,library,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let (source,target,operation)=try await preparedMove(coordinator:coordinator,store:store,notebookID:id)
        _ = try await coordinator.resolveOperation(documentID:source.documentID,commandID:operation.input.commandID,resolution:"abandon")
        await #expect(throws:Error.self) {try await coordinator.resolveOperation(documentID:source.documentID,commandID:operation.input.commandID,resolution:"retry")}
        await #expect(throws:Error.self) {try await store.finalizeDocumentOperation(operation)}
        await #expect(throws:Error.self) {try await store.markDocumentOperationConflict(operation)}
        #expect(try await library.read(notebookID:id,path:source.path).content == source.content)
        #expect(try await library.read(notebookID:id,path:target.path).content == target.content)
        #expect(try await store.documentBlock(id:"moving")?.documentID == source.documentID)
        #expect(try await store.documentOperation(commandID:operation.input.commandID)?.state == "abandoned")
    }

    @Test(arguments:[false,true]) func abandonAndRecoverySerializeWholeMove(abandonFirst:Bool) async throws {
        let (root,library,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let (source,target,operation)=try await preparedMove(coordinator:coordinator,store:store,notebookID:id)
        try await coordinator.acquire([source.documentID,target.documentID])
        let first=Task {try? await coordinator.resolveOperation(documentID:source.documentID,commandID:operation.input.commandID,resolution:abandonFirst ? "abandon":"retry")}
        for _ in 0..<5 {await Task.yield()}
        let second=Task {try? await coordinator.resolveOperation(documentID:source.documentID,commandID:operation.input.commandID,resolution:abandonFirst ? "retry":"abandon")}
        await coordinator.release([source.documentID,target.documentID])
        _ = await first.value;_ = await second.value
        let state=try #require(try await store.documentOperation(commandID:operation.input.commandID)?.state)
        let sourceDisk=try await library.read(notebookID:id,path:source.path),targetDisk=try await library.read(notebookID:id,path:target.path)
        if state == "abandoned" {
            #expect(sourceDisk.content == source.content && targetDisk.content == target.content)
            #expect(try await store.documentBlock(id:"moving")?.documentID == source.documentID)
        } else {
            #expect(state == "committed")
            #expect(sourceDisk.content == operation.files[0].after && targetDisk.content == operation.files[1].after)
            #expect(try await store.documentBlock(id:"moving")?.documentID == target.documentID)
        }
    }

    private func preparedMove(coordinator:TodayDocumentCoordinator,store:KnowledgeStore,notebookID:String) async throws -> (TodayDocumentSnapshot,TodayDocumentSnapshot,DocumentOperation) {
        let first=try await coordinator.open(notebookID:notebookID,day:"2026-10-30"),target=try await coordinator.open(notebookID:notebookID,day:"2026-10-31")
        let block=(try ManagedMarkdown.marker(["id":"moving"]))+"Fixture move\n"
        let source=try await coordinator.commit(documentID:first.documentID,expectedRevision:first.revision,content:first.content+block,commandID:"insert-moving")
        let input=DocumentBlockMutation(commandID:"move-race",documentID:source.documentID,expectedRevision:source.revision,blockID:"moving",expectedBlockVersion:1,kind:"move",targetDay:"2026-10-31")
        let files=[DocumentMutationRecord(commandID:"move-race:0",documentID:source.documentID,expectedRevision:source.revision,targetRevision:ManagedMarkdown.hash(first.content),before:source.content,after:first.content,state:"operationPrepared",createdAt:Date()),DocumentMutationRecord(commandID:"move-race:1",documentID:target.documentID,expectedRevision:target.revision,targetRevision:ManagedMarkdown.hash(target.content+block),before:target.content,after:target.content+block,state:"operationPrepared",createdAt:Date())]
        let operation=try await store.prepareDocumentOperation(.init(input:input,files:files,state:"prepared"))
        return (source,target,operation)
    }
}
