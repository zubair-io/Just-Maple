import Foundation
import Testing
@testable import MapleCore

struct ProcessingScheduleTests {
    func seed(_ store:KnowledgeStore, _ connector:String, _ count:Int, now:Date) async throws -> [String] {
        var ids:[String]=[]
        for i in 0..<count {
            let event=Event(type:"observation.created",source:.init(connector:connector,account:"fixture",externalID:"\(i)",revision:"1"),occurredAt:now.addingTimeInterval(Double(i-count)*60),receivedAt:now.addingTimeInterval(-1),subjects:["person:fixture"],content:"Synthetic scheduling fixture \(i)")
            try await store.ingest(event);ids.append(event.id)
        }
        return ids
    }
    @Test func telemetryBacklogCannotStarveMailAndOldWorkGetsAShare() async throws {
        let store=try KnowledgeStore(path:":memory:"),now=Date()
        let telemetry=try await seed(store,"home_assistant",20,now:now)
        let mail=try await seed(store,"gmail",8,now:now)
        var seen:[String]=[]
        for _ in 0..<8 {seen.append(try #require(await store.acquire(now:now)).eventID)}
        #expect(Set(seen.prefix(2))==Set([telemetry.last!,mail.last!]))
        #expect(seen.contains(telemetry.first!))
        #expect(seen.contains(mail.first!))
        #expect(Set(seen).count==8)
    }
    @Test func retryDelayAndExplicitScopeArePreserved() async throws {
        let store=try KnowledgeStore(path:":memory:"),now=Date()
        let mail=try await seed(store,"gmail",2,now:now)
        let lease=try #require(await store.acquire(now:now,eventIDs:[mail[0]]))
        #expect(lease.eventID==mail[0])
        try await store.fail(lease,error:"Synthetic temporary failure",now:now)
        #expect(try await store.acquire(now:now,eventIDs:[mail[0]])==nil)
        #expect(try await store.acquire(now:now.addingTimeInterval(6),eventIDs:[mail[0]])?.eventID==mail[0])
        #expect(try await store.acquire(now:now,eventIDs:[])==nil)
    }
    @Test func expiredLeaseRecoversBeforeFreshBacklogWithinConnector() async throws {
        let store=try KnowledgeStore(path:":memory:"),now=Date()
        let ids=try await seed(store,"home_assistant",20,now:now)
        let old=try #require(await store.acquire(now:now,duration:1,eventIDs:[ids[10]]))
        let recovered=try #require(await store.acquire(now:now.addingTimeInterval(2)))
        #expect(recovered.eventID==old.eventID)
        #expect(recovered.token != old.token)
        let context=try await store.modelContext(for:old.eventID)
        let assessment=Assessment(notify:0,askUser:0,reason:0,summarize:0,jobStage:.unchanged,stageConfidence:1,model:"synthetic",provider:"fixture")
        let stale=try await store.finish(old,decision:Policy.decide(context:context,assessment:assessment),raw:Data("{}".utf8),now:now.addingTimeInterval(2))
        #expect(!stale)
    }
    @Test func concurrentWorkersNeverLeaseTheSameEvent() async throws {
        let store=try KnowledgeStore(path:":memory:"),now=Date()
        _ = try await seed(store,"gmail",8,now:now)
        let ids=try await withThrowingTaskGroup(of:String?.self) {group in
            for _ in 0..<8 {group.addTask {try await store.acquire(now:now)?.eventID}}
            var ids:[String]=[]
            for try await id in group {if let id {ids.append(id)}}
            return ids
        }
        #expect(ids.count==8);#expect(Set(ids).count==8)
    }
}
