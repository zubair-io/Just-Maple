import Foundation
import Testing
@testable import MapleCore
struct ActivityDiscoveryTests {
    func seed(_ store:KnowledgeStore,_ key:String,_ quote:String,at:Date=Date(),activityIDs:[String]=[])async throws->TaskSuggestion {
        let event=Event(type:"message.received",source:Source(connector:"gmail",account:"fixture",externalID:key,revision:"1"),occurredAt:at,subjects:["person:self"],content:quote)
        try await store.ingest(event)
        var s=TaskSuggestion();s.eventID=event.id;s.provider="fixture";s.quote=quote;s.candidate.title="Fixture action: "+key;s.candidate.activityIDs=activityIDs
        return try await store.offerTask(s)
    }
    @Test func discoveryIsGroundedAtomicAndRemovalBlocksSameEvidence()async throws {
        let store=try KnowledgeStore(path:":memory:"),at=Date()
        let a=try await seed(store,"form","Send the enrollment form.")
        let b=try await seed(store,"visit","Choose an orientation date.")
        let job=try #require(try await store.acquireActivityDiscovery(at:at))
        #expect(try await store.acquireActivityDiscovery(at:at)==nil)
        let response=try JSONCodec.string(ActivityDiscoveryOutput(activities:[DiscoveredActivity(name:"Fixture enrollment",purpose:"Complete enrollment",kind:.pursuit,reason:"Two independent enrollment steps",suggestionIDs:[a.id,b.id])]))
        try await store.finishActivityDiscovery(job,response:response,at:at)
        #expect(try await store.activities().count==1)
        #expect(try await store.worldSnapshot().suggestions.allSatisfy{$0.candidate.activityIDs.count==1})
        await #expect(throws:Error.self){try await store.finishActivityDiscovery(job,response:response,at:at)}
        let activity=try #require(try await store.activities().first)
        _ = try await store.removeActivity(id:activity.id,expectedVersion:activity.version,requestID:"remove",at:at)
        // The exact original input is already completed; it must not run again.
        #expect(try await store.acquireActivityDiscovery(at:at.addingTimeInterval(301))==nil)
        #expect(try await store.activities().isEmpty)
        #expect(try await store.worldSnapshot().suggestions.count==2)
        _ = try await seed(store,"unrelated","An unrelated new request.")
        let later=at.addingTimeInterval(301)
        let retry=try #require(try await store.acquireActivityDiscovery(at:later))
        try await store.finishActivityDiscovery(retry,response:response,at:later)
        #expect(try await store.activities().isEmpty)
    }
    @Test func singleSourceOldSourcesAndDuplicateQuotesDoNotEstablishActivities()async throws {
        let store=try KnowledgeStore(path:":memory:"),at=Date()
        let a=try await seed(store,"a","Repeated quoted request.")
        _ = try await seed(store,"old","Old action.",at:at.addingTimeInterval(-31*86400))
        #expect(try await store.acquireActivityDiscovery(at:at)==nil)
        let b=try await seed(store,"b","Repeated quoted request.")
        let job=try #require(try await store.acquireActivityDiscovery(at:at))
        #expect(job.input.evidence.count==2)
        let response=try JSONCodec.string(ActivityDiscoveryOutput(activities:[DiscoveredActivity(name:"Invalid duplicate group",purpose:"Fixture",kind:.area,reason:"Fixture",suggestionIDs:[a.id,b.id])]))
        await #expect(throws:Error.self){try await store.finishActivityDiscovery(job,response:response,at:at)}
        #expect(try await store.activities().isEmpty)
    }
    @Test func concurrentCorrectionInvalidatesModelOutput()async throws {
        let store=try KnowledgeStore(path:":memory:"),at=Date()
        _ = try await seed(store,"a","First request.");_ = try await seed(store,"b","Second request.")
        let job=try #require(try await store.acquireActivityDiscovery(at:at))
        var activity=LifeActivity();activity.name="User-defined scope"
        _ = try await store.saveActivity(activity,expectedVersion:0,requestID:"correction",at:at)
        await #expect(throws:Error.self){try await store.finishActivityDiscovery(job,response:"{\"activities\":[]}",at:at)}
        #expect(try await store.activities().count==1)
    }
}
struct DeadlineContractTests {
    @Test func resolvedDatesRequireSourceDeadlineAndValidCalendarDate()throws {
        let event=Event(type:"message.received",source:Source(connector:"gmail",account:"fixture",externalID:"deadline",revision:"1"),occurredAt:Date(),subjects:["person:self"],content:"Return the form by September 30.")
        let valid=#"{"tasks":[{"title":"Return the enrollment form","details":"Return the form","quote":"Return the form by September 30.","deadline":"September 30","dueDate":"2026-09-30","activityIDs":[]}]}"#
        #expect(try ACPExtractor.tasks(valid,event:event,activities:[],provider:"fixture").first?.candidate.due?.date=="2026-09-30")
        #expect(throws:Error.self){try ACPExtractor.tasks(valid.replacingOccurrences(of:"2026-09-30",with:"2026-02-30"),event:event,activities:[],provider:"fixture")}
        #expect(throws:Error.self){try ACPExtractor.tasks(valid.replacingOccurrences(of:#""deadline":"September 30""#,with:#""deadline":"""#),event:event,activities:[],provider:"fixture")}
    }
}
struct ActivityRegroupingTests {
    @Test func splitAndMergePreserveEvidenceAndBlockOldMembership()async throws {
        let store=try KnowledgeStore(path:":memory:")
        var source=LifeActivity();source.name="Fixture course planning"
        source=try await store.saveActivity(source,expectedVersion:0,requestID:"source")
        let original=try await ActivityDiscoveryTests().seed(store,"a","Choose a course time.",activityIDs:[source.id])
        // Explicit task capture exercises canonical movement as well as pending evidence.
        var task=LifeTask();task.title="Prepare course materials";task.activityIDs=[source.id];task.evidenceIDs=[original.eventID]
        task=try await store.saveTask(task,expectedVersion:0,requestID:"task")
        var target=LifeActivity();target.name="Fixture materials"
        let rev=try await store.worldSnapshot().revision
        _ = try await store.regroupActivity(sourceID:source.id,target:target,selectedIDs:[task.id,original.id],merge:false,expectedRevision:rev,requestID:"split")
        _ = try await store.regroupActivity(sourceID:source.id,target:target,selectedIDs:[task.id,original.id],merge:false,expectedRevision:rev,requestID:"split")
        #expect(try await store.tasks().first?.activityIDs==[target.id])
        #expect(try await store.tasks().first?.evidenceIDs==[original.eventID])
        #expect(try await store.worldSnapshot().suggestions.first?.candidate.activityIDs==[target.id])
        #expect(try await store.worldSnapshot().activityEvidence.first?.reason=="You moved this task to this activity.")
        target=try #require(try await store.activities().first{$0.id==target.id})
        let rev2=try await store.worldSnapshot().revision
        _ = try await store.regroupActivity(sourceID:source.id,target:target,selectedIDs:[],merge:true,expectedRevision:rev2,requestID:"merge")
        #expect(try await store.activities().first{$0.id==source.id}?.lifecycle == .archived)
        await #expect(throws:Error.self){try await store.regroupActivity(sourceID:target.id,target:source,selectedIDs:[],merge:true,expectedRevision:rev2,requestID:"stale")}
    }
}

struct ObservationActivityDiscoveryTests {
    func source(_ store:KnowledgeStore,_ key:String,connector:String="notes",text:String,at:Date,revision:String="1",receivedAt:Date?=nil)async throws->Event {
        let e=Event(type:"observation.updated",source:Source(connector:connector,account:"fixture",externalID:key,revision:revision),occurredAt:at,receivedAt:receivedAt ?? at,subjects:["person:self"],content:text)
        try await store.ingest(e);return e
    }
    func response(_ job:ActivityDiscoveryJob)->String {
        try! JSONCodec.string(ActivityDiscoveryOutput(activities:[DiscoveredActivity(name:"Fixture community garden",purpose:"Organize the community garden",kind:.pursuit,reason:"The note and calendar describe the same ongoing garden project.",suggestionIDs:job.input.evidence.map(\.suggestionID))]))
    }
    @Test func discoversWithoutTasksRetainsProofAndRemovalSurvivesTaskExtraction()async throws {
        let store=try KnowledgeStore(path:":memory:"),at=Date()
        let a=try await source(store,"note",connector:"imessage",text:"Community garden planning: raised beds and spring planting.",at:at)
        let b=try await source(store,"meeting",connector:"apple_calendar",text:"Community garden planning meeting: design the raised beds.",at:at)
        let job=try #require(try await store.acquireActivityDiscovery(at:at))
        #expect(job.input.evidence.allSatisfy{$0.kind=="observation"})
        try await store.finishActivityDiscovery(job,response:response(job),at:at)
        let snapshot=try await store.worldSnapshot()
        #expect(snapshot.tasks.isEmpty && snapshot.suggestions.isEmpty)
        #expect(snapshot.activityEvidence.count==2)
        #expect(Set(snapshot.activityEvidence.compactMap(\.quote))==Set([a.content,b.content]))
        let activity=try #require(snapshot.activities.first)
        _ = try await store.removeActivity(id:activity.id,expectedVersion:activity.version,requestID:"remove-observation-activity",at:at)
        for event in [a,b] {
            var s=TaskSuggestion();s.eventID=event.id;s.quote=event.content;s.provider="fixture";s.candidate.title="Fixture inferred task"
            _ = try await store.offerTask(s)
        }
        let later=at.addingTimeInterval(301)
        let retry=try #require(try await store.acquireActivityDiscovery(at:later))
        try await store.finishActivityDiscovery(retry,response:response(retry),at:later)
        #expect(try await store.activities().isEmpty)
    }
    @Test func filtersOldAndSupersededSourcesAndRejectsConcurrentRevision()async throws {
        let store=try KnowledgeStore(path:":memory:"),at=Date()
        _ = try await source(store,"old",connector:"resume",text:"Old resume fixture",at:at.addingTimeInterval(-31*86400))
        _ = try await source(store,"poll",connector:"home_assistant",text:"Light on",at:at)
        _ = try await source(store,"note",text:"First draft",at:at)
        let latest=try await source(store,"note",text:"Latest garden plan",at:at,revision:"2",receivedAt:at.addingTimeInterval(1))
        _ = try await source(store,"meeting",connector:"google_calendar",text:"Garden planning discussion",at:at)
        let job=try #require(try await store.acquireActivityDiscovery(at:at))
        #expect(job.input.evidence.count==2)
        #expect(job.input.evidence.contains{$0.eventID==latest.id})
        _ = try await source(store,"note",text:"Changed garden plan",at:at,revision:"3",receivedAt:at.addingTimeInterval(2))
        await #expect(throws:Error.self){try await store.finishActivityDiscovery(job,response:response(job),at:at)}
        #expect(try await store.activities().isEmpty)
        #expect(try await store.discoverySeenCount()==0)
    }
    @Test func successfulBatchesAdvanceButFailedBatchesDoNotConsumeEvidence()async throws {
        let store=try KnowledgeStore(path:":memory:"),at=Date()
        for i in 0..<36 {_ = try await source(store,String(i),text:"Fixture observation number \(i)",at:at.addingTimeInterval(Double(i-40)))}
        let first=try #require(try await store.acquireActivityDiscovery(at:at))
        try await store.failActivityDiscovery(first)
        #expect(try await store.discoverySeenCount()==0)
        try await store.retryActivityDiscovery()
        let retry=try #require(try await store.acquireActivityDiscovery(at:at))
        #expect(retry.id==first.id)
        try await store.finishActivityDiscovery(retry,response:"{\"activities\":[]}",at:at)
        let second=try #require(try await store.acquireActivityDiscovery(at:at.addingTimeInterval(301)))
        let firstIDs=Set(first.input.evidence.map(\.eventID))
        #expect(second.input.evidence.contains{!firstIDs.contains($0.eventID)})
        #expect(second.input.evidence.count<=40)
    }
    @Test func mergeMovesObservationEvidenceWithoutCreatingTasks()async throws {
        let store=try KnowledgeStore(path:":memory:"),at=Date()
        _ = try await source(store,"note",text:"Community garden plot design",at:at)
        _ = try await source(store,"meeting",connector:"imessage",text:"Community garden planting group meets weekly",at:at)
        let job=try #require(try await store.acquireActivityDiscovery(at:at))
        try await store.finishActivityDiscovery(job,response:response(job),at:at)
        let before=try await store.worldSnapshot(),activity=try #require(before.activities.first)
        var target=LifeActivity();target.name="User garden scope"
        _ = try await store.regroupActivity(sourceID:activity.id,target:target,selectedIDs:[],merge:true,expectedRevision:before.revision,requestID:"merge-sources",at:at)
        let after=try await store.worldSnapshot()
        #expect(after.activityEvidence.count==2)
        #expect(after.activityEvidence.allSatisfy{$0.activityID==target.id})
        #expect(after.tasks.isEmpty && after.suggestions.isEmpty)
    }
}

extension KnowledgeStore {
    func discoverySeenCount()throws->Int {try db.rows("SELECT event_id FROM activity_discovery_seen").count}
}

struct ActivityProviderContractTests {
    @Test func repairsInvalidReferenceThroughProviderAndStillValidatesEvidence()async throws {
        let directory=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
        defer {try? FileManager.default.removeItem(at:directory)}
        let runner=directory.appendingPathComponent("fixture-runner.cjs")
        let script="""
        let data='';process.stdin.on('data',d=>data+=d);process.stdin.on('end',()=>{
          const prompt=JSON.parse(data).prompt;
          const input=JSON.parse(prompt.split('INPUT:\\n')[1].split('\\nYour previous response')[0]);
          const repairing=prompt.includes('Your previous response violated');
          const output={activities:[{activityID:repairing?input.activities[0].id:'invented-reference',name:'Synthetic garden',purpose:'Fixture garden planning',kind:'pursuit',reason:'Two independent planning sources',suggestionIDs:input.evidence.map(e=>e.suggestionID)}]};
          process.stdout.write(JSON.stringify({ok:true,text:JSON.stringify(output)}));
        });
        """
        try script.write(to:runner,atomically:true,encoding:.utf8)
        let store=try KnowledgeStore(path:":memory:"),at=Date(),helper=ObservationActivityDiscoveryTests()
        _ = try await helper.source(store,"a",text:"Fixture garden layout planning",at:at)
        _ = try await helper.source(store,"b",text:"Fixture garden planting schedule",at:at)
        var existing=LifeActivity();existing.id="user-garden-with-long-stable-database-identifier";existing.name="User garden scope"
        _ = try await store.saveActivity(existing,expectedVersion:0,requestID:"fixture-scope",at:at)
        try await ActivityDiscoveryEngine(store:store,client:ACPClient(provider:"codex",runner:runner)).runOne()
        #expect(try await store.activities().count==1)
        #expect(try await store.activities().first?.name=="User garden scope")
        #expect(try await store.worldSnapshot().activityEvidence.allSatisfy{$0.activityID==existing.id})
        #expect(try await store.discoverySeenCount()==2)
    }
}
