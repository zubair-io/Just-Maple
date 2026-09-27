import Foundation
import Testing
@testable import MapleCore

struct MessageScreeningContextTests {
    let now = Date()
    func event(_ id: String, thread: String = "selected", account: String = "fixture", age: TimeInterval = 10, content: String = "Synthetic source") -> Event {
        Event(id: id, type: "message.received", source: Source(connector: "gmail", account: account, externalID: id, revision: "1"),
              occurredAt: now.addingTimeInterval(-age), subjects: ["person:self", "thread:gmail:\(thread)"], content: content)
    }
    func task(_ id: String, evidence: [String], status: TaskStatus = .open) -> LifeTask {
        var task = LifeTask(); task.id = id; task.title = "Synthetic task \(id)"; task.evidenceIDs = evidence; task.status = status; task.updatedAt = now
        return task
    }
    @Test func excludesUnrelatedWorldButRetainsLinkedTerminalObligations() throws {
        let current = event("current", age: 0), prior = event("prior"), unrelated = event("unrelated", thread: "other")
        let otherAccount = event("otherAccount", account: "second")
        var activity = LifeActivity(); activity.id = "linked"
        var resolved = task("resolved", evidence: [prior.id], status: .completed); resolved.activityIDs = [activity.id]
        let dismissed = task("dismissed", evidence: [current.id], status: .cancelled)
        let unrelatedTasks = (0..<40).map { task("unrelated-\($0)", evidence: [unrelated.id]) }
        let input = Context(event: current, currentState: [], recentEvents: [prior, unrelated, otherAccount], relatedEvidence: [unrelated, prior, otherAccount], version: "fixture",
                            world: ReasoningWorldContext(asOf: now, activities: [activity, LifeActivity()], tasks: unrelatedTasks + [resolved, dismissed], states: []))
        let result = try MessageScreeningContext.filtered(input, at: now)
        #expect(result.recentEvents.map(\.id) == [prior.id])
        #expect(result.relatedEvidence.map(\.id) == [prior.id])
        #expect(result.world?.tasks.map(\.id) == [resolved.id, dismissed.id])
        #expect(result.world?.tasks.map(\.status) == [.completed, .cancelled])
        #expect(result.world?.activities.map(\.id) == [activity.id])
        #expect(result.event.id == current.id)
        #expect(result.version == "message-screening-v1")
    }
    @Test func preservesCorrectionAndFactSnapshotWithProvenance() throws {
        let current = event("current", age: 0), correction = event("correction", thread: "other")
        let claim = Claim(id: "claim", subject: "person:self", predicate: "availability", value: "Unavailable", evidenceEventID: correction.id, observedAt: now, confidence: 1, origin: "user")
        let fact = SourceFact(id: "fact", subject: "person:self", predicate: "availability", value: "Available", sourceQuote: "Available", eventID: correction.id, provider: "fixture", model: "fixture", extractedAt: now, sourceOccurredAt: now)
        let input = Context(event: current, currentState: [claim], recentEvents: [], relatedEvidence: [correction], version: "fixture", sourceFacts: [fact])
        let result = try MessageScreeningContext.filtered(input, at: now)
        #expect(result.currentState == input.currentState)
        #expect(result.sourceFacts == input.sourceFacts)
        #expect(result.relatedEvidence.map(\.id) == [correction.id])
    }
    @Test func oldEvidenceAndUndatedDerivedTasksNeverPass() throws {
        let current = event("current", age: 0), old = event("old", age: AIProcessingWindow.duration + 1)
        let input = Context(event: current, currentState: [], recentEvents: [old], relatedEvidence: [old], version: "fixture",
                            world: ReasoningWorldContext(asOf: now, activities: [], tasks: [task("mixed", evidence: [current.id, old.id]), task("unknown", evidence: [current.id, "absent"])], states: []))
        let result = try MessageScreeningContext.filtered(input, at: now)
        #expect(result.recentEvents.isEmpty)
        #expect(result.relatedEvidence.isEmpty)
        #expect(result.world?.tasks.isEmpty == true)
        let expired = Context(event: old, currentState: [], recentEvents: [], relatedEvidence: [], version: "fixture")
        #expect(throws: MapleError.self) { try MessageScreeningContext.filtered(expired, at: now) }
    }
    @Test func oversizeFailsWithoutSilentlyTruncatingSourceOrCorrections() throws {
        let input = Context(event: event("large", content: String(repeating: "x", count: 25_000)), currentState: [], recentEvents: [], relatedEvidence: [], version: "fixture")
        #expect(throws: MapleError.self) { try MessageScreeningContext.filtered(input, at: now) }
        let result = try MessageScreeningContext.filtered(input, at: now, maximumBytes: 30_000)
        #expect(result.event.content == input.event.content)
    }
}
