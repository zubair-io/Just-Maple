import Foundation
import Testing
@testable import MapleCore

struct SourceConversationTests {
    let now=ISO8601DateFormatter().date(from:"2026-10-30T16:00:00Z")!
    func message(_ key:String,account:String="synthetic",thread:String="one",revision:String="1",at:Date,body:String="Synthetic message") -> Event {
        Event(type:"message.received",source:Source(connector:"gmail",account:account,externalID:key,revision:revision),occurredAt:at,receivedAt:at,subjects:["person:self","thread:gmail:"+thread],content:"Sender: Synthetic person\nDirection: outgoing\nBody:\n"+body)
    }
    @Test func explicitThreadAndAccountBoundConversationWithoutFutureLeak() async throws {
        let (root,_,store,_,_)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let selected=message("selected",at:now.addingTimeInterval(-60)),reply=message("reply",at:now.addingTimeInterval(-30))
        for event in [selected,reply,message("other-account",account:"different",at:now),message("other-thread",thread:"two",at:now),message("future",at:now.addingTimeInterval(60))] {_ = try await store.ingest(event)}
        let detail=try await store.sourceDetail(eventID:selected.id,now:now)
        let conversation=try #require(detail.conversation)
        #expect(conversation.messages.map(\.eventID)==[selected.id,reply.id])
        #expect(conversation.totalMessages==2 && conversation.omittedMessages==0)
        #expect(conversation.messages.first?.selected==true)
        #expect(conversation.messages.last?.direction=="outgoing")
        #expect(conversation.messages.last?.sender=="Synthetic person")
        let noThread=Event(type:"message.received",source:Source(connector:"gmail",account:"synthetic",externalID:"unthreaded",revision:"1"),occurredAt:now,receivedAt:now,subjects:["person:self"],content:"Synthetic person with the same subject is not a conversation identity.")
        _ = try await store.ingest(noThread)
        #expect(try await store.sourceDetail(eventID:noThread.id,now:now).conversation==nil)
    }
    @Test func recentWindowPreservesSelectedHistoricalRevisionAndReportsOmissionsAndTruncation() async throws {
        let (root,_,store,_,_)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let selected=message("original",at:now.addingTimeInterval(-3600),body:String(repeating:"界",count:1000))
        _ = try await store.ingest(selected)
        for index in 0..<55 {_ = try await store.ingest(message("message-\(index)",at:now.addingTimeInterval(Double(-index*30-30))))}
        let latest=message("original",revision:"2",at:now)
        _ = try await store.ingest(latest)
        let conversation=try #require(try await store.sourceDetail(eventID:selected.id,now:now).conversation)
        #expect(conversation.totalMessages==56)
        #expect(conversation.messages.count==51)
        #expect(conversation.omittedMessages==6)
        #expect(Set(conversation.messages.map(\.eventID)).count==51)
        let original=try #require(conversation.messages.first{$0.eventID==selected.id})
        #expect(original.historicalRevision && original.selected && original.truncated)
        #expect(original.content.utf8.count<=1600)
        #expect(!original.content.contains("�"))
        #expect(conversation.messages.last?.eventID==latest.id)
    }
}
