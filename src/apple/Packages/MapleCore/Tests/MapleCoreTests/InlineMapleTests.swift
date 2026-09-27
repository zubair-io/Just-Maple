import Foundation
import Testing
@testable import MapleCore

private actor InlineFixture:InlineMapleProvider {
    nonisolated let name="fixture",model="synthetic-v1"
    var responses:[String]
    init(_ values:[String]){responses=values}
    func respond(_ prompt:String) throws -> String {
        guard !responses.isEmpty else{throw MapleError.provider("fixture exhausted")}
        return responses.removeFirst()
    }
}
struct InlineMapleTests {
    func request(_ id:String="submit")->InlineMapleRequest {.init(commandID:id,documentID:"doc",requestBlockID:"block",expectedRevision:"rev",text:"Find emails from Dominick")}
    func event(_ id:String,sender:String,body:String="Please review the proposal.",revision:String="1",externalID:String?=nil)->Event {
        Event(id:id,type:"message.received",source:Source(connector:"gmail",account:"fixture",externalID:externalID ?? id,revision:revision),occurredAt:Date(),subjects:["person:self"],content:"Gmail message\nSender: \(sender)\nSubject: Fixture proposal\nBody:\n\(body)")
    }
    @Test func durableSubmissionIsIdempotentAndPayloadChecked()async throws {
        let store=try KnowledgeStore(path:":memory:")
        let first=try await store.queueInlineMaple(request(),provider:"fixture")
        let replay=try await store.queueInlineMaple(request(),provider:"fixture")
        #expect(first.runID==replay.runID)
        #expect(try await store.inlineMapleRuns(documentID:"doc").count==1)
        let mismatch=InlineMapleRequest(commandID:"submit",documentID:"doc",requestBlockID:"block",expectedRevision:"rev",text:"different")
        await #expect(throws:Error.self){try await store.queueInlineMaple(mismatch,provider:"fixture")}
    }
    @Test func senderSearchExcludesBodyMentionsAndDeduplicatesRevisions()async throws {
        let store=try KnowledgeStore(path:":memory:")
        try await store.ingest(event("old",sender:"Dominick <dom@example.invalid>",externalID:"same"))
        try await store.ingest(event("latest",sender:"Dominick <dom@example.invalid>",revision:"2",externalID:"same"))
        try await store.ingest(event("other",sender:"Maya",body:"Dominick is mentioned only here."))
        let matches=try await store.inlineSourceSearch(.init(type:"email",sender:"Dominick",query:""))
        #expect(matches.total==1 && matches.events.map(\.id)==["latest"])
    }
    @Test func actualResponsesAndContextAreRetainedAndReplyIsAnchoredOnce()async throws {
        let store=try KnowledgeStore(path:":memory:")
        let e=event("email",sender:"Dominick")
        try await store.ingest(e)
        let run=try await store.queueInlineMaple(request(),provider:"fixture")
        let fixture=InlineFixture([#"{"type":"email","sender":"Dominick","query":"","clarification":null}"#,#"{"text":"I found your proposal email.","eventIDs":["email"]}"#])
        let done=try await InlineMapleEngine(store:store,provider:fixture).run(run.runID)
        #expect(done.status=="unapplied" && done.eventIDs==[e.id])
        let attempts=try await store.inlineMapleAttempts(runID:run.runID)
        #expect(attempts.count==2 && attempts.allSatisfy{$0.response != nil && $0.validationOutcome=="valid"})
        #expect(attempts[1].input.contains("SOURCE RESULTS"))
        let content=try ManagedMarkdown.marker(["id":"block"])+"@maple Find emails from Dominick\n\n"+ManagedMarkdown.marker(["id":"user"])+"My later writing.\n"
        let applied=try InlineMarkdown.applying(done,to:content,events:[e])
        #expect(applied.contains("My later writing."))
        #expect(try InlineMarkdown.applying(done,to:applied,events:[e])==applied)
        #expect(throws:Error.self){try InlineMarkdown.applying(done,to:content.replacingOccurrences(of:"Find emails from Dominick",with:"Changed request"),events:[e])}
    }
    @Test func unsupportedCitationFailsWithoutFixtureFallbackAndKeepsRawOutput()async throws {
        let store=try KnowledgeStore(path:":memory:")
        let run=try await store.queueInlineMaple(request(),provider:"fixture")
        let raw=#"{"text":"Unsupported answer","eventIDs":["invented"]}"#
        let fixture=InlineFixture([#"{"type":"email","sender":"Dominick","query":"","clarification":null}"#,raw])
        let done=try await InlineMapleEngine(store:store,provider:fixture).run(run.runID)
        #expect(done.status=="failed" && done.text==nil && done.eventIDs.isEmpty)
        let attempts=try await store.inlineMapleAttempts(runID:run.runID)
        #expect(attempts.last?.response==raw && attempts.last?.validationOutcome=="invalid")
    }
    @Test func homeSearchUsesCanonicalConnectorAndLargeInvalidOutputRemainsInspectable() async throws {
        let store=try KnowledgeStore(path:":memory:")
        try await store.ingest(Event(id:"home",type:"home.state",source:Source(connector:"home_assistant",account:"fixture",externalID:"door",revision:"1"),occurredAt:Date(),subjects:["person:self"],content:"Home Assistant entity: door\nState: closed"))
        #expect(try await store.inlineSourceSearch(.init(type:"home",sender:"",query:"door")).events.map(\.id)==["home"])
        let run=try await store.queueInlineMaple(request(),provider:"fixture")
        let raw=String(repeating:"not JSON ",count:4000)
        let done=try await InlineMapleEngine(store:store,provider:InlineFixture([raw])).run(run.runID)
        #expect(done.status=="failed")
        #expect(try await store.inlineMapleAttempts(runID:run.runID).first?.response==raw)
    }
    @Test func decodableInvalidIntentIsNotReportedValidAndAppleContextIncludesInstructions()async throws {
        let store=try KnowledgeStore(path:":memory:")
        let run=try await store.queueInlineMaple(request(),provider:"fixture")
        let raw=#"{"type":"banana","sender":"","query":"","clarification":null}"#
        let done=try await InlineMapleEngine(store:store,provider:InlineFixture([raw])).run(run.runID)
        #expect(done.status=="failed")
        #expect(try await store.inlineMapleAttempts(runID:run.runID).first?.validationOutcome=="invalid")
        let provider=ConfiguredInlineMapleProvider(name:"apple",runner:URL(fileURLWithPath:"/not-used"))
        let capture=provider.capturedInput("Synthetic question")
        #expect(capture.contains("systemInstructions") && capture.contains("Synthetic question"))
    }
    @Test func quotedRequestMetadataCannotBecomeExecutableAnchor()throws {
        let markdown="```markdown\n"+(try ManagedMarkdown.marker(["id":"block"]))+"@maple Find emails from Dominick\n```\n"
        #expect(throws:Error.self){try InlineMarkdown.validateRequest(request(),in:markdown)}
    }
    @Test func canceledAndInterruptedRequestsNeverBecomeSuccess()async throws {
        let store=try KnowledgeStore(path:":memory:")
        let canceled=try await store.queueInlineMaple(request("cancel"),provider:"fixture")
        _ = try await store.cancelInlineMaple(canceled.runID)
        let result=try await InlineMapleEngine(store:store,provider:InlineFixture([])).run(canceled.runID)
        #expect(result.status=="canceled")
        let interrupted=try await store.queueInlineMaple(request("interrupt"),provider:"fixture")
        _ = try await store.startInlineMaple(interrupted.runID)
        try await store.recoverInterruptedInlineMaple()
        #expect(try await store.inlineMapleRun(interrupted.runID).status=="failed")
        #expect(try await store.inlineMapleRun(canceled.runID).status=="canceled")
    }
}
