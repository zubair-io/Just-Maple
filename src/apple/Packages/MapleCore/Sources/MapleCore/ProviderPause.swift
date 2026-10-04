import Foundation

/// Safe transport metadata, without credentials, request text or HTTP error bodies.
public struct JevProviderError: Error, LocalizedError, Sendable {
    public let status: Int?
    public let retryAfter: TimeInterval?
    public init(status: Int?, retryAfter: TimeInterval? = nil) {
        self.status = status
        self.retryAfter = retryAfter.flatMap { $0.isFinite && $0 > 0 ? $0 : nil }
    }
    static func retryDelay(_ header: String?, now: Date = Date()) -> TimeInterval? {
        guard let header else { return nil }
        if let seconds = Double(header), seconds.isFinite, seconds > 0 { return seconds }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
        guard let date = formatter.date(from: header), date > now else { return nil }
        return date.timeIntervalSince(now)
    }
    var requiresAction: Bool { status.map { (400..<500).contains($0) && ![408, 429].contains($0) } ?? false }
    public var errorDescription: String? {
        switch status {
        case 401, 403: return "Jev authentication or access was rejected (HTTP \(status!)). Resolve access, then explicitly retry Jev. Queued sources are retained."
        case 402: return "Jev reported a billing or quota problem (HTTP 402). Resolve it, then explicitly retry Jev. Queued sources are retained."
        case 429: return "Jev rate limited requests. All Jev work is cooling down; queued sources are retained."
        case let code? where (400..<500).contains(code) && code != 408:
            return "Jev rejected a request (HTTP \(code)). Review its configuration before explicitly retrying Jev."
        default: return "Jev is temporarily unavailable. All Jev work is cooling down; queued sources are retained."
        }
    }
}

public struct ProviderPause: Codable, Sendable {
    public let provider: String
    public let reason: String
    public let retryAt: Date?
}

extension SQLite {
    func migrateProviderPauses() throws {
        try transaction {
            try execute("CREATE TABLE IF NOT EXISTS provider_pauses(provider TEXT PRIMARY KEY,reason TEXT NOT NULL,retry_at REAL,failures INTEGER NOT NULL,updated_at REAL NOT NULL)")
            // Carry known unresolved account failures forward once on upgrade.
            guard try rows("SELECT key FROM source_audit_metadata WHERE key='provider_pause_v1'").isEmpty else { return }
            if !(try rows("SELECT event_id FROM processing_jobs WHERE status IN ('pending','blocked','leased') AND (error LIKE 'TypeSafe HTTP 402.%' OR error LIKE 'TypeSafe HTTP 401.%' OR error LIKE 'TypeSafe HTTP 403.%') LIMIT 1")).isEmpty {
                try execute("INSERT OR IGNORE INTO provider_pauses VALUES ('typesafe',?,NULL,1,?)", ["Earlier Jev requests were rejected for account access or quota. Resolve the account issue, then explicitly retry Jev. Queued sources are retained.", String(Date().timeIntervalSince1970)])
            }
            try execute("INSERT INTO source_audit_metadata VALUES ('provider_pause_v1','1')")
        }
    }
}

extension KnowledgeStore {
    public func providerPause(_ provider: String, now: Date = Date()) throws -> ProviderPause? {
        guard let row = try db.rows("SELECT reason,retry_at FROM provider_pauses WHERE provider=?", [provider]).first else { return nil }
        let date = row["retry_at"].flatMap(Double.init).map { Date(timeIntervalSince1970: $0) }
        guard date == nil || date! > now else { return nil }
        return ProviderPause(provider: provider, reason: row["reason"]!, retryAt: date)
    }
    public func clearProviderPause(_ provider: String) throws {
        try db.execute("DELETE FROM provider_pauses WHERE provider=?", [provider])
    }
    func pauseJev(after error: JevProviderError, now: Date = Date()) throws {
        try db.transaction {
            let old = try db.rows("SELECT * FROM provider_pauses WHERE provider='typesafe'").first
            // An in-flight transient failure cannot downgrade an account hold.
            if let old, old["retry_at"] == nil { return }
            let failures = min(10, (Int(old?["failures"] ?? "0") ?? 0) + 1)
            let base: Double = error.status == 429 ? 60 : 30
            let delay = max(error.retryAfter ?? 0, min(3600, base * pow(2, Double(failures - 1))))
            let retryAt = error.requiresAction ? nil : String(max(Double(old?["retry_at"] ?? "0") ?? 0, now.addingTimeInterval(delay).timeIntervalSince1970))
            try db.execute("INSERT INTO provider_pauses VALUES ('typesafe',?,?,?,?) ON CONFLICT(provider) DO UPDATE SET reason=excluded.reason,retry_at=excluded.retry_at,failures=excluded.failures,updated_at=excluded.updated_at", [error.localizedDescription, retryAt, String(failures), String(now.timeIntervalSince1970)])
        }
    }
}
