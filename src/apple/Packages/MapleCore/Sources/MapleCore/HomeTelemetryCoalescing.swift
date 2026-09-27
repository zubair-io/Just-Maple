import Foundation

/// Deliberately narrow: cumulative energy counters, never instantaneous measurements.
/// No inference about safety, urgency, or tasks is made from entity names or values.
struct HomeEnergyCounter {
    let value: Double
    let signature: String
    init?(_ record: ConnectorSourceRecord) {
        let lines = record.content.components(separatedBy: "\n")
        guard lines.count == 4, lines[0].hasPrefix("Home Assistant entity: sensor."),
              lines[2].hasPrefix("State: "), lines[3].hasPrefix("Attributes: "),
              let value = Double(lines[2].dropFirst(7)), value.isFinite, value >= 0,
              let attributes = try? JSONSerialization.jsonObject(with: Data(lines[3].dropFirst(12).utf8)) as? [String: Any],
              attributes["device_class"] as? String == "energy",
              attributes["state_class"] as? String == "total_increasing",
              let unit = attributes["unit_of_measurement"] as? String,
              ["Wh", "kWh", "MWh"].contains(unit) else { return nil }
        self.value = value
        signature = [lines[0], lines[1], lines[3]].joined(separator: "\n")
    }
}

extension KnowledgeStore {
    /// Called inside snapshot ingestion's transaction AFTER inserting the new event.
    /// Baselines, resets, unavailable states, attribute changes and leased/failed work survive.
    /// All immutable observations, FTS rows and embedding jobs remain untouched.
    func coalesceHomeTelemetry(previous: ConnectorSourceRecord, current: ConnectorSourceRecord,
                               previousID: String, event: Event, eventID: String) throws {
        guard let old = HomeEnergyCounter(previous), let new = HomeEnergyCounter(current),
              old.signature == new.signature, new.value > old.value,
              let prior = try db.rows("SELECT account FROM events WHERE id=?", [previousID]).first,
              prior["account"] == event.source.account else { return }
        try db.execute("CREATE TABLE IF NOT EXISTS home_counter_increments(event_id TEXT PRIMARY KEY REFERENCES events(id))")
        // Only a known increment may be superseded: the first baseline always stays queued.
        try db.execute("""
            UPDATE processing_jobs SET status='coalesced', error=?, lease_token=NULL, lease_until=NULL
            WHERE event_id=? AND status='pending' AND attempts=0 AND error IS NULL
              AND event_id IN (SELECT event_id FROM home_counter_increments)
            """, ["Indexed locally; cumulative energy increment superseded by observation " + eventID, previousID])
        try db.execute("INSERT OR IGNORE INTO home_counter_increments(event_id) VALUES (?)", [eventID])
    }
}
