import Foundation
import Testing
@testable import MapleCore

struct ACPMessageTasksTests {
    private func event(_ body:String,outgoing:Bool=false,at:Date=Date(),zone:String?="America/New_York")->Event {
        Event(type:outgoing ? "message.sent":"message.received",source:Source(connector:"imessage",account:"fixture",externalID:UUID().uuidString,revision:"1",timeZone:zone),occurredAt:at,subjects:outgoing ? ["person:self","thread:imessage:fixture"]:["person:self","person:imessage:fixture-speaker","thread:imessage:fixture"],content:"Thread: Fixture\nSender: \(outgoing ? "Me":"Fixture speaker")\nDirection: \(outgoing ? "outgoing":"incoming")\n\n\(body)")
    }
    private func output(quote:String,obligation:String?="user_action",actor:String?="person:self",deadline:String="",date:String?=nil)throws->String {
        var candidate:[String:Any] = ["title":"Bring the folding chairs to the picnic","details":"Bring the agreed chairs.","quote":quote,"deadline":deadline,"activityIDs":[]]
        if let obligation{candidate["obligation"]=obligation};if let actor{candidate["actorID"]=actor};if let date{candidate["dueDate"]=date}
        return String(decoding:try JSONSerialization.data(withJSONObject:["tasks":[candidate]]),as:UTF8.self)
    }
    @Test func incomingRequestAndOutgoingCommitmentBelongToUser()throws {
        for (body,outgoing) in [("Please bring the folding chairs.",false),("I will bring the folding chairs.",true)] {
            let source=event(body,outgoing:outgoing)
            let result=try ACPExtractor.tasks(output(quote:body),event:source,activities:[],provider:"fixture")
            #expect(result.count==1 && result.first?.candidate.status == .open)
            #expect(result.first?.actorID=="person:self" && result.first?.obligation=="user_action")
            #expect(result.first?.candidate.assignee=="You")
        }
    }
    @Test func otherPersonCommitmentIsWaitingAndTentativePlanIsNotATask()throws {
        let body="I will bring the folding chairs."
        let result=try ACPExtractor.tasks(output(quote:body,obligation:"waiting_on_other",actor:"person:imessage:fixture-speaker"),event:event(body),activities:[],provider:"fixture")
        #expect(result.first?.candidate.status == .waiting)
        #expect(result.first?.candidate.people==["person:imessage:fixture-speaker"])
        #expect(result.first?.candidate.assignee=="Fixture speaker")
        let tentative="Maybe I could bring the folding chairs."
        #expect(try ACPExtractor.tasks(output(quote:tentative,obligation:"tentative_plan",actor:"person:imessage:fixture-speaker"),event:event(tentative),activities:[],provider:"fixture").isEmpty)
    }
    @Test func missingOrInventedOwnershipAndHistoricalOnlyQuotesAreRejected()throws {
        let body="Yes, I will bring them.",source=event(body,outgoing:true)
        for text in [try output(quote:body,obligation:nil,actor:nil),try output(quote:body,actor:"person:invented"),try output(quote:body,obligation:"waiting_on_other"),try output(quote:"Please bring the folding chairs.")] {
            #expect(throws:(any Error).self){try ACPExtractor.tasks(text,event:source,activities:[],provider:"fixture")}
        }
    }
    @Test func promptUsesRecentContextButRequiresNewSourceEvidence()throws {
        let newest=event("Yes, I will bring them.",outgoing:true)
        let recent=event("Could you bring the folding chairs?",at:Date().addingTimeInterval(-60))
        let expired=event("EXPIRED CONTEXT MUST NOT BE SENT",at:Date().addingTimeInterval(-31*86400))
        let context=Context(event:newest,currentState:[],recentEvents:[recent,expired],relatedEvidence:[],version:"jev-fixture-context")
        let prompt=try ACPExtractor.taskPrompt(context,activities:[])
        #expect(prompt.contains(recent.content.replacingOccurrences(of:"\n",with:"\\n")))
        #expect(prompt.contains("jev-fixture-context"))
        #expect(!prompt.contains("EXPIRED CONTEXT MUST NOT BE SENT"))
        #expect(prompt.contains("must never create a task supported only by an older message"))
        #expect(prompt.contains("waiting_on_other") && prompt.contains("tentative_plan"))
    }
    @Test func relativeDeadlineUsesSourceZoneAndMissingZoneStaysUnresolved()throws {
        let sourceDate=try #require(ISO8601DateFormatter().date(from:"2026-09-24T02:00:00Z"))
        let body="Please bring the folding chairs tomorrow."
        let source=event(body,at:sourceDate)
        let valid=try ACPExtractor.tasks(output(quote:body,deadline:"tomorrow",date:"2026-09-24"),event:source,activities:[],provider:"fixture")
        #expect(valid.first?.candidate.due?.date=="2026-09-24")
        #expect(valid.first?.candidate.due?.timeZone=="America/New_York")
        #expect(throws:(any Error).self){try ACPExtractor.tasks(output(quote:body,deadline:"tomorrow",date:"2026-09-25"),event:source,activities:[],provider:"fixture")}
        let unresolved=try ACPExtractor.tasks(output(quote:body,deadline:"tomorrow",date:"2026-09-24"),event:event(body,at:sourceDate,zone:nil),activities:[],provider:"fixture")
        #expect(unresolved.first?.candidate.due==nil)
        #expect(unresolved.first?.deadlineExplanation.contains("tomorrow")==true)
    }
}
