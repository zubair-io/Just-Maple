import CryptoKit
import Foundation

/// A statement asserted by a source, not an independently verified fact.
public struct SourceFact: Codable, Sendable, Equatable {
    public let id: String
    public let subject: String
    public let predicate: String
    public let value: String
    public let sourceQuote: String
    public let eventID: String
    public let provider: String
    public let model: String
    public let extractedAt: Date
    public var sourceOccurredAt: Date? = nil
}

public struct FactCandidate: Codable, Sendable {
    public let subject: String
    public let predicate: String
    public let value: String
    public let sourceQuote: String
    public init(subject: String, predicate: String, value: String, sourceQuote: String) {
        self.subject = subject; self.predicate = predicate; self.value = value; self.sourceQuote = sourceQuote
    }
}

public struct FactCheck: Codable, Sendable {
    public let eventID: String
    public let probability: Double
    public let provider: String
    public let model: String
    public let checkedAt: Date
    public var context: Context? = nil
    public var rawResponse: String? = nil
}

public struct FactExtractionResult: Sendable {
    public let candidates: [FactCandidate]
    public let provider: String
    public let model: String
    public init(candidates: [FactCandidate], provider: String, model: String) {
        self.candidates = candidates; self.provider = provider; self.model = model
    }
}

public protocol FactExtractor: Sendable {
    func extract(_ event: Event) async throws -> FactExtractionResult
}

public enum FactRules {
    public static let predicates = ["name", "contact", "employment", "education", "skill", "location", "relationship", "preference", "plan", "other"]

    /// Contact ownership is known from the connector, including legacy events that also listed self.
    public static func subjects(for event: Event) -> [String] {
        if ["apple_contacts", "google_contacts"].contains(event.source.connector) {
            return [(event.source.connector == "google_contacts" ? "person:google:" : "person:apple:") + ConnectorSourceRecord.identifier(event.source.externalID)]
        }
        return event.subjects
    }

    public static func validate(_ candidate: FactCandidate, event: Event) throws {
        guard subjects(for: event).contains(candidate.subject) else { throw MapleError.provider("Extractor returned an unrecognized subject; no facts were saved.") }
        guard predicates.contains(candidate.predicate) else { throw MapleError.provider("Extractor returned an unsupported fact category; no facts were saved.") }
        guard !candidate.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, candidate.value.utf8.count <= 2048,
              !candidate.sourceQuote.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              candidate.sourceQuote.utf8.count <= 2048, event.content.contains(candidate.sourceQuote) else {
            throw MapleError.provider("Extracted fact failed source/subject validation; no facts from this result were saved.")
        }
    }
}

extension KnowledgeStore {
    func insertFactCheck(eventID: String, probability: Double, provider: String, model: String, now: Date, context: Context? = nil, rawResponse: String? = nil) throws {
        guard probability.isFinite, (0...1).contains(probability), !provider.isEmpty, !model.isEmpty else {
            throw MapleError.provider("Invalid fact check.")
        }
        let check = FactCheck(eventID: eventID, probability: probability, provider: provider, model: model, checkedAt: now, context: context, rawResponse: rawResponse)
        try db.execute("INSERT INTO fact_checks VALUES (?,?,?)", [UUID().uuidString, eventID, try JSONCodec.string(check)])
        if probability >= 0.85 {
            try db.execute("INSERT OR IGNORE INTO fact_jobs(event_id,next_attempt_at) VALUES (?,?)", [eventID, String(now.timeIntervalSince1970)])
            try db.execute("INSERT OR IGNORE INTO work_items VALUES (?,?, 'extract_facts','pending')", [UUID().uuidString, eventID])
        }
    }

    public func recordFactCheck(eventID: String, probability: Double, provider: String, model: String, context: Context? = nil, rawResponse: String? = nil) throws {
        try db.transaction { try insertFactCheck(eventID: eventID, probability: probability, provider: provider, model: model, now: Date(), context: context, rawResponse: rawResponse) }
    }

    public func factChecks() throws -> [FactCheck] {
        try db.rows("SELECT json FROM fact_checks ORDER BY rowid DESC").map { try JSONCodec.decode(FactCheck.self, from: Data($0["json"]!.utf8)) }
    }

    public func sourceFacts(subjects: [String]? = nil, limit: Int = 100) throws -> [SourceFact] {
        if let subjects, subjects.isEmpty { return [] }
        let filter = subjects.map { " WHERE subject IN (\(Array(repeating: "?", count: $0.count).joined(separator: ",")))" } ?? ""
        return try db.rows("SELECT json FROM source_facts\(filter) ORDER BY rowid DESC LIMIT ?", (subjects ?? []) + [String(max(1, min(limit, 500)))])
            .map { try JSONCodec.decode(SourceFact.self, from: Data($0["json"]!.utf8)) }
    }

    func acquireFacts(now: Date, eventIDs:[String]? = nil) throws -> Lease? {
        try excludeExpiredAIWork(at:now)
        return try db.transaction {
            if let eventIDs,eventIDs.isEmpty {return nil}
            let filter=eventIDs.map{" AND event_id IN ("+Array(repeating:"?",count:$0.count).joined(separator:",")+")"} ?? ""
            guard let row = try db.rows("SELECT event_id FROM fact_jobs WHERE ((status='pending' AND next_attempt_at<=?) OR (status='leased' AND lease_until<=?))\(filter) ORDER BY next_attempt_at,rowid LIMIT 1", [String(now.timeIntervalSince1970), String(now.timeIntervalSince1970)] + (eventIDs ?? [])).first else { return nil }
            let lease = Lease(eventID: row["event_id"]!, token: UUID().uuidString)
            try db.execute("UPDATE fact_jobs SET status='leased', attempts=attempts+1, lease_token=?, lease_until=?, error=NULL WHERE event_id=?", [lease.token, String(now.addingTimeInterval(900).timeIntervalSince1970), lease.eventID])
            try db.execute("UPDATE work_items SET status='extracting' WHERE event_id=? AND kind='extract_facts'", [lease.eventID])
            return lease
        }
    }

    func finishFacts(_ lease: Lease, result: FactExtractionResult, now: Date) throws -> Bool {
        try db.transaction {
            guard try ownsFacts(lease, now: now), let event = try event(lease.eventID) else { return false }
            guard result.candidates.count <= 512, !result.provider.isEmpty, !result.model.isEmpty else { throw MapleError.provider("Invalid fact extraction result.") }
            for candidate in result.candidates { try FactRules.validate(candidate, event: event) }
            for candidate in result.candidates {
                let key = try JSONCodec.encode([event.id, candidate.subject, candidate.predicate, candidate.value])
                let id = SHA256.hash(data: key).map { String(format: "%02x", $0) }.joined()
                let fact = SourceFact(id: id, subject: candidate.subject, predicate: candidate.predicate, value: candidate.value,
                                      sourceQuote: candidate.sourceQuote, eventID: event.id, provider: result.provider,
                                      model: result.model, extractedAt: now)
                try db.execute("INSERT OR IGNORE INTO source_facts VALUES (?,?,?,?)", [id, event.id, fact.subject, try JSONCodec.string(fact)])
            }
            try db.execute("UPDATE fact_jobs SET status='succeeded', lease_token=NULL, lease_until=NULL,error=NULL WHERE event_id=?", [lease.eventID])
            try db.execute("UPDATE work_items SET status=? WHERE event_id=? AND kind='extract_facts'", [result.candidates.isEmpty ? "no_facts" : "completed", lease.eventID])
            return true
        }
    }

    private func ownsFacts(_ lease: Lease, now: Date) throws -> Bool {
        !(try db.rows("SELECT event_id FROM fact_jobs WHERE event_id=? AND status='leased' AND lease_token=? AND lease_until>?", [lease.eventID, lease.token, String(now.timeIntervalSince1970)])).isEmpty
    }

    func failFacts(_ lease: Lease, now: Date, reason: String = "Fact extraction unavailable or output invalid. Check the local model, then retry.") throws {
        guard try ownsFacts(lease, now: now) else { return }
        let attempts = Int(try db.rows("SELECT attempts FROM fact_jobs WHERE event_id=?", [lease.eventID]).first?["attempts"] ?? "1") ?? 1
        let status = attempts >= 3 ? "blocked" : "pending"
        try db.transaction {
            try db.execute("UPDATE fact_jobs SET status=?, next_attempt_at=?, lease_token=NULL,lease_until=NULL,error=? WHERE event_id=?", [status, String(now.addingTimeInterval(60 * pow(2, Double(attempts))).timeIntervalSince1970), String(reason.prefix(500)), lease.eventID])
            try db.execute("UPDATE work_items SET status=? WHERE event_id=? AND kind='extract_facts'", [status, lease.eventID])
        }
    }

    public func retryFacts() throws {
        try db.transaction {
            try db.execute("UPDATE work_items SET status='pending' WHERE kind='extract_facts' AND event_id IN (SELECT event_id FROM fact_jobs WHERE status='blocked' OR error IS NOT NULL)")
            try db.execute("UPDATE fact_jobs SET status='pending',attempts=0,error=NULL,next_attempt_at=? WHERE status='blocked' OR error IS NOT NULL", [String(Date().timeIntervalSince1970)])
        }
    }

    public func factQueue() throws -> [QueueItem] {
        try db.rows("SELECT * FROM fact_jobs ORDER BY rowid").map {
            QueueItem(eventID: $0["event_id"]!, status: $0["status"]!, attempts: Int($0["attempts"]!)!,
                      nextAttemptAt: Date(timeIntervalSince1970: Double($0["next_attempt_at"]!)!), error: $0["error"])
        }
    }
}

public struct FactExtractionEngine: Sendable {
    public let store: KnowledgeStore
    public let extractor: any FactExtractor
    public init(store: KnowledgeStore, extractor: any FactExtractor) { self.store = store; self.extractor = extractor }
    public func runOne(eventIDs:[String]? = nil) async throws -> Bool {
        guard let lease = try await store.acquireFacts(now: Date(),eventIDs:eventIDs) else { return false }
        do {
            guard let event = try await store.event(lease.eventID) else { throw MapleError.invalid("Missing extraction source.") }
            let result: FactExtractionResult
            if event.type == "facts.structured" {
                // Only this explicit canonical schema bypasses generative parsing.
                let candidates = try JSONCodec.decode([FactCandidate].self, from: Data(event.content.utf8))
                result = FactExtractionResult(candidates: candidates, provider: "structured-source", model: "canonical-facts-v1")
            } else { result = try await extractor.extract(event) }
            return try await store.finishFacts(lease, result: result, now: Date())
        } catch {
            let reason = (error as? MapleError)?.errorDescription ?? "Local model failed (\(String(reflecting: type(of: error)))); retry after checking Apple Intelligence."
            try await store.failFacts(lease, now: Date(), reason: reason)
            return false
        }
    }
}
