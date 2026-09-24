import Foundation
import CryptoKit

/// A source snapshot, not an inference or user correction. Apple frameworks stay in the native host.
public struct ConnectorSourceRecord: Codable, Sendable, Equatable {
    public let id: String
    public let name: String
    public let content: String
    public let start: Date?
    public let end: Date?
    public let scopeID: String?
    public init(id: String, name: String, content: String, start: Date? = nil, end: Date? = nil, scopeID: String? = nil) {
        self.id = id; self.name = name; self.content = content; self.start = start; self.end = end; self.scopeID = scopeID
    }
    public static func identifier(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

public typealias AppleSourceRecord = ConnectorSourceRecord

extension KnowledgeStore {
    public func sourceRecords(_ connector: String) throws -> [AppleSourceRecord] {
        try db.rows("SELECT json FROM connector_source_records WHERE connector=? AND active=1 ORDER BY id", [connector])
            .map { try JSONCodec.decode(AppleSourceRecord.self, from: Data($0["json"]!.utf8)) }
    }

    /// Reconcile only a successfully fetched, complete snapshot. Events, queue and source state commit together.
    /// Missing calendar occurrences mean unavailable in the queried window, never presumed cancellation.
    public func ingestSourceSnapshot(_ records: [AppleSourceRecord], connector: String,
                                    windowStart: Date? = nil, windowEnd: Date? = nil, scopeIDs: Set<String>? = nil, now: Date = Date(), account: String = "local") throws -> Int {
        guard ["apple_contacts", "google_contacts", "apple_calendar", "google_calendar", "home_assistant"].contains(connector), records.count <= 10000,
              Set(records.map(\.id)).count == records.count else { throw MapleError.invalid("Invalid connector source snapshot.") }
        if connector == "google_contacts" {
            let scope = ConnectorSourceRecord.identifier(account)
            guard account != "local", scopeIDs == [scope], records.allSatisfy({ $0.scopeID == scope }) else {
                throw MapleError.invalid("Google Contacts requires an account-scoped snapshot.")
            }
        }
        if connector.hasSuffix("_calendar") {
            guard let windowStart, let windowEnd, windowStart < windowEnd,
                  windowStart.timeIntervalSince1970.isFinite, windowEnd.timeIntervalSince1970.isFinite,
                  records.allSatisfy({ $0.start != nil && $0.end != nil && $0.end! >= $0.start! && $0.start! < windowEnd && $0.end! >= windowStart }) else {
                throw MapleError.invalid("Calendar snapshot requires a valid time window and occurrence dates.")
            }
        }
        return try db.transaction {
            let previous = try db.rows("SELECT * FROM connector_source_records WHERE connector=?", [connector])
            let byID = Dictionary(uniqueKeysWithValues: previous.map { ($0["id"]!, $0) })
            let ids = Set(records.map(\.id))
            var changes = 0
            func write(_ record: AppleSourceRecord, active: Bool) throws {
                let json = try JSONCodec.string(record)
                let prior = byID[record.id]
                if prior?["json"] == json && prior?["active"] == (active ? "1" : "0") { return }
                guard !record.name.isEmpty else { throw MapleError.invalid("An Apple source has no name.") }
                let subject = (connector.hasSuffix("_contacts") ? (connector == "google_contacts" ? "person:google:" : "person:apple:") : connector.hasSuffix("_calendar") ? (connector == "google_calendar" ? "calendar:google:" : "calendar:apple:") : "home:") + AppleSourceRecord.identifier(record.id)
                let event = Event(type: connector == "home_assistant" ? (active ? "home.state" : "home.unavailable") : connector.hasSuffix("_contacts") ? (active ? "contact.snapshot" : "contact.unavailable") : (active ? "calendar.snapshot" : "calendar.unavailable"),
                    source: Source(connector: connector, account: account, externalID: record.id,
                                   revision: AppleSourceRecord.identifier(json + String(active) + (prior?["event_id"] ?? "initial"))),
                    occurredAt: now, receivedAt: now, subjects: connector.hasSuffix("_contacts") ? [subject] : ["person:self", subject],
                    content: active ? record.content : "This source is no longer available to the connector in its current access scope or calendar window. This does not prove deletion or cancellation. Previous source:\n" + record.content)
                try event.validate()
                let eventID = try insert(event, enqueue: true)
                try db.execute("INSERT INTO connector_source_records VALUES (?,?,?,?,?) ON CONFLICT(connector,id) DO UPDATE SET json=excluded.json,event_id=excluded.event_id,active=excluded.active",
                               [connector, record.id, json, eventID, active ? "1" : "0"])
                changes += 1
            }
            for record in records {
                if let scopeIDs, !scopeIDs.contains(record.scopeID ?? "") { throw MapleError.invalid("Record is outside the selected source scope.") }
                try write(record, active: true)
            }
            for row in previous where row["active"] == "1" && !ids.contains(row["id"]!) {
                let record = try JSONCodec.decode(AppleSourceRecord.self, from: Data(row["json"]!.utf8))
                if let scopeIDs, !scopeIDs.contains(record.scopeID ?? "") { continue }
                // Aging out of a rolling window does not constitute an observed source change.
                if connector.hasSuffix("_calendar"), let start = record.start, let end = record.end,
                   let windowStart, let windowEnd, !(start < windowEnd && end >= windowStart) { continue }
                try write(record, active: false)
            }
            return changes
        }
    }
}

extension KnowledgeStore {
    public func appleRecords(_ connector: String) throws -> [AppleSourceRecord] { try sourceRecords(connector) }
    public func ingestAppleSnapshot(_ records: [AppleSourceRecord], connector: String, windowStart: Date? = nil, windowEnd: Date? = nil, scopeIDs: Set<String>? = nil, now: Date = Date()) throws -> Int {
        try ingestSourceSnapshot(records, connector: connector, windowStart: windowStart, windowEnd: windowEnd, scopeIDs: scopeIDs, now: now)
    }
}
