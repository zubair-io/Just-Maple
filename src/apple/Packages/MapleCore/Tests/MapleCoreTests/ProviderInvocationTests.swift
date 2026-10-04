import Foundation
import Testing
@testable import MapleCore

struct ProviderInvocationTests {
    private func source(_ id:String)->Event {Event(id:id,type:"mail.received",source:Source(connector:"gmail",account:"fixture",externalID:id,revision:"1"),occurredAt:Date(timeIntervalSince1970:1_790_745_000),subjects:["fixture:self"],content:"Synthetic capture fixture only.")}
    private func audit(_ kind:String,_ payload:String="",id:String="call",parent:String?=nil,dispatch:ProviderDispatchCapture?=nil)->ProviderAuditEvent {
        ProviderAuditEvent(invocationID:id,parentInvocationID:parent,provider:"fixture",model:"fixture-only",kind:kind,payload:payload,dispatch:dispatch)
    }
    @Test func dispatchIsDurableImmutableAndRetrySafe()async throws {
        let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString);defer{try? FileManager.default.removeItem(at:root)}
        let store=try KnowledgeStore(path:root.appendingPathComponent("core.sqlite").path),event=source("evidence")
        try await store.ingest(event)
        try await store.recordPipelineProviderAudit(audit("context","exact fixture prompt"),jobID:"job",attemptID:"attempt",stage:"fixture")
        let dispatch=ProviderDispatchCapture(attemptedAt:event.receivedAt,evidence:[.init(eventID:event.id),.init(eventID:event.id,occurredAt:event.occurredAt)])
        let captured=audit("dispatch",dispatch:dispatch)
        try await store.recordPipelineProviderAudit(captured,jobID:"job",attemptID:"attempt",stage:"fixture")
        try await store.recordPipelineProviderAudit(captured,jobID:"job",attemptID:"attempt",stage:"fixture")
        let reopened=try KnowledgeStore(path:root.appendingPathComponent("core.sqlite").path)
        let rows=try await reopened.invocationTestRows("SELECT * FROM provider_invocations")
        let row=try #require(rows.first),json=try #require(row["dispatch_json"])
        let saved=try JSONCodec.decode(ProviderDispatchCapture.self,from:Data(json.utf8))
        #expect(saved.coverage == .complete && saved.evidence == [.init(eventID:event.id,occurredAt:event.occurredAt)])
        #expect(try await reopened.invocationTestRows("SELECT kind FROM provider_invocation_events").map{$0["kind"]!} == ["context","dispatch"])
        #expect(row["context_sha256"] == KnowledgeStore.captureHash(Data("exact fixture prompt".utf8)))
        await #expect(throws:Error.self){try await store.recordPipelineProviderAudit(audit("context","changed"),jobID:"job",attemptID:"attempt",stage:"fixture")}
        await #expect(throws:Error.self){try await store.recordPipelineProviderAudit(audit("dispatch",dispatch:.init(attemptedAt:event.receivedAt.addingTimeInterval(1),evidence:[])),jobID:"job",attemptID:"attempt",stage:"fixture")}
    }
    @Test func incompleteAndLegacyInputsNeverGainCoverage()async throws {
        let store=try KnowledgeStore(path:":memory:")
        try await store.recordPipelineProviderAudit(audit("response","legacy fixture"),jobID:"legacy",attemptID:"legacy",stage:"fixture")
        #expect(try await store.invocationTestRows("SELECT dispatch_json FROM provider_invocations").first?["dispatch_json"] == nil)
        await #expect(throws:Error.self){try await store.recordPipelineProviderAudit(audit("dispatch",dispatch:.init(evidence:[])),jobID:"new",attemptID:"no-context",stage:"fixture")}
        #expect(try await store.invocationTestRows("SELECT id FROM provider_invocations WHERE attempt_id='no-context'").isEmpty)
        try await store.recordPipelineProviderAudit(audit("context","synthetic missing reference"),jobID:"job",attemptID:"attempt",stage:"fixture")
        try await store.recordPipelineProviderAudit(audit("dispatch",dispatch:.init(evidence:[.init(eventID:"missing")])),jobID:"job",attemptID:"attempt",stage:"fixture")
        let json=try #require(try await store.invocationTestRows("SELECT dispatch_json FROM provider_invocations WHERE attempt_id='attempt'").first?["dispatch_json"])
        #expect(try JSONCodec.decode(ProviderDispatchCapture.self,from:Data(json.utf8)).coverage == .partial)
    }
    @Test func sourceAuditAndLedgerFailAtomicallyAndRejectFalseEvidenceDates()async throws {
        let store=try KnowledgeStore(path:":memory:"),event=source("event");try await store.ingest(event)
        try await store.recordProviderAudit(audit("context","fixture"),eventID:event.id,leaseID:"lease",stage:"classification")
        await #expect(throws:Error.self){try await store.recordProviderAudit(audit("dispatch",dispatch:.init(evidence:[.init(eventID:event.id,occurredAt:event.occurredAt.addingTimeInterval(99))])),eventID:event.id,leaseID:"lease",stage:"classification")}
        #expect(try await store.invocationTestRows("SELECT id FROM source_artifacts WHERE kind='dispatch'").isEmpty)
        #expect(try await store.invocationTestRows("SELECT dispatch_json FROM provider_invocations").first?["dispatch_json"] == nil)
        try await store.invocationTestFailWrites()
        await #expect(throws:Error.self){try await store.recordProviderAudit(audit("response","must roll back"),eventID:event.id,leaseID:"lease",stage:"classification")}
        #expect(try await store.invocationTestRows("SELECT id FROM source_artifacts WHERE kind='response'").isEmpty)
    }
}
extension KnowledgeStore {
    fileprivate func invocationTestRows(_ sql:String)throws->[[String:String]] {try db.rows(sql)}
    fileprivate func invocationTestFailWrites()throws {try db.execute("CREATE TRIGGER fixture_audit_failure BEFORE INSERT ON provider_invocation_events BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END")}
}
