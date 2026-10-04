import Foundation
import MapleCore
import MapleNotebooks

extension Bridge {
    func todayCoordinator() async throws -> TodayDocumentCoordinator {
        if let coordinator=model.todayDocuments {return coordinator}
        guard let store=model.store else {throw MapleError.invalid("Your local workspace is not ready.")}
        let library=try await notebookLibrary()
        if let coordinator=model.todayDocuments {return coordinator}
        let coordinator=TodayDocumentCoordinator(store:store,library:library)
        model.todayDocuments=coordinator
        return coordinator
    }
    func todayDocumentCommand(_ action:String,_ body:[String:Any]) async throws -> Any {
        let coordinator=try await todayCoordinator()
        guard let store=model.store else {throw MapleError.invalid("Your local workspace is not ready.")}
        let sessionID=try body["editorSessionID"].map {_ in try string(body,"editorSessionID",limit:128)}
        guard sessionID?.isEmpty != true else {throw MapleError.invalid("An editor session identity cannot be empty.")}
        switch action {
        case "boardExclusions":return try json(try await store.boardExclusions())
        case "boardExcludeSource":return try json(try await store.excludeBoardSource(eventID:string(body,"eventID",limit:128),scope:string(body,"scope",limit:32)))
        case "boardRemoveExclusion":try await store.removeBoardExclusion(id:string(body,"id",limit:64));return ["removed":true]
        case "documentAutomaticProposal":
            let id=try string(body,"documentID",limit:128)
            guard try await store.managedDocument(id:id) != nil else {throw MapleError.invalid("Unknown daily document.")}
            try await coordinator.setEditorSession(documentID:id,active:true,editorSessionID:sessionID)
            return try json(try await coordinator.automaticProposal(documentID:id))
        case "documentPresence", "documentAutoRefresh":
            let id=try string(body,"documentID",limit:128)
            guard try await store.managedDocument(id:id) != nil else {throw MapleError.invalid("Unknown daily document.")}
            if let active=body["active"] as? Bool {
                try await coordinator.setEditorSession(documentID:id,active:active,editorSessionID:sessionID)
            }
            let editing=body["editing"] as? Bool ?? false
            model.setTodayEditing(documentID:id,editing:editing)
            let collaborating=await coordinator.hasEditorSession(documentID:id)
            if editing || action == "documentPresence" || collaborating {return ["deferred":true]}
            return ["document":try json(try await coordinator.refreshAutomatic(documentID:id))]
        case "todayOpen", "todayMigrate":
            let library=try await notebookLibrary()
            // Today has one app-owned iCloud destination. A remembered notebook or
            // stale web request must never redirect daily writing to another folder.
            let notebookID=try await library.ensureJustMapleDailyNotebook()
            var result=try await coordinator.open(notebookID:notebookID,day:body["day"] as? String,timeZone:body["timeZone"] as? String ?? TimeZone.current.identifier,migrateLegacy:action=="todayMigrate",recoveryCopy:body["recoveryCopy"] as? Bool ?? false,collaborative:body["collaborative"] as? Bool ?? body["active"] as? Bool ?? false,editorSessionID:sessionID)
            if body["ignoreDraft"] as? Bool == true {result.draft=nil}
            return try json(result)
        case "documentRegister":return try json(try await coordinator.register(notebookID:string(body,"notebookID",limit:128),path:string(body,"path",limit:4096),expectedRevision:string(body,"expectedRevision",limit:128)))
        case "documentOpen":
            var result=try await coordinator.open(documentID:string(body,"documentID",limit:128),collaborative:body["collaborative"] as? Bool ?? body["active"] as? Bool ?? false,editorSessionID:sessionID)
            if body["ignoreDraft"] as? Bool==true {result.draft=nil}
            return try json(result)
        case "documentCommit":
            return try json(try await coordinator.commit(documentID:string(body,"documentID",limit:128),expectedRevision:string(body,"expectedRevision",limit:128),content:string(body,"content",limit:256000),commandID:string(body,"commandID",limit:256),acceptedAutomaticBlockIDs:body["acceptedAutomaticBlockIDs"] as? [String] ?? [],acceptedReplyRunIDs:body["acceptedReplyRunIDs"] as? [String] ?? []))
        case "documentDraft":
            try await coordinator.draft(documentID:string(body,"documentID",limit:128),revision:string(body,"revision",limit:128),content:string(body,"content",limit:256000),acceptedAutomaticBlockIDs:body["acceptedAutomaticBlockIDs"] as? [String] ?? [],acceptedReplyRunIDs:body["acceptedReplyRunIDs"] as? [String] ?? [])
            return ["saved":true]
        case "documentRecoveryCopy":return try json(try await coordinator.recoveryCopy(documentID:string(body,"documentID",limit:128),content:string(body,"content",limit:256000),recoveryKey:body["recoveryKey"] == nil ? nil:string(body,"recoveryKey",limit:256)))
        case "documentOperationHistory":return try json(try await store.documentOperationHistory(documentID:string(body,"documentID",limit:128)))
        case "documentOperationResolve":return try json(try await coordinator.resolveOperation(documentID:string(body,"documentID",limit:128),commandID:string(body,"commandID",limit:240),resolution:string(body,"resolution",limit:32)))
        case "documentBlockMutate":
            let input=DocumentBlockMutation(commandID:try string(body,"commandID",limit:240),documentID:try string(body,"documentID",limit:128),expectedRevision:try string(body,"expectedRevision",limit:128),blockID:try string(body,"blockID",limit:256),expectedBlockVersion:(body["expectedBlockVersion"] as? NSNumber)?.intValue ?? -1,kind:try string(body,"kind",limit:32),targetDay:body["targetDay"] as? String,expectedTaskVersion:(body["expectedTaskVersion"] as? NSNumber)?.intValue)
            return try json(try await coordinator.mutateBlock(input))
        case "documentHistory":return try json(try await store.documentHistory(documentID:string(body,"documentID",limit:128)))
        case "sourceInsert":
            return try json(try await coordinator.insertSource(documentID:string(body,"documentID",limit:128),expectedRevision:string(body,"expectedRevision",limit:128),commandID:string(body,"commandID",limit:256),eventID:string(body,"eventID",limit:256)))
        default:throw MapleError.invalid("Unsupported managed document action.")
        }
    }
}
