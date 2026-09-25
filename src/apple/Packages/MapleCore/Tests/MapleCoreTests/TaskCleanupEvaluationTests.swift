import Foundation
import Testing
@testable import MapleCore

private struct CleanupFixtureExtractor:TaskCandidateExtractor {
    var grantInsteadOfDecide=false
    var failInsteadOfEmpty=false
    func extract(_ context:Context,activities:[LifeActivity]) async throws->[TaskSuggestion] {
        let key=context.event.source.externalID
        let title:String
        switch key {
        case "compromised-account-reset":title="Reset the compromised account password"
        case "current-renewal":title="Renew the storage subscription"
        case "onboarding-concrete-request":title="Upload the equipment agreement"
        case "permission-decision":title=grantInsteadOfDecide ? "Grant access to the private album":"Decide whether to allow album access"
        case "current-session-extension","reaffirmed-session-extension":title=grantInsteadOfDecide ? "Grant extra usage time":"Decide whether to grant Synthetic Sender 20 extra minutes of usage"
        case "durable-purchase-permission":title=grantInsteadOfDecide ? "Approve the desk purchase":"Review the desk purchase permission request"
        case "durable-overdue-paperwork":title="Submit the outstanding reimbursement form"
        case "past-deadline-still-owed":title="Upload the overdue expense receipt"
        default:
            if failInsteadOfEmpty {throw MapleError.provider("Synthetic fixture unavailable")}
            return []
        }
        var suggestion=TaskSuggestion();suggestion.eventID=context.event.id;suggestion.provider="synthetic-fixture"
        suggestion.quote=context.event.content.components(separatedBy:"\nBody:\n").last!
        suggestion.candidate.title=title;suggestion.obligation="user_action";suggestion.actorID="person:self"
        return [suggestion]
    }
}
struct TaskCleanupEvaluationTests {
    @Test func persistedFixtureResultsMeetRubric() async throws {
        let report=try await TaskCleanupEvaluation.run(extractor:CleanupFixtureExtractor(),provider:"fixture")
        #expect(report.passed);#expect(report.cases.count==17)
        #expect(report.mode=="fixture-synthetic-task-cleanup")
        #expect(report.cases.allSatisfy{$0.queueStatus=="succeeded"})
        #expect(report.cases.first{$0.name=="past-deadline-still-owed"}?.statuses==["open"])
    }
    @Test func permissionGrantAndProviderFailureCannotPassAsCleanup() async throws {
        let report=try await TaskCleanupEvaluation.run(extractor:CleanupFixtureExtractor(grantInsteadOfDecide:true,failInsteadOfEmpty:true),provider:"fixture")
        #expect(!report.passed)
        #expect(report.cases.first{$0.name=="permission-decision"}?.passed==false)
        #expect(report.cases.first{$0.name=="current-session-extension"}?.passed==false)
        #expect(report.cases.first{$0.name=="durable-purchase-permission"}?.passed==false)
        #expect(report.cases.first{$0.name=="optional-survey"}?.queueStatus=="failed")
        #expect(report.cases.first{$0.name=="optional-survey"}?.passed==false)
    }
}
