import Foundation
import Testing
@testable import MapleCore

struct TaskExtractionRetryTests {
    @Test func safeCategoriesNeverPersistUnknownProviderBodies() {
        #expect(TaskExtractionFailure.classify(MapleError.provider("Provider returned unsupported task evidence.")).code=="model_contract")
        #expect(!TaskExtractionFailure.classify(MapleError.provider("Provider returned unsupported task evidence.")).retryable)
        #expect(TaskExtractionFailure.classify(URLError(.timedOut)).retryable)
        let unknown=TaskExtractionFailure.classify(MapleError.provider("SECRET BODY https://private.invalid TOKEN"))
        #expect(!unknown.message.contains("SECRET"));#expect(!unknown.retryable)
        #expect(!TaskExtractionFailure.classify(MapleError.provider("Provider process failed or timed out. Check its local installation and retry.")).retryable)
    }
    @Test func transientBackoffCapAndDuplicateFailureAreDurable() async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
        defer {try? FileManager.default.removeItem(at:root)}
        let path=root.appendingPathComponent("fixture.sqlite").path
        let store=try KnowledgeStore(path:path),now=Date()
        let event=Event(type:"message.received",source:Source(connector:"gmail",account:"fixture",externalID:"retry",revision:"1"),occurredAt:now,subjects:["person:self"],content:"Synthetic request")
        try await store.ingest(event);try await store.requestTaskExtraction(eventID:event.id)
        let (_,first)=try #require(await store.acquireTaskExtraction(at:now))
        try await store.failTaskExtraction(eventID:event.id,token:first,error:URLError(.timedOut),at:now)
        try await store.failTaskExtraction(eventID:event.id,token:first,error:URLError(.timedOut),at:now.addingTimeInterval(20))
        let nextAttempt=try #require(await store.taskExtractionQueue().first?.nextAttemptAt)
        #expect(abs(nextAttempt.timeIntervalSince(now.addingTimeInterval(60)))<0.000001)
        let reopened=try KnowledgeStore(path:path)
        #expect(try await reopened.acquireTaskExtraction(at:now.addingTimeInterval(59))==nil)
        let (_,second)=try #require(await reopened.acquireTaskExtraction(at:now.addingTimeInterval(60)))
        try await reopened.failTaskExtraction(eventID:event.id,token:second,error:URLError(.networkConnectionLost),at:now.addingTimeInterval(60))
        #expect(try await reopened.acquireTaskExtraction(at:now.addingTimeInterval(179))==nil)
        let (_,third)=try #require(await reopened.acquireTaskExtraction(at:now.addingTimeInterval(180)))
        try await reopened.failTaskExtraction(eventID:event.id,token:third,error:URLError(.timedOut),at:now.addingTimeInterval(180))
        #expect(try await reopened.taskExtractionQueue().first?.status=="failed")
        #expect(try await reopened.taskExtractionQueue().first?.attempts==3)
        #expect(try await reopened.acquireTaskExtraction(at:now.addingTimeInterval(1000))==nil)
        try await reopened.retryLocalIntelligence()
        try await reopened.retryLocalIntelligence()
        let (_,manual)=try #require(await reopened.acquireTaskExtraction(at:now.addingTimeInterval(1001)))
        try await reopened.failTaskExtraction(eventID:event.id,token:manual,error:MapleError.provider("Provider returned unsupported task evidence."),at:now.addingTimeInterval(1001))
        #expect(try await reopened.taskExtractionQueue().first?.status=="failed")
        #expect(try await reopened.acquireTaskExtraction(at:now.addingTimeInterval(2000))==nil)
    }
    @Test func additiveMigrationPreservesExistingFailure() throws {
        let db=try SQLite(path:":memory:")
        try db.execute("CREATE TABLE task_extraction_jobs(event_id TEXT,status TEXT,attempts INTEGER,error TEXT,lease_token TEXT,lease_until REAL)")
        try db.execute("INSERT INTO task_extraction_jobs VALUES('fixture','failed',1,'legacy generic',NULL,NULL)")
        try db.migrateTaskExtractionRetries();try db.migrateTaskExtractionRetries()
        let row=try #require(db.rows("SELECT * FROM task_extraction_jobs").first)
        #expect(row["status"]=="failed");#expect(row["error"]=="legacy generic");#expect(row["next_attempt_at"]=="0.0")
    }
}
