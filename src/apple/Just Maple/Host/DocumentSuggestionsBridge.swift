import Foundation
import MapleCore

extension Bridge {
    func documentSuggestionsCommand(_ action:String,_ body:[String:Any])async throws -> Any {
        guard let store=model.store else{throw MapleError.invalid("Local storage unavailable.")}
        let documentID=try string(body,"documentID",limit:128)
        if action=="documentSuggestions" {return try json(try await store.documentSuggestions(documentID:documentID))}
        return try json(try await todayCoordinator().insertTask(documentID:documentID,expectedRevision:string(body,"expectedRevision",limit:128),commandID:string(body,"commandID",limit:256),taskID:string(body,"taskID",limit:256)))
    }
}
