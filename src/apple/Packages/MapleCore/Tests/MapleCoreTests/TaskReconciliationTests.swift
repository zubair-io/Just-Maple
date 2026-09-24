import Foundation
import Testing
@testable import MapleCore

struct TaskReconciliationTests {
    let now=Date()
    func seed(_ store:KnowledgeStore,key:String,title:String,at:Date,thread:String="fixture",dueDate:String?=nil)async throws->TaskSuggestion {
        let event=Event(type:"message.received",source:Source(connector:"gmail",account:"fixture",externalID:key,revision:"1"),occurredAt:at,subjects:["person:self","thread:gmail:"+thread],content:"Subject: Fixture\nBody:\n"+title)
        try await store.ingest(event)
        var s=TaskSuggestion();s.eventID=event.id;s.quote=title;s.provider="fixture";s.candidate.title=title
        if let dueDate {var due=DueSpec();due.date=dueDate;s.candidate.due=due}
        return try await store.offerTask(s)
    }
    func reply(_ store:KnowledgeStore,at:Date,content:String)async throws->Event {
        let event=Event(type:"message.received",source:Source(connector:"gmail",account:"fixture",externalID:UUID().uuidString,revision:"1"),occurredAt:at,subjects:["person:self","thread:gmail:fixture"],content:content)
        try await store.ingest(event);return event
    }
    @Test func duplicateCommitPreservesSourcesAndAcceptanceCreatesOneTask()async throws {
        let store=try KnowledgeStore(path:":memory:")
        let a=try await seed(store,key:"a",title:"Send the enrollment form",at:now.addingTimeInterval(-200))
        let b=try await seed(store,key:"b",title:"Return your enrollment form",at:now.addingTimeInterval(-100),dueDate:"2026-10-10")
        let job=try #require(try await store.acquireTaskReconciliation(at:now))
        #expect(try await store.acquireTaskReconciliation(at:now)==nil)
        let output=ReconciliationOutput(duplicates:[DuplicateDecision(firstID:"source:"+a.id,secondID:"source:"+b.id,reason:"Fixture same obligation",confidence:0.99)],progress:[])
        try await store.finishTaskReconciliation(job,response:JSONCodec.string(output),at:now)
        await #expect(throws:Error.self){try await store.finishTaskReconciliation(job,response:JSONCodec.string(output),at:now)}
        #expect(try await store.worldSnapshot().taskRelations.count==1)
        let current=try #require(try await store.worldSnapshot().suggestions.first{$0.id==a.id})
        _ = try await store.reviewSuggestion(id:a.id,action:"accept",edited:nil,expectedVersion:current.version,requestID:"accept")
        #expect(try await store.tasks().count==1)
        #expect(try await store.tasks().first?.due?.date=="2026-10-10")
        #expect(Set(try await store.tasks().first!.evidenceIDs)==Set([a.eventID,b.eventID]))
        #expect(try await store.worldSnapshot().suggestions.allSatisfy{$0.reviewStatus=="accepted"})
    }
    @Test func laterCompletionHasEvidenceAndUserReopenWins()async throws {
        let store=try KnowledgeStore(path:":memory:")
        let a=try await seed(store,key:"a",title:"Send the enrollment form",at:now.addingTimeInterval(-200))
        let event=try await reply(store,at:now.addingTimeInterval(-100),content:"I sent the completed enrollment form.")
        let job=try #require(try await store.acquireTaskReconciliation(at:now))
        let output=ReconciliationOutput(duplicates:[],progress:[ProgressDecision(nodeID:"source:"+a.id,status:.completed,eventID:event.id,quote:event.content,reason:"Fixture submission confirmed",confidence:0.99)])
        try await store.finishTaskReconciliation(job,response:JSONCodec.string(output),at:now)
        let snapshot=try await store.worldSnapshot()
        #expect(snapshot.suggestions.first?.candidate.status == .completed)
        #expect(snapshot.taskProgress.first?.eventID==event.id)
        _ = try await store.correctTaskInference(nodeID:"source:"+a.id,status:.open,separate:false,expectedVersion:snapshot.suggestions.first!.version,requestID:"reopen",at:now)
        let next=try #require(try await store.acquireTaskReconciliation(at:now.addingTimeInterval(181)))
        #expect(next.input.nodes.first?.userStatus==true)
        await #expect(throws:Error.self){try await store.finishTaskReconciliation(next,response:JSONCodec.string(output),at:now.addingTimeInterval(181))}
        #expect(try await store.worldSnapshot().suggestions.first?.candidate.status == .open)
    }
    @Test func unsupportedOrOldProgressRollsBackEntireBatch()async throws {
        let store=try KnowledgeStore(path:":memory:")
        let a=try await seed(store,key:"a",title:"Send the enrollment form",at:now.addingTimeInterval(-200))
        let b=try await seed(store,key:"b",title:"Return your enrollment form",at:now.addingTimeInterval(-100))
        _ = try await reply(store,at:now.addingTimeInterval(-31*86400),content:"Old form completed.")
        let job=try #require(try await store.acquireTaskReconciliation(at:now))
        #expect(job.input.sources.allSatisfy{AIProcessingWindow.includes($0.occurredAt,at:now)})
        let output=ReconciliationOutput(duplicates:[DuplicateDecision(firstID:"source:"+a.id,secondID:"source:"+b.id,reason:"Fixture",confidence:0.99)],progress:[ProgressDecision(nodeID:"source:"+a.id,status:.completed,eventID:b.eventID,quote:"Invented completion",reason:"Fixture",confidence:0.99)])
        await #expect(throws:Error.self){try await store.finishTaskReconciliation(job,response:JSONCodec.string(output),at:now)}
        #expect(try await store.worldSnapshot().taskRelations.isEmpty)
        #expect(try await store.worldSnapshot().suggestions.allSatisfy{$0.candidate.status == .open})
    }
    @Test func explicitSeparationPreventsRecombiningAndConcurrentEditsInvalidateBatch()async throws {
        let store=try KnowledgeStore(path:":memory:")
        let a=try await seed(store,key:"a",title:"Send the enrollment form",at:now.addingTimeInterval(-200))
        let b=try await seed(store,key:"b",title:"Return your enrollment form",at:now.addingTimeInterval(-100))
        let job=try #require(try await store.acquireTaskReconciliation(at:now))
        let output=ReconciliationOutput(duplicates:[DuplicateDecision(firstID:"source:"+a.id,secondID:"source:"+b.id,reason:"Fixture",confidence:0.99)],progress:[])
        try await store.finishTaskReconciliation(job,response:JSONCodec.string(output),at:now)
        let current=try #require(try await store.worldSnapshot().suggestions.first{$0.id==a.id})
        _ = try await store.correctTaskInference(nodeID:"source:"+a.id,status:nil,separate:true,expectedVersion:current.version,requestID:"separate",at:now)
        let next=try #require(try await store.acquireTaskReconciliation(at:now.addingTimeInterval(181)))
        await #expect(throws:Error.self){try await store.finishTaskReconciliation(next,response:JSONCodec.string(output),at:now.addingTimeInterval(181))}
        #expect(try await store.worldSnapshot().taskRelations.isEmpty)
        _ = try await store.reviewSuggestion(id:a.id,action:"reject",edited:nil,expectedVersion:current.version,requestID:"reject")
        await #expect(throws:Error.self){try await store.finishTaskReconciliation(next,response:"{\"duplicates\":[],\"progress\":[]}",at:now.addingTimeInterval(181))}
    }
}
