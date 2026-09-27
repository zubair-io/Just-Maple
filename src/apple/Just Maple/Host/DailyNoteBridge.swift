import Foundation
import CryptoKit
import MapleCore
import MapleCompanionTransport

extension Bridge {
    func dailyCommand(_ action: String, _ body: [String: Any]) async throws -> Any {
        guard let store=model.store else { throw MapleError.invalid("Your local workspace is not ready.") }
        switch action {
        case "dailyBlockHistory":
            return try json(try await store.dailyBlockHistory(id: string(body,"id",limit:256), before:(body["before"] as? NSNumber)?.int64Value))
        case "dailyBlockMutate":
            let mutation:DailyBlockMutation=try decode(DailyBlockMutation.self,body,"record",limit:280_000)
            let result=try await store.mutateDailyBlock(mutation,actor:.user)
            await model.refresh()
            return try json(result)
        case "dailyCarryForward":
            let day=try string(body,"day",limit:10),zone=try string(body,"timeZone",limit:128)
            guard day==DailyNoteProjection.day(timeZone:zone) else {throw MapleError.invalid("Carry-forward is only available for Today. Move a block to schedule another day.")}
            return try json(try await store.carryForwardDailyBlocks(to:day,timeZone:zone,requestID:string(body,"requestID",limit:256)))
        case "dailyNote":
            let day=try string(body,"day",limit:10),zone=try string(body,"timeZone",limit:128)
            let result=try await DailyNoteProjection.read(store:store,day:day,timeZone:zone)
            var value=try json(result) as! [String:Any]
            if day==DailyNoteProjection.day(timeZone:zone) {
                let candidates=DailyNoteProjection.eligibleTasks(world:try await store.worldSnapshot(),timeZone:zone,at:Date())
                value["projection"]=["remainingTasks":max(0,candidates.count-20)]
            }
            return value
        default: throw MapleError.invalid("Unsupported daily-note command.")
        }
    }
}

/// A bounded projection of already accepted work. Source records remain immutable evidence.
@MainActor enum DailyNoteProjection {
    static func day(at date:Date=Date(),timeZone:String=TimeZone.current.identifier)->String {
        let format=DateFormatter();format.locale=Locale(identifier:"en_US_POSIX")
        format.calendar=Calendar(identifier:.gregorian);format.timeZone=TimeZone(identifier:timeZone);format.dateFormat="yyyy-MM-dd"
        return format.string(from:date)
    }
    static func requestID(_ value:String)->String { SHA256.hash(data:Data(value.utf8)).map{String(format:"%02x",$0)}.joined() }
    static func eligibleTasks(world:WorldSnapshot,timeZone:String,at:Date)->[LifeTask] {
        var calendar=Calendar(identifier:.gregorian);calendar.timeZone=TimeZone(identifier:timeZone)!
        let end=calendar.date(byAdding:.day,value:1,to:calendar.startOfDay(for:at))!
        return world.tasks.filter { task in
            !task.status.terminal && task.status != .waiting && !(task.actionState?.isDeferred(at:at) ?? false) &&
            ((task.scheduled ?? task.due).flatMap{try? $0.boundary()} ?? .distantPast) < end
        }.sorted { a,b in
            let ad=a.due.flatMap{try? $0.boundary()} ?? .distantFuture,bd=b.due.flatMap{try? $0.boundary()} ?? .distantFuture
            if ad != bd {return ad<bd};if a.priority != b.priority{return a.priority>b.priority};return a.createdAt<b.createdAt
        }
    }
    static func read(store:KnowledgeStore,day requested:String,timeZone:String,at:Date=Date()) async throws -> DailyNoteSnapshot {
        guard SyncDailyMutation.validDay(requested,zone:timeZone) else {throw MapleError.invalid("Choose a valid day and time zone.")}
        if try await store.isManagedDailyDay(requested) {return try await store.dailyNote(day:requested,timeZone:timeZone,at:at)}
        if requested==day(at:at,timeZone:timeZone) {
            _ = try await store.refreshDailyCarryForward(to:requested,timeZone:timeZone,at:at)
            let world=try await store.worldSnapshot(at:at)
            let visible=eligibleTasks(world:world,timeZone:timeZone,at:at)
            for task in visible.prefix(20) {
                _ = try await store.upsertDailyTask(taskID:task.id,day:requested,timeZone:timeZone,requestID:"daily-task:"+requestID(task.id+"|"+String(task.version)+"|"+requested+"|"+timeZone),at:at)
            }
            let represented=Set(visible.flatMap(\.evidenceIDs))
            let unread=Set(try await store.workItems().filter{$0.status=="unread" && ["notify","ask_user"].contains($0.kind)}.map(\.eventID))
            var seen=Set<String>()
            for decision in try await store.recentDecisions(limit:50) where [.notify,.askUser].contains(decision.route) {
                guard unread.contains(decision.eventID),!represented.contains(decision.eventID),let event=try await store.event(decision.eventID),
                      event.receivedAt >= at.addingTimeInterval(-7*86400),!event.source.connector.hasPrefix("notes") else {continue}
                let key=[event.source.connector,event.source.account,event.source.externalID].joined(separator:"\u{0}")
                guard seen.insert(key).inserted else {continue}
                let kind:DailyBlockKind=event.source.connector.lowercased().contains("mail") ? .email:.message
                _ = try await store.upsertDailyAttentionSource(eventID:event.id,day:requested,timeZone:timeZone,kind:kind,requestID:"daily-source:"+requestID(event.id+"|"+requested+"|"+timeZone),at:at)
            }
        }
        try await store.reconcileDailyTaskBlocks(day:requested,timeZone:timeZone,at:at)
        return try await store.dailyNote(day:requested,timeZone:timeZone,at:at)
    }
    static func attach(to response:inout SyncResponse,store:KnowledgeStore,at:Date=Date()) async throws {
        let zone=TimeZone.current.identifier
        var calendar=Calendar(identifier:.gregorian);calendar.timeZone=TimeZone.current
        var notes:[SyncDailyNote]=[]
        // Today has first claim on the bounded payload; whole editable blocks are never truncated.
        for offset in [0,1,-1] {
            let date=calendar.date(byAdding:.day,value:offset,to:at)!
            let value=try await read(store:store,day:day(at:date,timeZone:zone),timeZone:zone,at:at)
            var note=try JSONDecoder().decode(SyncDailyNote.self,from:JSONCodec.encode(value))
            if offset==0 {note.projection=SyncDailyProjection(remainingTasks:max(0,eligibleTasks(world:try await store.worldSnapshot(at:at),timeZone:zone,at:at).count-20))}
            if try await store.isManagedDailyDay(note.day) {note.readOnly=true}
            notes.append(note)
        }
        response.dailyNotes=notes
        while try SyncCodec.encode(response).count > 235_000 {
            guard let index=response.dailyNotes?.indices.reversed().first(where:{ !(response.dailyNotes?[$0].cleared.isEmpty ?? true) || !(response.dailyNotes?[$0].blocks.isEmpty ?? true) }) else {break}
            response.dailyNotes?[index].partial=true
            if !(response.dailyNotes?[index].cleared.isEmpty ?? true) {response.dailyNotes?[index].cleared.removeLast()}
            else {response.dailyNotes?[index].blocks.removeLast()}
        }
    }
    static func apply(_ action:SyncDailyAction,deviceID:UUID,store:KnowledgeStore) async throws -> SyncDailyReceipt {
        guard action.valid else {throw CloudMailboxError.invalidPayload}
        do {
            var mutation=try JSONCodec.decode(DailyBlockMutation.self,from:JSONEncoder().encode(action.mutation))
            mutation.requestID="phone:"+deviceID.uuidString.lowercased()+":"+action.id.uuidString.lowercased()
            let result=try await store.mutateDailyBlock(mutation,actor:.user)
            return .init(id:action.id,outcome:"applied",resultingRevision:result.revision)
        } catch MapleError.invalid {return .init(id:action.id,outcome:"conflict")}
    }
}
