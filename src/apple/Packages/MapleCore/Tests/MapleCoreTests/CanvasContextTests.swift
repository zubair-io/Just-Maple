import Foundation
import Testing
@testable import MapleCore

/// Explicit synthetic provider; tests snapshot/evidence contracts, not live model quality.
private actor CanvasFixture: InlineMapleProvider {
    nonisolated let name="synthetic-canvas-fixture",model="fixture-v1"
    let response:String
    init(_ response:String) {self.response=response}
    func respond(_ prompt:String) async throws -> String {response}
}
struct CanvasContextTests {
    func request() -> InlineMapleRequest {.init(commandID:"submit",documentID:"doc",requestBlockID:"request",expectedRevision:"revision",text:"Summarize these cards")}
    func content() throws -> String {
        let writing=try ManagedMarkdown.marker(["id":"writing"])
        let source=try ManagedMarkdown.marker(["id":"source"])
        return writing + "Keep my user writing.\n\n" + source + "```maple-ref\n{\"v\":1,\"kind\":\"email\",\"eventID\":\"email\"}\n```\n\n" + "<!-- maple:block {\"v\":1,\"id\":\"request\",\"contextBlockIDs\":[\"writing\",\"source\"]} -->\n@maple Summarize these cards\n"
    }
    @Test func contextIsResolvedFromSavedBlocksAndRequiresTheCompleteSelection() throws {
        let context=try #require(try InlineMarkdown.canvasContext(request(),in:content()))
        #expect(context.revision=="revision")
        #expect(context.blocks.map(\.blockID)==["writing","source"])
        #expect(context.blocks[0].markdown=="Keep my user writing.")
        #expect(context.blocks[1].eventID=="email")
        let removed=try content().replacingOccurrences(of:"\"id\":\"writing\"",with:"\"id\":\"removed\"")
        #expect(throws:Error.self){try InlineMarkdown.canvasContext(request(),in:removed)}
        let changed=try content().replacingOccurrences(of:"@maple Summarize these cards",with:"@maple Different request")
        #expect(throws:Error.self){try InlineMarkdown.canvasContext(request(),in:changed)}
    }
    @Test func selectedCardAnswersRetainContextResponsesAndEvidenceWithoutSearchOrTaskEffects() async throws {
        let store=try KnowledgeStore(path:":memory:")
        let email=Event(id:"email",type:"message.received",source:Source(connector:"gmail",account:"synthetic",externalID:"email",revision:"1"),occurredAt:Date(),subjects:["person:self"],content:"Synthetic email: please review by Friday.")
        try await store.ingest(email)
        let context=try #require(try InlineMarkdown.canvasContext(request(),in:content()))
        let run=try await store.queueInlineMaple(request(),provider:"synthetic-canvas-fixture",canvasContext:context)
        let replay=try await store.queueInlineMaple(request(),provider:"synthetic-canvas-fixture",canvasContext:context)
        #expect(replay.runID==run.runID)
        let done=try await InlineMapleEngine(store:store,provider:CanvasFixture(#"{"text":"Suggested next step: review the email.","eventIDs":["email"]}"#)).run(run.runID)
        #expect(done.status=="unapplied" && done.eventIDs==["email"])
        #expect(done.canvasContext==context)
        let attempts=try await store.inlineMapleAttempts(runID:run.runID)
        #expect(attempts.count==1 && attempts[0].stage=="canvas-answer" && attempts[0].validationOutcome=="valid")
        #expect(attempts[0].input.contains("Keep my user writing.") && attempts[0].input.contains("please review by Friday"))
        #expect(attempts[0].response != nil)
        #expect(done.coverage?.contains("No mailbox search or task changes") == true)
        let applied=try InlineMarkdown.applying(done,to:content(),events:[email])
        #expect(try InlineMarkdown.applying(done,to:applied,events:[email])==applied)
    }
    @Test func invalidCitationFailsAndMissingSourcesStayUnavailable() async throws {
        let store=try KnowledgeStore(path:":memory:")
        let context=try #require(try InlineMarkdown.canvasContext(request(),in:content()))
        let run=try await store.queueInlineMaple(request(),provider:"synthetic-canvas-fixture",canvasContext:context)
        let raw=#"{"text":"Fabricated claim","eventIDs":["not-supplied"]}"#
        let done=try await InlineMapleEngine(store:store,provider:CanvasFixture(raw)).run(run.runID)
        #expect(done.status=="failed" && done.text==nil)
        let attempt=try #require(try await store.inlineMapleAttempts(runID:run.runID).first)
        #expect(attempt.response==raw && attempt.validationOutcome=="invalid")
        #expect(attempt.input.contains("0 of 1 linked sources"))
    }
    @Test func oversizedDuplicateAndWrongRevisionContextsAreRejectedBeforeQueueing() async throws {
        let store=try KnowledgeStore(path:":memory:")
        let block=InlineCanvasBlock(blockID:"one",markdown:"Writing")
        for context in [InlineCanvasContext(revision:"other",blocks:[block]),InlineCanvasContext(revision:"revision",blocks:[block,block]),InlineCanvasContext(revision:"revision",blocks:[InlineCanvasBlock(blockID:"one",markdown:String(repeating:"x",count:32001))])] {
            await #expect(throws:Error.self) {try await store.queueInlineMaple(request(),provider:"synthetic-canvas-fixture",canvasContext:context)}
        }
        #expect(try await store.inlineMapleRuns(documentID:"doc").isEmpty)
    }
}
