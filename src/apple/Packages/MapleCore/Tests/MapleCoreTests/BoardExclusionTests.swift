import Foundation
import Testing
@testable import MapleCore

struct BoardExclusionTests {
    func source(_ key:String,sender:String,account:String="synthetic",connector:String="gmail",body:String="Synthetic notification") -> Event {
        let date=AutomaticTodayTests().now.addingTimeInterval(-20)
        return Event(type:"message.received",source:.init(connector:connector,account:account,externalID:key,revision:"1"),occurredAt:date,receivedAt:date,subjects:["person:self"],content:"Sender: \(sender)\nSubject: Fixture \(key)\nBody:\n\(body)")
    }
    @Test func githubRuleIsDurableIdempotentAndMatchesSenderNotBodyLinks() async throws {
        let (root,_,store,_,_)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let github=source("github",sender:"Synthetic Person <notifications@github.com>"),other=source("other",sender:"person@example.test",body:"See https://github.com/example/repo"),second=source("second",sender:"noreply@github.com",account:"second-account")
        for event in [github,other,second] {_ = try await store.ingest(event)}
        let rule=try await store.excludeBoardSource(eventID:github.id,scope:"github")
        #expect(try await store.excludeBoardSource(eventID:github.id,scope:"github")==rule)
        #expect(try await store.boardExclusions().count==1)
        #expect(try await store.isBoardSourceExcluded(github));#expect(try await store.isBoardSourceExcluded(second));#expect(try await !store.isBoardSourceExcluded(other))
        let reopened=try KnowledgeStore(path:root.appendingPathComponent("store.db").path)
        #expect(try await reopened.boardExclusions()==[rule])
        try await reopened.removeBoardExclusion(id:rule.id);try await reopened.removeBoardExclusion(id:rule.id)
        #expect(try await !reopened.isBoardSourceExcluded(github));#expect(try await reopened.event(github.id)==github)
    }
    @Test func exclusionRetiresUneditedSourcesPreservesEditsAndCanonicalTasks() async throws {
        let (root,_,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let now=AutomaticTodayTests().now
        var doc=try await coordinator.open(notebookID:id,day:"2026-10-30",timeZone:"UTC")
        let a=source("a",sender:"notifications@github.com"),b=source("b",sender:"notifications@github.com")
        for event in [a,b] {_ = try await store.ingest(event);try await store.automaticFixtureDecision(event.id,route:.notify,at:now)}
        doc=try await coordinator.refreshAutomatic(documentID:doc.documentID,at:now)
        let edited=try #require(doc.blocks.first{$0.eventID==b.id})
        doc=try await coordinator.commit(documentID:doc.documentID,expectedRevision:doc.revision,content:doc.content.replacingOccurrences(of:edited.content,with:edited.content+"User writing to keep\n"),commandID:"edit-board-source")
        _ = try await store.excludeBoardSource(eventID:a.id,scope:"github")
        doc=try await coordinator.refreshAutomatic(documentID:doc.documentID,at:now)
        #expect(!doc.blocks.contains{$0.eventID==a.id});#expect(doc.content.contains("User writing to keep"));#expect(doc.blocks.contains{$0.eventID==b.id})
        let c=source("c",sender:"notifications@github.com");_ = try await store.ingest(c);try await store.automaticFixtureDecision(c.id,route:.notify,at:now)
        var task=LifeTask();task.title="Explicit linked GitHub task";task.evidenceIDs=[c.id]
        task=try await store.saveTask(task,expectedVersion:0,requestID:"github-explicit-task",at:now)
        let next=try await coordinator.refreshAutomatic(documentID:doc.documentID,at:now)
        #expect(!next.blocks.contains{$0.eventID==c.id});#expect(next.blocks.contains{$0.taskID=="task:"+task.id})
        #expect(try await store.event(a.id)==a)
    }
    @Test func senderRulesRespectAccountAndSourceTypeScope() async throws {
        let (root,_,store,_,_)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        let a=source("a",sender:"Person <person@example.test>"),b=source("b",sender:"person@example.test",account:"other"),c=source("c",sender:"other@example.test")
        for event in [a,b,c] {_ = try await store.ingest(event)}
        _ = try await store.excludeBoardSource(eventID:a.id,scope:"sender")
        #expect(try await store.isBoardSourceExcluded(a));#expect(try await !store.isBoardSourceExcluded(b));#expect(try await !store.isBoardSourceExcluded(c))
        _ = try await store.excludeBoardSource(eventID:a.id,scope:"type");#expect(try await store.isBoardSourceExcluded(c));#expect(try await !store.isBoardSourceExcluded(b))
    }
}
