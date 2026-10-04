import Foundation
import Testing
import MapleCore
import MapleCompanionTransport
@testable import Just_Maple

@MainActor struct DailyNoteBridgeTests {
    func snapshot(_ value:Any)throws->DailyNoteSnapshot {try JSONCodec.decode(DailyNoteSnapshot.self,from:JSONSerialization.data(withJSONObject:value))}
    func body(_ value:DailyBlockMutation)throws->[String:Any] {["record":try JSONSerialization.jsonObject(with:JSONCodec.encode(value))]}
    @Test func bridgePersistsEditsClearRestoreAndMoveWithStableIdentity()async throws {
        let model=AppModel();model.store=try KnowledgeStore(path:":memory:")
        let bridge=Bridge(model:model),day="2026-06-01",zone="America/New_York",id=UUID().uuidString
        let create=DailyBlockMutation(kind:.create,blockID:id,expectedVersion:0,requestID:UUID().uuidString,day:day,timeZone:zone,content:"Synthetic writing",blockKind:.text)
        let created=try snapshot(try await bridge.perform("dailyBlockMutate",body(create)))
        #expect(created.blocks.first?.id==id)
        #expect(created.blocks.first?.actor == .user)
        let clear=DailyBlockMutation(kind:.clear,blockID:id,expectedVersion:1,requestID:UUID().uuidString,day:day,timeZone:zone)
        let cleared=try snapshot(try await bridge.perform("dailyBlockMutate",body(clear)))
        #expect(cleared.blocks.isEmpty && cleared.cleared.first?.completedAt==nil)
        _ = try await bridge.perform("dailyBlockMutate",body(clear))
        let restore=DailyBlockMutation(kind:.restore,blockID:id,expectedVersion:2,requestID:UUID().uuidString,day:day,timeZone:zone)
        _ = try await bridge.perform("dailyBlockMutate",body(restore))
        let move=DailyBlockMutation(kind:.move,blockID:id,expectedVersion:3,requestID:UUID().uuidString,day:day,timeZone:zone,targetDay:"2026-06-02")
        _ = try await bridge.perform("dailyBlockMutate",body(move))
        let tomorrow=try snapshot(try await bridge.perform("dailyNote",["day":"2026-06-02","timeZone":zone]))
        #expect(tomorrow.blocks.map(\.id)==[id])
        #expect(tomorrow.blocks.first?.content=="Synthetic writing")
        let history=try #require(try await bridge.perform("dailyBlockHistory",["id":id]) as? [[String:Any]])
        #expect(history.count==4)
        var stale=restore;stale.requestID=UUID().uuidString
        await #expect(throws:(any Error).self){_ = try await bridge.perform("dailyBlockMutate",body(stale))}
    }
    @Test func futureReadsNeverRolloverAndFutureCarryCommandIsRejected()async throws {
        let model=AppModel();let store=try KnowledgeStore(path:":memory:");model.store=store
        let zone="UTC",today=DailyNoteProjection.day(timeZone:zone),future="2099-01-01",id=UUID().uuidString
        _ = try await store.mutateDailyBlock(.init(kind:.create,blockID:id,expectedVersion:0,requestID:UUID().uuidString,day:today,timeZone:zone,content:"Synthetic unfinished task",blockKind:.task))
        let bridge=Bridge(model:model)
        #expect(try snapshot(try await bridge.perform("dailyNote",["day":future,"timeZone":zone])).blocks.isEmpty)
        await #expect(throws:(any Error).self){_ = try await bridge.perform("dailyCarryForward",["day":future,"timeZone":zone,"requestID":UUID().uuidString])}
        #expect(try await store.dailyNote(day:today,timeZone:zone).blocks.first?.id==id)
    }
    @Test func dailyProjectionCanAdvanceDaysWithoutRequestIDCollisionAndRefreshCompletion()async throws {
        let store=try KnowledgeStore(path:":memory:")
        var task=LifeTask();task.title="Synthetic accepted task"
        _ = try await store.saveTask(task,expectedVersion:0,requestID:"fixture-create")
        let first=Date(timeIntervalSince1970:1_790_467_200)
        let firstDay=DailyNoteProjection.day(at:first,timeZone:"UTC")
        let dayOne=try await DailyNoteProjection.read(store:store,day:firstDay,timeZone:"UTC",at:first)
        let id=try #require(dayOne.blocks.first?.id)
        let next=first.addingTimeInterval(86_400),nextDay=DailyNoteProjection.day(at:next,timeZone:"UTC")
        let dayTwo=try await DailyNoteProjection.read(store:store,day:nextDay,timeZone:"UTC",at:next)
        #expect(dayTwo.blocks.map(\.id)==[id])
        let version=try #require(dayTwo.blocks.first?.version)
        #expect(try await DailyNoteProjection.read(store:store,day:nextDay,timeZone:"UTC",at:next).blocks.first?.version==version)
        task=try #require(try await store.worldSnapshot().tasks.first);task.status = .completed
        _ = try await store.saveTask(task,expectedVersion:task.version,requestID:"fixture-complete")
        let done=try await DailyNoteProjection.read(store:store,day:nextDay,timeZone:"UTC",at:next)
        #expect(done.blocks.isEmpty && done.cleared.first?.id==id)
        #expect(done.cleared.first?.completedAt != nil)
    }
    @Test func explicitlyScheduledTodayRemainsVisibleWithFutureDeadline()async throws {
        let store=try KnowledgeStore(path:":memory:")
        let date=Date(timeIntervalSince1970:1_790_467_200),today=DailyNoteProjection.day(at:date,timeZone:"UTC")
        var scheduled=DueSpec();scheduled.date=today;scheduled.timeZone="UTC"
        var due=DueSpec();due.date="2099-01-01";due.timeZone="UTC"
        var task=LifeTask();task.title="Synthetic scheduled work";task.scheduled=scheduled;task.due=due
        _ = try await store.saveTask(task,expectedVersion:0,requestID:"fixture-scheduled")
        let world=try await store.worldSnapshot(at:date)
        #expect(DailyNoteProjection.eligibleTasks(world:world,timeZone:"UTC",at:date).map(\.id)==[task.id])
    }
    @Test func companionRetriesApplyOnceAndStaleEditHasConflictReceipt()async throws {
        let store=try KnowledgeStore(path:":memory:"),device=UUID(),id=UUID().uuidString
        let mutation=SyncDailyMutation(kind:"create",blockID:id,expectedVersion:0,requestID:UUID().uuidString,day:"2026-06-01",timeZone:"UTC",content:"Synthetic phone block",blockKind:"text")
        let action=SyncDailyAction(mutation:mutation)
        let first=try await DailyNoteProjection.apply(action,deviceID:device,store:store)
        #expect(first.outcome=="applied")
        #expect(try await DailyNoteProjection.apply(action,deviceID:device,store:store)==first)
        let stale=SyncDailyAction(mutation:.init(kind:"edit",blockID:id,expectedVersion:0,requestID:UUID().uuidString,day:mutation.day,timeZone:"UTC",content:"Stale"))
        #expect(try await DailyNoteProjection.apply(stale,deviceID:device,store:store).outcome=="conflict")
        #expect(try await store.dailyNote(day:mutation.day,timeZone:"UTC").blocks.first?.content==mutation.content)
    }
}
