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
        switch action {
        case "todayOpen", "todayMigrate":
            let library=try await notebookLibrary()
            // Today has one app-owned iCloud destination. A remembered notebook or
            // stale web request must never redirect daily writing to another folder.
            let notebookID=try await library.ensureJustMapleDailyNotebook()
            var result=try await coordinator.open(notebookID:notebookID,day:body["day"] as? String,timeZone:body["timeZone"] as? String ?? TimeZone.current.identifier,migrateLegacy:action=="todayMigrate",recoveryCopy:body["recoveryCopy"] as? Bool ?? false)
            if body["ignoreDraft"] as? Bool == true {result.draft=nil}
            return try json(result)
        case "documentRegister":return try json(try await coordinator.register(notebookID:string(body,"notebookID",limit:128),path:string(body,"path",limit:4096),expectedRevision:string(body,"expectedRevision",limit:128)))
        case "documentOpen":
            var result=try await coordinator.open(documentID:string(body,"documentID",limit:128))
            if body["ignoreDraft"] as? Bool==true {result.draft=nil}
            return try json(result)
        case "documentCommit":
            return try json(try await coordinator.commit(documentID:string(body,"documentID",limit:128),expectedRevision:string(body,"expectedRevision",limit:128),content:string(body,"content",limit:256000),commandID:string(body,"commandID",limit:256)))
        case "documentDraft":
            try await coordinator.draft(documentID:string(body,"documentID",limit:128),revision:string(body,"revision",limit:128),content:string(body,"content",limit:256000))
            return ["saved":true]
        case "documentRecoveryCopy":return try json(try await coordinator.recoveryCopy(documentID:string(body,"documentID",limit:128),content:string(body,"content",limit:256000)))
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
