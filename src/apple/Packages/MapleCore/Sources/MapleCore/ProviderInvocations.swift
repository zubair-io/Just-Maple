import Foundation
import CryptoKit

public enum ProviderEvidenceCoverage:String,Codable,Sendable { case complete,partial,unknown }
public struct ProviderInputEvidence:Codable,Sendable,Equatable {
    public let eventID:String
    public let occurredAt:Date?
    public init(eventID:String,occurredAt:Date?=nil) {self.eventID=eventID;self.occurredAt=occurredAt}
}
/// A durable dispatch intent, not proof the remote service received a request.
/// A crash immediately after persistence leaves the transport outcome unknown.
public struct ProviderDispatchCapture:Codable,Sendable,Equatable {
    public let attemptedAt:Date
    public let evidence:[ProviderInputEvidence]
    public let coverage:ProviderEvidenceCoverage
    public init(attemptedAt:Date=Date(),evidence:[ProviderInputEvidence],coverage:ProviderEvidenceCoverage = .complete) {
        self.attemptedAt=attemptedAt;self.evidence=evidence;self.coverage=coverage
    }
}

extension SQLite {
    func migrateProviderInvocations()throws {
        try transaction {
            try execute("CREATE TABLE IF NOT EXISTS provider_capture_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
            // This is a schema cutover, deliberately NOT an assertion that every pipeline has coverage.
            try execute("INSERT OR IGNORE INTO provider_capture_metadata VALUES ('schema_started_at',?)",[String(Date().timeIntervalSince1970)])
            try execute("""
                CREATE TABLE IF NOT EXISTS provider_invocations(
                  id TEXT PRIMARY KEY,job_id TEXT NOT NULL,attempt_id TEXT NOT NULL,invocation_id TEXT NOT NULL,
                  parent_id TEXT,stage TEXT NOT NULL,event_id TEXT,provider TEXT NOT NULL,model TEXT NOT NULL,
                  context_sha256 TEXT,dispatch_json TEXT,recorded_at REAL NOT NULL)
                """)
            try execute("CREATE INDEX IF NOT EXISTS provider_invocations_attempt ON provider_invocations(attempt_id,recorded_at)")
            try execute("""
                CREATE TABLE IF NOT EXISTS provider_invocation_events(
                  sequence INTEGER PRIMARY KEY AUTOINCREMENT,invocation_id TEXT NOT NULL REFERENCES provider_invocations(id),
                  kind TEXT NOT NULL,payload_sha256 TEXT NOT NULL,payload TEXT,availability TEXT NOT NULL,recorded_at REAL NOT NULL)
                """)
            try execute("CREATE INDEX IF NOT EXISTS provider_invocation_events_invocation ON provider_invocation_events(invocation_id,sequence)")
        }
    }
}

extension KnowledgeStore {
    public func recordPipelineProviderAudit(_ event:ProviderAuditEvent,jobID:String,attemptID:String,stage:String)throws {
        try db.transaction {try appendProviderInvocation(event,jobID:jobID,attemptID:attemptID,stage:stage,eventID:nil)}
    }
    /// Called in the same transaction as source-attempt artifacts, or the pipeline audit transaction.
    func appendProviderInvocation(_ audit:ProviderAuditEvent,jobID:String,attemptID:String,stage:String,eventID:String?)throws {
        let fields=[jobID,attemptID,audit.invocationID,stage,audit.provider,audit.model,audit.kind]
        guard fields.allSatisfy({!$0.isEmpty && $0.utf8.count<=1024}),
              audit.parentInvocationID.map({!$0.isEmpty && $0.utf8.count<=1024 && $0 != audit.invocationID}) ?? true,
              audit.kind == "dispatch" ? audit.dispatch != nil : audit.dispatch == nil else {
            throw MapleError.invalid("Invalid provider audit identity or dispatch.")
        }
        let id=attemptID+":"+audit.invocationID,parent=audit.parentInvocationID.map{attemptID+":"+$0}
        let old=try db.rows("SELECT * FROM provider_invocations WHERE id=?",[id]).first
        if let old {
            guard old["job_id"]==jobID,old["attempt_id"]==attemptID,old["stage"]==stage,old["event_id"]==eventID,
                  old["provider"]==audit.provider,old["model"]==audit.model,old["parent_id"]==parent else {
                throw MapleError.invalid("Provider invocation identity was reused.")
            }
        } else {
            if let parent {guard try db.rows("SELECT id FROM provider_invocations WHERE id=? AND job_id=? AND stage=?",[parent,jobID,stage]).first != nil else {throw MapleError.invalid("Provider repair parent is missing.")}}
            try db.execute("INSERT INTO provider_invocations(id,job_id,attempt_id,invocation_id,parent_id,stage,event_id,provider,model,recorded_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                           [id,jobID,attemptID,audit.invocationID,parent,stage,eventID,audit.provider,audit.model,String(Date().timeIntervalSince1970)])
        }
        var payload=audit.payload
        if let dispatch=audit.dispatch {
            guard dispatch.attemptedAt.timeIntervalSince1970.isFinite,dispatch.evidence.count<=50000,
                  let context=old?["context_sha256"],!context.isEmpty else {throw MapleError.invalid("Dispatch requires its durable input context.")}
            var byID=[String:ProviderInputEvidence](),coverage=dispatch.coverage
            if try db.rows("SELECT sequence FROM provider_invocation_events WHERE invocation_id=? AND kind='context' AND availability='available' LIMIT 1",[id]).isEmpty {
                coverage = coverage == .unknown ? .unknown:.partial
            }
            for evidence in dispatch.evidence {
                guard !evidence.eventID.isEmpty,evidence.eventID.utf8.count<=1024,evidence.occurredAt?.timeIntervalSince1970.isFinite ?? true else {throw MapleError.invalid("Invalid dispatch evidence.")}
                let stored=try event(evidence.eventID)?.occurredAt
                if let supplied=evidence.occurredAt,let stored,abs(supplied.timeIntervalSince1970-stored.timeIntervalSince1970)>0.000001 {throw MapleError.invalid("Dispatch evidence time disagrees with immutable source.")}
                let resolved=ProviderInputEvidence(eventID:evidence.eventID,occurredAt:evidence.occurredAt ?? stored)
                if let previous=byID[evidence.eventID],previous != resolved {throw MapleError.invalid("Conflicting dispatch evidence times.")}
                byID[evidence.eventID]=resolved
                if resolved.occurredAt == nil {coverage = coverage == .unknown ? .unknown:.partial}
            }
            let normalized=ProviderDispatchCapture(attemptedAt:dispatch.attemptedAt,evidence:byID.values.sorted{$0.eventID<$1.eventID},coverage:coverage)
            payload=try JSONCodec.string(normalized)
            if let prior=old?["dispatch_json"] {
                guard prior==payload else {throw MapleError.invalid("Provider dispatch identity was reused.")}
                return // Exact duplicate audit acknowledgement, not a second network request.
            }
            try db.execute("UPDATE provider_invocations SET dispatch_json=? WHERE id=?",[payload,id])
        }
        let hash=SHA256.hash(data:Data(payload.utf8)).map{String(format:"%02x",$0)}.joined()
        if audit.kind=="context" {
            if let prior=old?["context_sha256"] {
                guard prior==hash else {throw MapleError.invalid("Provider input context changed within an invocation.")}
                return
            }
            guard old?["dispatch_json"] == nil else {throw MapleError.invalid("Provider input must precede dispatch.")}
            try db.execute("UPDATE provider_invocations SET context_sha256=? WHERE id=?",[hash,id])
        }
        let retained=payload.utf8.count<=8*1024*1024
        try db.execute("INSERT INTO provider_invocation_events(invocation_id,kind,payload_sha256,payload,availability,recorded_at) VALUES (?,?,?,?,?,?)",
                       [id,audit.kind,hash,retained ? payload:nil,retained ? "available":"not_recorded_size_limit",String(Date().timeIntervalSince1970)])
    }
}
