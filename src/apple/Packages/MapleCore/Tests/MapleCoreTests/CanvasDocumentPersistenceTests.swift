import Foundation
import Testing
@testable import MapleCore

struct CanvasDocumentPersistenceTests {
    @Test func presentationMovesUseDocumentRevisionsAndKeepRecoverableWritingHistory() async throws {
        let (root,library,store,coordinator,notebook)=try await ManagedDocumentTests().fixture()
        defer {try? FileManager.default.removeItem(at:root)}
        let opened=try await coordinator.open(notebookID:notebook,day:"2026-10-03")
        let field="mapleCanvas: {\"v\":1,\"cards\":[{\"id\":\"sticky\",\"x\":32,\"y\":32,\"width\":320,\"height\":272,\"color\":\"yellow\",\"group\":\"box\"}],\"groups\":[{\"id\":\"box\",\"title\":\"User grouping\",\"x\":0,\"y\":0,\"width\":400,\"height\":400,\"folded\":false}]}\n"
        let body=(try ManagedMarkdown.marker(["id":"sticky"]))+"Keep the user writing.\n"
        let content=opened.content.replacingOccurrences(of:"\n---\n",with:"\n"+field+"---\n")+body
        let saved=try await coordinator.commit(documentID:opened.documentID,expectedRevision:opened.revision,content:content,commandID:"canvas-create")
        let moved=content.replacingOccurrences(of:"\"x\":32",with:"\"x\":96")
        let after=try await coordinator.commit(documentID:opened.documentID,expectedRevision:saved.revision,content:moved,commandID:"canvas-move")
        #expect(after.revision != saved.revision && after.content.hasSuffix(body))
        #expect(try await library.read(notebookID:notebook,path:opened.path).content==moved)
        let reopened=try await coordinator.open(documentID:opened.documentID)
        #expect(reopened.content==moved)
        let history=try await store.documentHistory(documentID:opened.documentID)
        #expect(history.contains{$0.commandID=="canvas-move" && $0.before==content && $0.after==moved && $0.state=="committed"})
        await #expect(throws:Error.self) {try await coordinator.commit(documentID:opened.documentID,expectedRevision:saved.revision,content:content,commandID:"stale-canvas-move")}
        #expect(try await library.read(notebookID:notebook,path:opened.path).content==moved)
    }
}
