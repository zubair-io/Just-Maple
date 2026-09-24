import Foundation
import Testing
@testable import MapleCore
struct TaskClarityTests {
    func source(outgoing:Bool=false)->Event {
        Event(type:"message.received",source:Source(connector:"gmail",account:"fixture",externalID:"resume",revision:"1"),occurredAt:Date(),subjects:["person:self"],content:"Gmail message\nDirection: \(outgoing ? "outgoing":"incoming")\nSender: Recruiter\nSubject: Interview availability\nBody:\nPlease send your availability.")
    }
    @Test func genericTitlesAreRejected()throws {
        for title in ["Respond to the Gmail message","Reply to the email","Respond to the message."] {
            #expect(throws:(any Error).self) {try TaskEvidenceRules.validateTitle(title)}
        }
        try TaskEvidenceRules.validateTitle("Send interview availability to the recruiter")
    }
    @Test func outgoingDoesNotCallProvider()async throws {
        let extractor=ACPExtractor(client:ACPClient(provider:"codex",runner:URL(fileURLWithPath:"/fixture-does-not-exist")))
        #expect(try await extractor.extract(source(outgoing:true),activities:[]).isEmpty)
    }
    @Test func reprocessingRetiresOnlyPendingAndRefreshesSameTitleTags()async throws {
        let store=try KnowledgeStore(path:":memory:"),event=source()
        try await store.ingest(event)
        var a=LifeActivity();a.name="Job Search"
        var b=LifeActivity();b.name="Employer"
        a=try await store.saveActivity(a,expectedVersion:0,requestID:"a")
        b=try await store.saveActivity(b,expectedVersion:0,requestID:"b")
        var suggestion=TaskSuggestion();suggestion.eventID=event.id;suggestion.provider="fixture";suggestion.quote="Please send your availability.";suggestion.candidate.title="Send interview availability"
        let original=try await store.offerTask(suggestion)
        try await store.requestTaskExtraction(eventID:event.id,reprocess:true)
        let (_,token)=try #require(await store.acquireTaskExtraction(at:Date(),eventIDs:[event.id]))
        suggestion.candidate.activityIDs=[a.id,b.id];suggestion.candidate.description="Send available interview times to the recruiter."
        try await store.commitTaskExtraction([suggestion],eventID:event.id,token:token)
        let updated=try #require(await store.worldSnapshot().suggestions.first{$0.id==original.id})
        #expect(updated.candidate.activityIDs==[a.id,b.id]);#expect(updated.sourceSubject=="Interview availability")
        #expect(updated.sourceSender=="Recruiter");#expect(updated.reviewStatus=="pending")
        #expect(try await store.worldSnapshot().suggestions.count==1)
        _ = try await store.reviewSuggestion(id:updated.id,action:"accept",edited:nil,expectedVersion:updated.version,requestID:"accept")
        try await store.requestTaskExtraction(eventID:event.id,reprocess:true)
        let (_,again)=try #require(await store.acquireTaskExtraction(at:Date(),eventIDs:[event.id]))
        try await store.commitTaskExtraction([],eventID:event.id,token:again)
        #expect(try await store.tasks().first?.activityIDs==[a.id,b.id].sorted())
        #expect(try await store.worldSnapshot().suggestions.first?.reviewStatus=="accepted")
    }
    @Test func newerSourceRevisionRetiresPriorSuggestionsAndOlderReplayCannotRestoreThem()async throws {
        let store=try KnowledgeStore(path:":memory:"),older=source()
        let newer=Event(type:older.type,source:Source(connector:"gmail",account:"fixture",externalID:"resume",revision:"2"),occurredAt:older.occurredAt,receivedAt:older.receivedAt.addingTimeInterval(1),subjects:older.subjects,content:older.content)
        for (e,title) in [(older,"Send interview availability"),(newer,"Send available interview times to the recruiter"),(older,"Send interview availability")] {
            try await store.ingest(e);try await store.requestTaskExtraction(eventID:e.id,reprocess:true)
            let (_,token)=try #require(await store.acquireTaskExtraction(at:Date(),eventIDs:[e.id]))
            var s=TaskSuggestion();s.eventID=e.id;s.quote="Please send your availability.";s.provider="fixture";s.candidate.title=title
            try await store.commitTaskExtraction([s],eventID:e.id,token:token)
        }
        let pending=try await store.worldSnapshot().suggestions.filter{$0.reviewStatus=="pending"}
        #expect(pending.count==1);#expect(pending.first?.eventID==newer.id)
    }
    @Test func emptyResultRetiresVagueSuggestionAndFailureKeepsIt()async throws {
        let store=try KnowledgeStore(path:":memory:"),event=source()
        try await store.ingest(event)
        var suggestion=TaskSuggestion();suggestion.eventID=event.id;suggestion.provider="legacy-fixture";suggestion.quote="Please send your availability.";suggestion.candidate.title="Respond to the Gmail message"
        let old=try await store.offerTask(suggestion)
        try await store.requestTaskExtraction(eventID:event.id,reprocess:true)
        let (_,token)=try #require(await store.acquireTaskExtraction(at:Date()))
        await #expect(throws:(any Error).self) {try await store.commitTaskExtraction([suggestion],eventID:event.id,token:token)}
        #expect(try await store.worldSnapshot().suggestions.first?.reviewStatus=="pending")
        try await store.commitTaskExtraction([],eventID:event.id,token:token)
        let retired=try #require(await store.worldSnapshot().suggestions.first{$0.id==old.id})
        #expect(retired.reviewStatus=="superseded")
    }
}
