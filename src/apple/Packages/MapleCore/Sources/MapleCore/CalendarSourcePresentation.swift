import Foundation

public struct CalendarSourcePresentation: Codable, Sendable {
    public let start: Date
    public let end: Date
    public let allDay: Bool
    public let timeZone: String?
    public let name: String
    public let location: String
    public let notes: String

    init?(_ event: Event) {
        guard event.source.connector.hasSuffix("_calendar"), event.type == "calendar.snapshot" else { return nil }
        let lines = event.content.components(separatedBy: "\n")
        func field(_ key: String) -> String? { lines.prefix(16).first { $0.hasPrefix(key + ": ") }.map { String($0.dropFirst(key.count + 2)) } }
        func instant(_ text: String?) -> Date? {
            guard let text else { return nil }
            let iso = ISO8601DateFormatter()
            if let date = iso.date(from: text) { return date }
            iso.formatOptions.insert(.withFractionalSeconds)
            return iso.date(from: text)
        }
        guard let start = instant(field("Start")), let end = instant(field("End")), end >= start else { return nil }
        self.start = start; self.end = end
        allDay = field("All day") == "true"
        timeZone = field("Time zone").flatMap { TimeZone(identifier: $0)?.identifier }
        name = field("Calendar") ?? "Calendar"
        location = String((field("Location") ?? "").prefix(240))
        notes = String((field("Notes") ?? "").prefix(280))
    }

    func overlaps(day: String, timeZone noteZone: String) throws -> Bool {
        if allDay {
            let zone = timeZone ?? noteZone
            let first = try ManagedMarkdown.day(at: start, timeZone: zone)
            let exclusiveEnd = try ManagedMarkdown.day(at: end, timeZone: zone)
            return first <= day && (day < exclusiveEnd || (start == end && day == first))
        }
        guard let zone = TimeZone(identifier: noteZone) else { return false }
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.calendar = Calendar(identifier: .gregorian); f.timeZone = zone; f.dateFormat = "yyyy-MM-dd"
        guard let beginning = f.date(from: day) else { return false }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = zone
        let next = calendar.date(byAdding: .day, value: 1, to: beginning)!
        return start < next && (end > beginning || (end == start && start >= beginning))
    }
}

extension KnowledgeStore {
    func calendarBelongsInToday(_ event: Event, day: String, timeZone: String) throws -> Bool {
        guard event.source.connector.hasSuffix("_calendar") else { return true }
        guard let calendar = CalendarSourcePresentation(event) else { return false }
        return try calendar.overlaps(day: day, timeZone: timeZone)
    }

    /// Repair only unchanged automatically inserted cards. User additions and prose are untouched.
    func misplacedAutomaticCalendarBlocks(documentID: String, content: String, day: String, timeZone: String) throws -> [String] {
        try ManagedMarkdown.segments(content).filter { segment in
            guard segment.id.hasPrefix("auto-source:"), let id = segment.eventID, let event = try event(id),
                  event.source.connector.hasSuffix("_calendar"),
                  !(try calendarBelongsInToday(event, day: day, timeZone: timeZone)),
                  !(try db.rows("SELECT block_id FROM document_auto_insertions WHERE block_id=? AND document_id=?", [segment.id, documentID])).isEmpty else { return false }
            return segment.content.trimmingCharacters(in: .whitespacesAndNewlines) == (try automaticSourceMarkdown(event, id: segment.id)).trimmingCharacters(in: .whitespacesAndNewlines)
        }.map(\.id)
    }
}
