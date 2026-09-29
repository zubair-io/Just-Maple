import Foundation

/// A provider invocation's actual input/output, never an inferred reconstruction.
public struct ProviderAuditEvent:Sendable {
    public let invocationID:String,parentInvocationID:String?,provider:String,model:String,kind:String,payload:String
    public init(invocationID:String,parentInvocationID:String?=nil,provider:String,model:String,kind:String,payload:String) {self.invocationID=invocationID;self.parentInvocationID=parentInvocationID;self.provider=provider;self.model=model;self.kind=kind;self.payload=payload}
}
public typealias ProviderAuditSink = @Sendable (ProviderAuditEvent) async throws -> Void

extension FactExtractor {
    public func extractAudited(_ event:Event,audit:@escaping ProviderAuditSink)async throws -> FactExtractionResult {try await extract(event)}
}
extension TaskCandidateExtractor {
    public func extractAudited(_ context:Context,activities:[LifeActivity],audit:@escaping ProviderAuditSink)async throws -> [TaskSuggestion] {try await extract(context,activities:activities)}
}
extension KnowledgeStore {
    func recordProviderSkip(eventID:String,attemptID:String,stage:String,reason:String)throws {
        try db.execute("INSERT INTO source_transitions(event_id,stage,to_state,attempt_id,reason,at) VALUES (?,?,'provider_skipped',?,?,?)",[eventID,stage,attemptID,reason,String(Date().timeIntervalSince1970)])
    }
    func recordProviderAudit(_ event:ProviderAuditEvent,eventID:String,leaseID:String,stage:String)throws {
        try db.transaction {
            let child=leaseID+":"+event.invocationID
            try db.execute("INSERT OR IGNORE INTO source_attempts(id,event_id,stage,started_at,provider,model,parent_id) VALUES (?,?,?,?,?,?,?)",[child,eventID,stage,String(Date().timeIntervalSince1970),event.provider,event.model,event.parentInvocationID.map{leaseID+":"+$0} ?? leaseID])
            try recordSourceArtifact(eventID:eventID,attemptID:child,stage:stage,kind:event.kind,payload:event.payload,provider:event.provider,model:event.model)
            if event.kind=="validation" {try db.execute("UPDATE source_attempts SET ended_at=?,commit_outcome=? WHERE id=?",[String(Date().timeIntervalSince1970),event.payload,child])}
        }
    }
}

extension Classifier {
    public func classifyAudited(_ context:Context,audit:@escaping ProviderAuditSink)async throws -> ClassifierResult {try await classify(context)}
}

extension KnowledgeStore {
    /// Manual classifier checks use the same audit boundary as queued classification.
    public func checkSourceFacts(eventID:String,classifier:any FactCheckingClassifier)async throws -> (probability:Double,model:String,rawResponse:Data) {
        if classifier.providerID == "typesafe", let pause = try providerPause("typesafe") { throw MapleError.provider(pause.reason) }
        let context=try modelContext(for:eventID),attempt=UUID().uuidString
        try db.transaction {
            try db.execute("INSERT INTO source_attempts(id,event_id,stage,started_at,provider) VALUES (?,?,'fact_check',?,?)",[attempt,eventID,String(Date().timeIntervalSince1970),classifier.providerID])
            try db.execute("INSERT INTO source_transitions(event_id,stage,to_state,attempt_id,reason,at) VALUES (?,'fact_check','running',?,'user_requested_check',?)",[eventID,attempt,String(Date().timeIntervalSince1970)])
        }
        do {
            let result=try await classifier.checkFacts(context) { audit in try await self.recordProviderAudit(audit,eventID:eventID,leaseID:attempt,stage:"fact_check") }
            try db.transaction {
                try insertFactCheck(eventID:eventID,probability:result.probability,provider:classifier.providerID,model:result.model,now:Date(),context:context,rawResponse:String(decoding:result.rawResponse,as:UTF8.self))
                try db.execute("UPDATE source_attempts SET ended_at=?,commit_outcome='committed' WHERE id=? OR parent_id=?",[String(Date().timeIntervalSince1970),attempt,attempt])
                try db.execute("INSERT INTO source_transitions(event_id,stage,from_state,to_state,attempt_id,reason,at) VALUES (?,'fact_check','running','succeeded',?,'assessment_recorded',?)",[eventID,attempt,String(Date().timeIntervalSince1970)])
            }
            return result
        } catch {
            if let failure = error as? JevProviderError { try pauseJev(after: failure) }
            try db.transaction {
                try db.execute("UPDATE source_attempts SET ended_at=?,commit_outcome='failed' WHERE id=? OR parent_id=?",[String(Date().timeIntervalSince1970),attempt,attempt])
                try db.execute("INSERT INTO source_transitions(event_id,stage,from_state,to_state,attempt_id,reason,at) VALUES (?,'fact_check','running','failed',?,'provider_or_validation_failed',?)",[eventID,attempt,String(Date().timeIntervalSince1970)])
            }
            throw error
        }
    }
}
