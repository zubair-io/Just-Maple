import Foundation
import MapleCore

extension Bridge {
    func historyInbox(_ body:[String:Any]) async throws -> Any {
        guard let store=model.store else {throw MapleError.invalid("Your local workspace is not ready.")}
        let cursor:HistoryInboxCursor? = body["cursor"] == nil || body["cursor"] is NSNull ? nil:try decode(HistoryInboxCursor.self,body,"cursor",limit:4096)
        let connector=body["connector"]==nil || body["connector"] is NSNull ? nil:try string(body,"connector",limit:128)
        return try json(try await store.historyInboxPage(cursor:cursor,limit:60,connector:connector))
    }
}
