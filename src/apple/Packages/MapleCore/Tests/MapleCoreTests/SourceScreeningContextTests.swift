import Foundation
import Testing
@testable import MapleCore

struct SourceScreeningContextTests {
    let now = Date()
    func event(_ id: String, externalID: String = "selected", connector: String = "notes", account: String = "fixture", subjects: [String] = ["person:self"], age: TimeInterval = 10) -> Event {
        Event(id: id, type: "note.updated", source: Source(connector: connector, account: account, externalID: externalID, revision: id),
              occurredAt: now.addingTimeInterval(-age), subjects: subjects, content: "Synthetic source")
    }
    func task(_ id: String, evidence: [String]) -> LifeTask {
        var task = LifeTask(); task.id = id; task.title = "Synthetic task"; task.evidenceIDs = evidence; task.updatedAt = now
        return task
    }
    @Test func sourceIdentityRequiresConnectorAccountAndExternalIDAndDeduplicatesHistory() throws {
        let current = event("current", age: 0), prior = event("prior")
        let unrelated = [event("other-file", externalID: "other"), event("other-account", account: "other"), event("other-connector", connector: "contacts"), event("future", age: -1)]
        let input = Context(event: current, currentState: [], recentEvents: [prior] + unrelated, relatedEvidence: [prior, prior] + unrelated, version: "fixture")
        let result = try SourceScreeningContext.filtered(input, at: now)
        #expect(result.recentEvents.map(\.id) == [prior.id])
        #expect(result.relatedEvidence.isEmpty)
        #expect(result.event == input.event)
    }
    @Test func explicitScopeLinksEvidenceTasksAndActivitiesWithoutGlobalWorld() throws {
        let current = event("current", subjects: ["person:self", "job:fixture"], age: 0)
        let scoped = event("scoped", externalID: "other", connector: "gmail", subjects: ["job:fixture"])
        let unrelated = event("unrelated", externalID: "other")
        var activity = LifeActivity(); activity.id = "linked"
        var linked = task("linked", evidence: [scoped.id]); linked.activityIDs = [activity.id]; linked.status = .completed
        let tasks = [linked, task("unrelated", evidence: [unrelated.id]), task("unknown", evidence: [current.id, "missing"])]
        let input = Context(event: current, currentState: [], recentEvents: [scoped, unrelated], relatedEvidence: [], version: "fixture",
                            world: ReasoningWorldContext(asOf: now, activities: [activity, LifeActivity()], tasks: tasks, states: []))
        let result = try SourceScreeningContext.filtered(input, at: now)
        #expect(result.recentEvents.map(\.id) == [scoped.id])
        #expect(result.world?.tasks == [linked])
        #expect(result.world?.activities == [activity])
    }
    @Test func correctionAndFactSnapshotsAndProvenanceArePreserved() throws {
        let current = event("current", age: 0), correction = event("correction", externalID: "other")
        let claim = Claim(id: "claim", subject: "person:self", predicate: "availability", value: "Unavailable", evidenceEventID: correction.id, observedAt: now, confidence: 1, origin: "user")
        let fact = SourceFact(id: "fact", subject: "person:self", predicate: "availability", value: "Available", sourceQuote: "Available", eventID: correction.id, provider: "fixture", model: "fixture", extractedAt: now, sourceOccurredAt: now)
        let input = Context(event: current, currentState: [claim], recentEvents: [], relatedEvidence: [correction], version: "fixture", sourceFacts: [fact])
        let result = try SourceScreeningContext.filtered(input, at: now)
        #expect(result.currentState == input.currentState)
        #expect(result.sourceFacts == input.sourceFacts)
        #expect(result.relatedEvidence.map(\.id) == [correction.id])
    }
    @Test func oldOrUnknownTaskEvidenceIsExcludedAndOversizeDoesNotTruncate() throws {
        let current = event("current", age: 0), old = event("old", age: AIProcessingWindow.duration + 1)
        let input = Context(event: current, currentState: [], recentEvents: [old], relatedEvidence: [], version: "fixture",
                            world: ReasoningWorldContext(asOf: now, activities: [], tasks: [task("mixed", evidence: [current.id, old.id])], states: []))
        let result = try SourceScreeningContext.filtered(input, at: now)
        #expect(result.recentEvents.isEmpty)
        #expect(result.world?.tasks.isEmpty == true)
        #expect(throws: MapleError.self) { try SourceScreeningContext.filtered(input, at: now, maximumBytes: 1) }
    }
    @Test func largeUnrelatedWorldDoesNotAmplifyFirstPass() throws {
        let current = event("current", age: 0)
        let tasks = (0..<40).map { index in
            var value = task("unrelated-\(index)", evidence: ["absent-\(index)"])
            value.description = String(repeating: "Synthetic unrelated text. ", count: 40)
            return value
        }
        let input = Context(event: current, currentState: [], recentEvents: [], relatedEvidence: [], version: "fixture",
                            world: ReasoningWorldContext(asOf: now, activities: [], tasks: tasks, states: []))
        let before = try JSONCodec.encode(input).count
        let result = try SourceScreeningContext.filtered(input, at: now)
        #expect(before > 40_000)
        #expect(try JSONCodec.encode(result).count < 1_000)
    }
}
