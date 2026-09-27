import Foundation
import Testing
import MapleCore
import MapleCompanionTransport
@testable import Just_Maple

@MainActor
struct CompanionSyncProjectionTests {
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    func emptyWorld() async throws -> WorldSnapshot { try await KnowledgeStore(path: ":memory:").worldSnapshot(at: now) }
    func task(_ id: String, status: TaskStatus = .open) -> LifeTask {
        var task = LifeTask(); task.id = id; task.title = "Fixture task \(id)"; task.status = status; task.createdAt = now; return task
    }
    func relation(_ duplicate: String, _ primary: String) throws -> TaskRelation {
        try JSONCodec.decode(TaskRelation.self, from: JSONSerialization.data(withJSONObject: ["duplicateID": duplicate, "primaryID": primary, "reason": "PRIVATE RELATION", "evidenceIDs": ["PRIVATE EVIDENCE"]]))
    }
    func state(_ subject: String, value: String) throws -> StateProjection {
        try JSONCodec.decode(StateProjection.self, from: JSONSerialization.data(withJSONObject: ["subject": subject, "property": "presence", "status": "known", "value": value, "candidates": [], "reason": "PRIVATE STATE REASON", "revision": 1, "asOf": now.timeIntervalSince1970]))
    }

    @Test func detectedTasksUseDesktopRootsTagsAndMissingDueInheritance() async throws {
        var world = try await emptyWorld()
        var root = TaskSuggestion(); root.id = "root"; root.candidate = task("candidate-root"); root.candidate.activityIDs = ["a"]
        var duplicate = TaskSuggestion(); duplicate.id = "alias"; duplicate.candidate = task("candidate-alias"); duplicate.candidate.activityIDs = ["b"]
        var due = DueSpec(); due.kind = .date; due.date = "2027-01-01"; due.timeZone = "America/New_York"; duplicate.candidate.due = due
        var accepted = TaskSuggestion(); accepted.id = "accepted"; accepted.reviewStatus = "accepted"; accepted.acceptedTaskID = "canonical"
        var rejected = TaskSuggestion(); rejected.id = "rejected"; rejected.reviewStatus = "rejected"
        var a = LifeActivity(); a.id = "a"; a.name = "Fixture area"
        var b = LifeActivity(); b.id = "b"; b.name = "Fixture pursuit"
        world.activities = [a,b]; world.tasks = [task("canonical"), task("done", status: .completed)]
        world.suggestions = [root,duplicate,accepted,rejected]
        world.taskRelations = [try relation("source:alias", "source:root")]
        let response = CompanionSyncProjection.make(world: world, deviceID: UUID(), receivedIDs: [])
        #expect(response.tasks.map(\.id) == ["source:root", "task:canonical"])
        #expect(response.tasks.first?.activities == [a.name,b.name])
        #expect(response.tasks.first?.activityIDs == [a.id,b.id])
        #expect(response.tasks.first?.due != nil)
        #expect(response.tasks.first?.dueAt == (try due.boundary(endOfDay:true)))
        #expect(response.tasks.first?.due?.contains(":") == false)
    }

    @Test func linkedUpdatesAndCanonicalAliasesDoNotProduceExtraRowsOrChangeCanonicalDeadline() async throws {
        var world = try await emptyWorld()
        world.tasks = [task("canonical")]
        var update = TaskSuggestion(); update.id = "update"; update.linkedTaskID = "canonical"
        var duplicate = TaskSuggestion(); duplicate.id = "alias"; duplicate.candidate = task("alias")
        var due = DueSpec(); due.kind = .instant; due.instant = now; due.timeZone = "UTC"; duplicate.candidate.due = due
        world.suggestions = [update,duplicate]
        world.taskRelations = [try relation("source:alias", "task:canonical")]
        let response = CompanionSyncProjection.make(world: world, deviceID: UUID(), receivedIDs: [])
        #expect(response.tasks.count == 1)
        #expect(response.tasks.first?.id == "task:canonical")
        #expect(response.tasks.first?.due == nil)
    }

    @Test func waitingCannotStarveNeedsYouAndActivityIdentitySurvivesTruncatedLabels() async throws {
        var world = try await emptyWorld()
        var due = DueSpec();due.kind = .instant;due.instant = now.addingTimeInterval(-86400);due.timeZone = "UTC"
        world.tasks = (0..<60).map { index in var value = task("waiting-\(index)",status:.waiting);value.due=due;return value }
        var action=task("action");action.activityIDs=["first","second"];world.tasks.append(action)
        var first=LifeActivity();first.id="first";first.name=String(repeating:"Long name ",count:20)+"A"
        var second=first;second.id="second";second.name=String(repeating:"Long name ",count:20)+"B"
        world.activities=[first,second]
        let response=CompanionSyncProjection.make(world:world,deviceID:UUID(),receivedIDs:[])
        #expect(response.tasks.count==50)
        #expect(response.tasks.first?.id=="task:action")
        #expect(response.needsYouTotal==1 && response.waitingTotal==60)
        #expect(response.tasks.first?.activities.first==response.tasks.first?.activities.last)
        #expect(response.tasks.first?.activityIDs==["first","second"])
        world.tasks += (0..<60).map {task("action-\($0)")}
        let both=CompanionSyncProjection.make(world:world,deviceID:UUID(),receivedIDs:[])
        #expect(both.tasks.filter{$0.status != "waiting"}.count==40)
        #expect(both.tasks.filter{$0.status == "waiting"}.count==10)
    }

    @Test func deferredTaskRemainsAccessibleButDoesNotCountAsNeedsYouUntilResurfaceTime() async throws {
        let store=try KnowledgeStore(path:":memory:"),device=UUID()
        var value=task("later");value=try await store.saveTask(value,expectedVersion:0,requestID:UUID().uuidString,at:now)
        let actionID=UUID().uuidString.lowercased()
        _ = try await store.applyTaskAction(nodeID:"task:later",change:.init(kind:"later",issuedAt:now,resurfaceAt:now.addingTimeInterval(3600)),expectedVersion:value.version,requestID:actionID,scope:device.uuidString.lowercased(),at:now)
        let first=CompanionSyncProjection.make(world:try await store.worldSnapshot(at:now),deviceID:device,receivedIDs:[])
        #expect(first.needsYouTotal==0 && first.laterTotal==1)
        #expect(first.tasks.first?.actionState?.lastMutationID==actionID)
        #expect(first.tasks.first?.actionState?.canUndo==true)
        let later=CompanionSyncProjection.make(world:try await store.worldSnapshot(at:now.addingTimeInterval(3601)),deviceID:device,receivedIDs:[])
        #expect(later.needsYouTotal==1 && later.laterTotal==0)
    }

    @Test func followUpProjectionRetainsParentContextWithoutChangingParent() async throws {
        let store=try KnowledgeStore(path:":memory:")
        var parent=task("waiting-parent",status:.waiting);parent.waitingReason="Fixture actor"
        var due=DueSpec();due.kind = .instant;due.instant=now.addingTimeInterval(-10);due.timeZone="UTC";parent.due=due
        _ = try await store.saveTask(parent,expectedVersion:0,requestID:UUID().uuidString,at:now.addingTimeInterval(-30))
        _ = try await store.materializeWaitingFollowUps(at:now)
        let response=CompanionSyncProjection.make(world:try await store.worldSnapshot(at:now),deviceID:UUID(),receivedIDs:[])
        let followUp=try #require(response.tasks.first(where:{$0.waitingParentNodeID != nil}))
        #expect(followUp.waitingParentNodeID=="task:waiting-parent")
        #expect(followUp.waitingParentTitle==parent.title)
        #expect(try await store.tasks().first(where:{$0.id==parent.id})?.status == .waiting)
    }

    @Test func encryptedSourcePreviewsAreBoundedAttributedAndExplicitlyUnavailable() async throws {
        let store=try KnowledgeStore(path:":memory:")
        let event=Event(id:"fixture-source",type:"message.received",source:.init(connector:"gmail",account:"fixture",externalID:"fixture",revision:"1"),occurredAt:now,subjects:["person:self"],content:"Gmail message\nSender: Fixture Sender\nSubject: Fixture subject\nBody:\n"+String(repeating:"Long fixture body ",count:2000))
        try await store.ingest(event)
        var world=try await emptyWorld(),value=task("source-task");value.evidenceIDs=[event.id,"missing-source"];world.tasks=[value]
        var response=CompanionSyncProjection.make(world:world,deviceID:UUID(),receivedIDs:[])
        try await SourceEvidenceProjection.attach(to:&response,store:store)
        let sources=try #require(response.tasks.first?.sources)
        let preview=try #require(sources.first(where:{$0.id==event.id}))
        #expect(preview.sender=="Fixture Sender" && preview.subject=="Fixture subject")
        #expect(preview.occurredAt==now && preview.truncated && preview.content.utf8.count<=4096)
        #expect(sources.first(where:{$0.id=="missing-source"})?.available==false)
        #expect(try await store.tasks().isEmpty)
        #expect(try SyncCodec.encode(response).count<256_000)
        let full=SourceEvidenceProjection.make(event,id:event.id)
        #expect(full.content==event.content && !full.truncated)
    }

    @Test func oversizedReviewedGroupIsOmittedWholeWithTotalCountPreserved() async throws {
        let store=try KnowledgeStore(path:":memory:")
        let event=Event(type:"message.received",source:.init(connector:"gmail",account:"fixture",externalID:"fixture-group-source",revision:"1"),occurredAt:now,subjects:["thread:fixture-group"],content:"Synthetic grouping source")
        try await store.ingest(event)
        var children=[ObligationGroupChild]()
        for index in 0..<100 {
            var value=task("\(index)-"+String(repeating:"x",count:240));value.title=String(repeating:"Fixture title ",count:30);value.evidenceIDs=[event.id]
            value=try await store.saveTask(value,expectedVersion:0,requestID:UUID().uuidString,at:now)
            children.append(.init(nodeID:"task:"+value.id,expectedVersion:value.version))
        }
        _ = try await store.createReviewedObligationGroup(children:children,intent:"Review forms",actor:"Fixture actor",target:"Forms",maximumSpan:3600,requestID:UUID().uuidString,at:now)
        let world=try await store.worldSnapshot(at:now)
        var response=CompanionSyncProjection.make(world:world,deviceID:UUID(),receivedIDs:[])
        try await ReviewedGroupProjection.attach(to:&response,world:world,store:store)
        #expect(response.reviewedGroupTotal==1)
        #expect(response.reviewedGroups?.isEmpty==true)
        #expect(try SyncCodec.encode(response).count<256_000)
        #expect(try await store.reviewedObligationGroups().first?.children.count==100)
    }

    @Test func snapshotOmitsPrivateSourceFieldsAndBoundsPayload() async throws {
        var world = try await emptyWorld()
        var first = task("one"); first.description = "Task details visible on Mac"; first.assignee = "Fixture person"; first.evidenceIDs = ["fixture-evidence-id"]
        var suggestion = TaskSuggestion(); suggestion.id = "detected"; suggestion.candidate = task("candidate"); suggestion.quote = "PRIVATE QUOTE"; suggestion.sourceSender = "PRIVATE SENDER"; suggestion.provider = "PRIVATE PROVIDER"
        world.tasks = [first]; world.suggestions = [suggestion]
        world.states = [try state("person:self", value: "Home"), try state("person:other", value: "PRIVATE PERSON")]
        let device = UUID(), receipt = UUID()
        let response = CompanionSyncProjection.make(world: world, deviceID: device, receivedIDs: [receipt])
        #expect(response.deviceID == device && response.receivedIDs == [receipt])
        #expect(response.states.count == 1 && response.states.first?.value == "Home")
        #expect(response.tasks.first(where:{$0.id=="task:one"})?.detail=="Task details visible on Mac")
        #expect(!String(decoding: try SyncCodec.encode(response), as: UTF8.self).contains("PRIVATE"))
        world.tasks = (0..<70).map { index in var value = task(String(index)); value.title = String(repeating: "\u{0001}", count: 2000); value.activityIDs = (0..<12).map(String.init); return value }
        world.activities = (0..<12).map { index in var a = LifeActivity(); a.id = String(index); a.name = String(repeating: "\u{0001}", count: 200); return a }
        world.states = try (0..<40).map { _ in try state("person:self", value: String(repeating: "\u{0001}", count: 2000)) }
        let bounded = CompanionSyncProjection.make(world: world, deviceID: device, receivedIDs: [])
        #expect(bounded.tasks.count <= 50 && bounded.states.count <= 32)
        #expect(bounded.tasks.allSatisfy { $0.title.utf8.count <= 512 && $0.activities.allSatisfy { $0.utf8.count <= 80 } })
        #expect(try SyncCodec.encode(bounded).count < 256_000)
    }
    @Test func activityCountsUseVisibleRootsAndOnlyRankedImportantPeopleAreIncluded() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        _ = try await store.ingestSourceSnapshot([.init(id: "quiet", name: "Quiet fixture contact", content: "Name: Quiet fixture contact")], connector: "apple_contacts", now: now)
        let sender = "active@example.test"
        try await store.ingest(Event(type: "message.received", source: .init(connector: "imessage", account: "fixture", externalID: "message", revision: "1"), occurredAt: now, subjects: ["person:self", "person:imessage:" + ConnectorSourceRecord.identifier(sender)], content: "Sender: \(sender)\nDirection: incoming\n\nPRIVATE MESSAGE BODY"))
        var world = try await store.worldSnapshot(at: now)
        var activity = LifeActivity(); activity.id = "area"; activity.name = "Fixture area"; activity.purpose = "PRIVATE PURPOSE"
        var archived = LifeActivity(); archived.id = "archived"; archived.name = "Hidden"; archived.lifecycle = .archived
        world.activities = [activity,archived]
        var task = self.task("canonical"); task.activityIDs = [activity.id]
        var alias = TaskSuggestion(); alias.id = "duplicate"; alias.candidate = task
        world.tasks = [task]; world.suggestions = [alias]
        world.taskRelations = [try relation("source:duplicate", "task:canonical")]
        let people = try await store.people(now: now)
        let response = CompanionSyncProjection.make(world: world, deviceID: UUID(), receivedIDs: [], people: people)
        #expect(response.activities.count == 1 && response.activities.first?.openTaskCount == 1)
        #expect(response.people.count == 1 && response.people.first?.name == "Recent contact")
        #expect(!String(decoding: try SyncCodec.encode(response), as: UTF8.self).contains("PRIVATE"))
    }

}
