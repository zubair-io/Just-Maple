import Foundation
import Testing
@testable import MapleCore

private actor PageFixtureProvider:InlineMapleProvider {
    nonisolated let name="synthetic-page-fixture",model="fixture-only"
    let store:KnowledgeStore,runID:String
    var calls=0
    var capturedBeforeAnswer=false
    init(store:KnowledgeStore,runID:String) {self.store=store;self.runID=runID}
    func respond(_ prompt:String) async throws -> String {
        calls += 1
        if calls == 1 {return #"{"type":"email","sender":"dom@example.invalid","query":"urgent proposal","clarification":null}"#}
        capturedBeforeAnswer=try await store.inlineSearchPage(runID:runID).availability == "available"
        return #"{"text":"Explicit fixture summary of the first search page.","eventIDs":[]}"#
    }
}

struct InlineSearchPageTests {
    private let date=Date(timeIntervalSince1970:1793376000)
    private func request(_ key:String)->InlineMapleRequest {.init(commandID:key,documentID:"fixture-document",requestBlockID:"fixture-request",expectedRevision:"fixture-revision",text:"Find urgent proposals from dom@example.invalid")}
    private func event(_ key:String,sender:String="dom@example.invalid",connector:String="gmail",body:String="urgent proposal",revision:String="1",receivedOffset:Double=0) -> Event {
        Event(id:key+"-"+revision,type:"message.received",source:.init(connector:connector,account:"synthetic-fixture",externalID:key,revision:revision),occurredAt:date,receivedAt:date.addingTimeInterval(receivedOffset),subjects:["person:self"],content:"Sender: \(sender)\nSubject: Fixture \(key)\nBody:\n\(body)")
    }

    @Test func pagesKeepOriginalEligibilityRevisionsAndProviderContextAcrossRestart() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer {try? FileManager.default.removeItem(at:root)}
        try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
        let path=root.appendingPathComponent("store.db").path,store=try KnowledgeStore(path:path)
        var matching=Set<String>()
        for i in 0..<57 {let source=event("match-\(i)");_ = try await store.ingest(source);matching.insert(source.id)}
        for source in [event("body-only",sender:"other@example.invalid",body:"urgent proposal mentions dom@example.invalid"),event("wrong-type",connector:"imessage"),event("wrong-query",body:"ordinary unrelated message"),event("revised",revision:"1"),event("revised",sender:"other@example.invalid",revision:"2",receivedOffset:1)] {_ = try await store.ingest(source)}
        let queued=try await store.queueInlineMaple(request("original-page-search"),provider:"synthetic-page-fixture")
        let provider=PageFixtureProvider(store:store,runID:queued.runID)
        let run=try await InlineMapleEngine(store:store,provider:provider).run(queued.runID)
        #expect(run.status == "unapplied" && run.eventIDs.count == 25 && run.total == 57 && run.hasMore)
        #expect(await provider.capturedBeforeAnswer)
        let originalRun=try JSONCodec.string(run),originalAttempts=try JSONCodec.string(try await store.inlineMapleAttempts(runID:run.runID))
        let first=try await store.inlineSearchPage(runID:run.runID)
        #expect(first.items.map(\.eventID) == run.eventIDs)
        #expect(first.intent?.sender == "dom@example.invalid" && first.intent?.type == "email" && first.intent?.query == "urgent proposal")
        _ = try await store.ingest(event("new-later-match",receivedOffset:2))
        _ = try await store.ingest(event("match-56",sender:"now-other@example.invalid",revision:"2",receivedOffset:3))
        let restarted=try KnowledgeStore(path:path)
        var seen=first.items.map(\.eventID),cursor=first.nextCursor
        while let current=cursor {
            let page=try await restarted.inlineSearchPage(runID:run.runID,cursor:current)
            #expect(page.total == 57 && page.capturedCount == 57 && !page.hasMoreMatches)
            #expect(page.items.count<=25 && page.items.allSatisfy{$0.availability == "available"})
            seen += page.items.map(\.eventID);cursor=page.nextCursor
        }
        #expect(seen.count == 57 && Set(seen) == matching)
        #expect(try JSONCodec.string(try await restarted.inlineMapleRun(run.runID)) == originalRun)
        #expect(try JSONCodec.string(try await restarted.inlineMapleAttempts(runID:run.runID)) == originalAttempts)
        #expect(await provider.calls == 2)
        #expect(try await restarted.inlineSearchPage(runID:run.runID).items.map(\.eventID) == first.items.map(\.eventID))
    }

    @Test func cursorsCannotChangeRunsFiltersOrBoundsAndMissingSourcesStayExplicit() async throws {
        let store=try KnowledgeStore(path:":memory:")
        for i in 0..<30 {_ = try await store.ingest(event("cursor-\(i)"))}
        let queued=try await store.queueInlineMaple(request("cursor-search"),provider:"synthetic-fixture")
        _ = try await store.startInlineMaple(queued.runID)
        _ = try await store.inlineSourceSearch(.init(type:"email",sender:"dom@example.invalid",query:"urgent proposal"),runID:queued.runID)
        let first=try await store.inlineSearchPage(runID:queued.runID),cursor=try #require(first.nextCursor)
        for bad in [InlineSearchCursor(runID:"other",offset:25,fingerprint:cursor.fingerprint),.init(runID:queued.runID,offset:-25,fingerprint:cursor.fingerprint),.init(runID:queued.runID,offset:5001,fingerprint:cursor.fingerprint),.init(runID:queued.runID,offset:25,fingerprint:"wrong"),.init(runID:queued.runID,offset:1,fingerprint:cursor.fingerprint)] {
            await #expect(throws:Error.self) {try await store.inlineSearchPage(runID:queued.runID,cursor:bad)}
        }
        await #expect(throws:Error.self) {try await store.inlineSourceSearch(.init(type:"any",sender:"",query:""),runID:queued.runID)}
        try await store.fixtureMissingPageEvidence(runID:queued.runID,position:25)
        let next=try await store.inlineSearchPage(runID:queued.runID,cursor:cursor)
        #expect(next.items.count == 5)
        #expect(next.items[0].availability == "missing" && next.items[0].reason != nil)
        #expect(next.items[0].title == nil && next.items[0].excerpt == nil && next.items[0].connector == nil)
        #expect(next.total == 30 && next.nextCursor == nil)
    }

    @Test func legacyRunsDoNotInventSnapshotsOrRerunSearch() async throws {
        let store=try KnowledgeStore(path:":memory:")
        _ = try await store.ingest(event("legacy-source"))
        let queued=try await store.queueInlineMaple(request("legacy-run"),provider:"synthetic-fixture")
        _ = try await store.startInlineMaple(queued.runID)
        let run=try await store.completeInlineMaple(queued.runID,text:"Original fixture answer",eventIDs:["legacy-source-1"],total:30,coverage:"Original fixture coverage")
        let page=try await store.inlineSearchPage(runID:run.runID)
        #expect(page.availability == "not_recorded" && page.items.isEmpty && page.message != nil)
        #expect(page.total == 30 && page.capturedCount == 0 && page.nextCursor == nil)
        #expect(try await store.inlineMapleRun(run.runID).text == run.text)
        #expect(try await store.inlineMapleAttempts(runID:run.runID).isEmpty)
    }

    @Test func boundedCaptureReportsTrueTotalAndNarrowSearchRequirement() async throws {
        let store=try KnowledgeStore(path:":memory:")
        for i in 0..<5003 {_ = try await store.ingest(event("cap-\(i)"))}
        let queued=try await store.queueInlineMaple(request("capped-search"),provider:"synthetic-fixture")
        _ = try await store.startInlineMaple(queued.runID)
        let matches=try await store.inlineSourceSearch(.init(type:"email",sender:"dom@example.invalid",query:"urgent proposal"),runID:queued.runID)
        #expect(matches.total == 5003 && matches.events.count == 25)
        let page=try await store.inlineSearchPage(runID:queued.runID),cursor=try #require(page.nextCursor)
        #expect(page.total == 5003 && page.capturedCount == 5000 && page.hasMoreMatches && page.message != nil)
        let last=try await store.inlineSearchPage(runID:queued.runID,cursor:.init(runID:queued.runID,offset:4975,fingerprint:cursor.fingerprint))
        #expect(last.items.count == 25 && last.nextCursor == nil && last.hasMoreMatches)
        #expect(try await store.inlineMapleAttempts(runID:queued.runID).isEmpty)
    }
}

private extension KnowledgeStore {
    func fixtureMissingPageEvidence(runID:String,position:Int) throws {
        // Synthetic retention fixture: preserve the captured identity when its
        // event record is no longer available, without deleting live source data.
        try db.execute("UPDATE inline_search_rows SET event_id='fixture-unavailable-event' WHERE run_id=? AND position=?",[runID,String(position)])
    }
}
