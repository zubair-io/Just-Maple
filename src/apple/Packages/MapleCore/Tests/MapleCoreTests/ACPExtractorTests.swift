import Foundation
import Testing
@testable import MapleCore
struct ACPExtractorTests {
    let event=Event(type:"message.received",source:Source(connector:"gmail",account:"test",externalID:"1",revision:"1"),occurredAt:Date(),subjects:["person:self"],content:"Please send your resume by Friday.")
    @Test func requiresGroundedQuotesDeadlinesAndActivityIDs()throws {
        let good = #"{"tasks":[{"title":"Send resume","quote":"Please send your resume by Friday.","deadline":"Friday","activityIDs":[]}]}"#
        let result=try ACPExtractor.tasks(good,event:event,activities:[],provider:"codex")
        #expect(result.count==1);#expect(result[0].provider=="acp/codex/tasks-v2-context")
        #expect(result[0].reviewStatus == "pending")
        for bad in [good.replacingOccurrences(of:"Friday",with:"Monday"),good.replacingOccurrences(of:"\"activityIDs\":[]",with:"\"activityIDs\":[\"invented\"]"),"not json"] {
            #expect(throws:(any Error).self) {try ACPExtractor.tasks(bad,event:event,activities:[],provider:"claude")}
        }
    }
    @Test func emptyOutputDoesNotInventTasks()throws {
        #expect(try ACPExtractor.tasks(#"{"tasks":[]}"#,event:event,activities:[],provider:"claude").isEmpty)
    }
}
