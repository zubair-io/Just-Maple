import Foundation
import MapleCore
import MapleNotebooks

extension Bridge {
    func inlineMapleCommand(_ action:String,_ body:[String:Any]) async throws -> Any {
        guard let store=model.store else{throw MapleError.invalid("Local storage is unavailable.")}
        switch action {
        case "mapleSubmit":
            let request=InlineMapleRequest(commandID:try string(body,"commandID",limit:256),documentID:try string(body,"documentID",limit:256),requestBlockID:try string(body,"requestBlockID",limit:256),expectedRevision:try string(body,"expectedRevision",limit:256),text:try string(body,"text",limit:8000))
            if let replay=try await store.replayInlineMaple(request){return try await inlineRunPayload(replay)}
            let coordinator=try await inlineDocuments()
            let doc=try await coordinator.open(documentID:request.documentID)
            guard !doc.readOnly,doc.revision==request.expectedRevision else{throw MapleError.invalid("Save the current request before running Maple.")}
            try InlineMarkdown.validateRequest(request,in:doc.content)
            let context=try InlineMarkdown.canvasContext(request,in:doc.content)
            let run=try await store.queueInlineMaple(request,provider:model.extractionProvider,canvasContext:context)
            if run.status=="queued",model.inlineTasks[run.runID]==nil {
                let provider=ConfiguredInlineMapleProvider(name:run.provider,runner:model.acpRunner)
                model.inlineTasks[run.runID]=Task { @MainActor [weak self] in
                    guard let self else{return}
                    defer{self.model.inlineTasks[run.runID]=nil}
                    do {
                        let completed=try await InlineMapleEngine(store:store,provider:provider).run(run.runID)
                        if completed.status=="unapplied" {_ = try await self.applyInlineReply(completed)}
                    } catch {
                        // Errors retain the actual response/run; never fabricate a successful reply.
                        try? await store.failInlineMaple(run.runID)
                    }
                }
            }
            return try json(run)
        case "mapleResponseProposal":
            let coordinator=try await inlineDocuments()
            let runID=try string(body,"runID",limit:256)
            if body["editorSessionID"] != nil {
                let run=try await store.inlineMapleRun(runID)
                try await coordinator.setEditorSession(documentID:run.request.documentID,active:true,editorSessionID:string(body,"editorSessionID",limit:128))
            }
            return try json(try await coordinator.inlineResponseProposal(runID:runID))
        case "mapleSearchPage":
            let cursor:InlineSearchCursor?=body["cursor"] == nil ? nil:try decode(InlineSearchCursor.self,body,"cursor",limit:2000)
            return try json(try await store.inlineSearchPage(runID:string(body,"runID",limit:256),cursor:cursor))
        case "mapleRuns":return try json(try await store.inlineMapleRuns(documentID:string(body,"documentID",limit:256)))
        case "mapleAttempts":return try json(try await store.inlineMapleAttempts(runID:string(body,"runID",limit:256)))
        case "mapleCancel":return try json(try await store.cancelInlineMaple(string(body,"runID",limit:256)))
        case "mapleInsertResponse":
            let run=try await store.inlineMapleRun(string(body,"runID",limit:256))
            return try await inlineRunPayload(applyInlineReply(run))
        default:return try await inlineRunPayload(store.inlineMapleRun(string(body,"runID",limit:256)))
        }
    }
    private func inlineDocuments() async throws -> TodayDocumentCoordinator {
        if let coordinator=model.todayDocuments{return coordinator}
        guard let store=model.store else{throw MapleError.invalid("Local storage is unavailable.")}
        let library=try await notebookLibrary()
        if let coordinator=model.todayDocuments{return coordinator}
        let coordinator=TodayDocumentCoordinator(store:store,library:library);model.todayDocuments=coordinator;return coordinator
    }
    private func applyInlineReply(_ run:InlineMapleRun) async throws -> InlineMapleRun {
        guard let store=model.store,run.status=="unapplied" else{return run}
        let coordinator=try await inlineDocuments()
        if await coordinator.hasEditorSession(documentID:run.request.documentID) {return run}
        if let mutation=try await store.documentMutation("inline-reply:"+run.runID),mutation.state=="committed" {
            return try await store.markInlineMapleApplied(run.runID,revision:mutation.targetRevision)
        }
        let document=try await coordinator.open(documentID:run.request.documentID,backgroundRead:true)
        guard !document.readOnly else{throw MapleError.invalid("The note is read only. The reply remains in run history.")}
        if let draft=document.draft,!(draft.acceptedAutomaticBlockIDs ?? []).isEmpty || !(draft.acceptedReplyRunIDs ?? []).isEmpty {return run}
        var events:[Event]=[]
        for id in run.eventIDs {if let event=try await store.event(id){events.append(event)}}
        let content=try InlineMarkdown.applying(run,to:document.content,events:events)
        _ = try await coordinator.commit(documentID:document.documentID,expectedRevision:document.revision,content:content,commandID:"inline-reply:"+run.runID,preserveDraft:true,backgroundWrite:true)
        // A session may have claimed the document between read and commit. In
        // that case no reply was written and it stays available for the editor.
        let latest=try await store.inlineMapleRun(run.runID)
        return latest.status == "succeeded" ? latest:run
    }
    private func inlineRunPayload(_ run:InlineMapleRun) async throws -> Any {
        var result=try json(run) as? [String:Any] ?? [:]
        if run.status=="succeeded",let doc=try? await inlineDocuments().open(documentID:run.request.documentID),doc.revision==run.appliedRevision {result["content"]=doc.content}
        return result
    }
}
