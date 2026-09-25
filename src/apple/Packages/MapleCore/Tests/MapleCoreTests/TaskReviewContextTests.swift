import Foundation
import Testing
@testable import MapleCore

struct TaskReviewContextTests {
    @Test(arguments:["gmail","imessage"])
    func latestRepliesBoundedByAccountThreadAndReviewTime(connector:String) async throws {
        let store=try KnowledgeStore(path:":memory:"),at=Date(timeIntervalSince1970:floor(Date().timeIntervalSince1970)+10)
        func fixture(_ id:String,days:Double,thread:String="selected",account:String="fixture",revision:String="1",received:Date?=nil)->Event {
            let date=at.addingTimeInterval(days*86400)
            return Event(type:"message.received",source:Source(connector:connector,account:account,externalID:id,revision:revision),occurredAt:date,receivedAt:received ?? date,subjects:["person:self","thread:\(connector):\(thread)"],content:"Synthetic message \(id) revision \(revision).")
        }
        let source=fixture("source",days:-4),reply=fixture("reply",days:-2),newReply=fixture("reply",days:-1,revision:"2")
        let boundary=fixture("boundary",days:-30)
        for event in [source,reply,newReply,boundary,fixture("expired",days:-30.001),fixture("future",days:1),fixture("later-import",days:-1,received:at.addingTimeInterval(1)),fixture("other-thread",days:-1,thread:"other"),fixture("other-account",days:-1,account:"other")] {try await store.ingest(event)}
        let context=try await store.taskModelContext(for:source.id,at:at)
        #expect(context.event.id == source.id && abs(context.event.occurredAt.timeIntervalSince(source.occurredAt)) < 0.001)
        #expect(context.world?.asOf == at)
        #expect(Set(context.recentEvents.map(\.id)) == [newReply.id,boundary.id])
        #expect(context.relatedEvidence.isEmpty)
        let earlier=try await store.taskModelContext(for:source.id,at:at.addingTimeInterval(-1.5*86400))
        #expect(earlier.recentEvents.contains {$0.id == reply.id})
        #expect(!earlier.recentEvents.contains {$0.id == newReply.id})
    }
    @Test func reprocessingOmitsOnlyItsOwnUnprotectedMachineSuggestion() async throws {
        let store=try KnowledgeStore(path:":memory:"),at=Date().addingTimeInterval(10)
        func event(_ id:String)->Event {
            Event(type:"message.received",source:Source(connector:"gmail",account:"fixture",externalID:id,revision:"1"),occurredAt:at.addingTimeInterval(-60),receivedAt:at.addingTimeInterval(-60),subjects:["person:self","thread:gmail:fixture"],content:"Please send the synthetic form.")
        }
        let source=event("reviewed"),other=event("other")
        var offered:[TaskSuggestion]=[]
        for e in [source,other] {
            try await store.ingest(e)
            var s=TaskSuggestion();s.eventID=e.id;s.quote=e.content;s.provider="fixture";s.candidate.title="Send synthetic form"
            offered.append(try await store.offerTask(s))
        }
        let ownID="source:"+offered[0].id,otherID="source:"+offered[1].id
        let first=try await store.taskModelContext(for:source.id,at:at)
        #expect(first.world?.tasks.contains {$0.id==ownID} == false)
        #expect(first.world?.tasks.contains {$0.id==otherID} == true)
        // Legacy explicit corrections may have no actionState; the correction table still protects them.
        _ = try await store.correctTaskInference(nodeID:ownID,status:.waiting,separate:false,expectedVersion:offered[0].version,requestID:"user-waiting",at:at.addingTimeInterval(-1))
        let corrected=try await store.taskModelContext(for:source.id,at:at)
        #expect(corrected.world?.tasks.contains {$0.id==ownID && $0.status == .waiting} == true)
        #expect(corrected.event.id==source.id)
    }
    @Test func multibyteSourceStaysWithinProviderByteBudget() async throws {
        let store=try KnowledgeStore(path:":memory:")
        let source=Event(type:"message.received",source:Source(connector:"gmail",account:"fixture",externalID:"unicode",revision:"1"),occurredAt:Date(),subjects:["person:self","thread:gmail:unicode"],content:String(repeating:"合成🙂",count:5000))
        try await store.ingest(source)
        let context=try await store.taskModelContext(for:source.id)
        #expect(context.event.content.utf8.count<=12_000)
        #expect(try TaskEvidenceRules.promptContext(context).utf8.count<=24_000)
    }
    @Test func resolvedDismissedAndCorrectedContextPreventsBlindRevival() async throws {
        let store=try KnowledgeStore(path:":memory:"),at=Date(timeIntervalSince1970:floor(Date().timeIntervalSince1970)+10)
        let source=Event(type:"message.received",source:Source(connector:"gmail",account:"fixture",externalID:"request",revision:"1"),occurredAt:at.addingTimeInterval(-86400),receivedAt:at.addingTimeInterval(-86400),subjects:["person:self","thread:gmail:fixture"],content:"Please send the synthetic form.")
        try await store.ingest(source)
        var task=LifeTask();task.title="Resolved fixture";task.status = .completed;task.evidenceIDs=[source.id]
        let saved=try await store.saveTask(task,expectedVersion:0,requestID:"save",at:at.addingTimeInterval(-1))
        var future=LifeTask();future.title="Future status must not leak";future.evidenceIDs=[source.id]
        let futureSaved=try await store.saveTask(future,expectedVersion:0,requestID:"future",at:at.addingTimeInterval(1))
        var suggestion=TaskSuggestion();suggestion.eventID=source.id;suggestion.quote="Please send";suggestion.provider="fixture";suggestion.candidate.title="Dismissed fixture"
        let offered=try await store.offerTask(suggestion,at:at.addingTimeInterval(-2))
        _ = try await store.reviewSuggestion(id:offered.id,action:"reject",edited:nil,expectedVersion:offered.version,requestID:"reject",at:at.addingTimeInterval(-1))
        let correction=try await store.correct(subject:"person:self",predicate:"availability",value:"Fixture busy")
        let futureCorrection=try await store.correct(subject:"person:self",predicate:"future-fixture",value:"Future metadata",at:at.addingTimeInterval(1))
        let context=try await store.taskModelContext(for:source.id,at:at)
        #expect(!context.currentState.contains {$0.id == futureCorrection.id})
        #expect(context.world?.tasks.contains {$0.id == saved.id && $0.status == .completed} == true)
        #expect(context.world?.tasks.contains {$0.id == "source:"+offered.id && $0.status == .cancelled} == true)
        #expect(context.currentState.contains {$0.id == correction.id})
        #expect(context.world?.tasks.contains {$0.id == futureSaved.id} == false)
        #expect(context.world?.tasks.allSatisfy {$0.evidenceIDs == [source.id]} == true)
    }
}
