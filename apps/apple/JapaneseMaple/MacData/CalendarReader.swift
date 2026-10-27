//
//  CalendarReader.swift
//  JapaneseMaple
//
//  Reads events from every calendar account on this Mac (iCloud, Google,
//  Exchange…) through EventKit. Repeating events are expanded into their
//  individual occurrences. Read-only.
//

#if os(macOS)
import EventKit
import Foundation

nonisolated struct CalendarReader {
    /// Upcoming events matter as much as past ones for "what's happening this week".
    static let lookAhead: TimeInterval = 180 * 24 * 60 * 60

    static var hasAccess: Bool {
        EKEventStore.authorizationStatus(for: .event) == .fullAccess
    }

    static var accessDenied: Bool {
        let status = EKEventStore.authorizationStatus(for: .event)
        return status == .denied || status == .restricted || status == .writeOnly
    }

    /// Explains a past decision macOS won't ask about again; nil when a prompt can still appear.
    static var accessProblem: String? {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .denied:
            return "Calendar access is turned off for Just Maple. Turn it on in System Settings → Privacy & Security → Calendars."
        case .restricted:
            return "Calendar access is restricted on this Mac, for example by Screen Time or a device profile."
        case .writeOnly:
            return "Just Maple can only add events. In System Settings → Privacy & Security → Calendars, choose Full Access."
        default:
            return nil
        }
    }

    /// EventKit has no change cursor, so each pass reads the whole window and the
    /// store removes stored events that no longer appear in it.
    func read(store: EKEventStore, now: Date = Date()) throws -> MacDataReadResult {
        guard Self.hasAccess else {
            throw MacDataError.accessDenied("Calendar access hasn't been granted.")
        }
        let start = now.addingTimeInterval(-macDataInitialWindow)
        let end = now.addingTimeInterval(Self.lookAhead)

        // EventKit caps a single predicate's span, so read in 30-day slices.
        var events: [EKEvent] = []
        var sliceStart = start
        while sliceStart < end {
            let sliceEnd = min(sliceStart.addingTimeInterval(30 * 24 * 60 * 60), end)
            let predicate = store.predicateForEvents(
                withStart: sliceStart, end: sliceEnd, calendars: nil)
            events += store.events(matching: predicate)
            sliceStart = sliceEnd
        }

        var items: [String: MacDataItem] = [:]
        for event in events {
            let item = Self.item(from: event)
            items[item.id] = item  // slices overlap at their edges
        }
        return MacDataReadResult(
            items: Array(items.values),
            removedIds: [],
            presentIds: Set(items.keys),
            reconcileWindow: start.timeIntervalSince1970...end.timeIntervalSince1970,
            checkpoint: String(now.timeIntervalSince1970))
    }

    static func item(from event: EKEvent) -> MacDataItem {
        let start = event.startDate.timeIntervalSince1970
        let identifier = event.calendarItemExternalIdentifier ?? event.calendarItemIdentifier
        let attendees = (event.attendees ?? []).compactMap { participant -> String? in
            participant.name ?? participant.url.absoluteString.replacingOccurrences(
                of: "mailto:", with: "")
        }
        var body = event.notes ?? ""
        // Events added from Just Maple carry a justmaple:// marker; it's not content.
        if let url = event.url, url.scheme != "justmaple" {
            body += (body.isEmpty ? "" : "\n") + url.absoluteString
        }
        let modified = event.lastModifiedDate?.timeIntervalSince1970 ?? 0
        let end = event.endDate.timeIntervalSince1970
        // The calendar's own id, so a page can share one calendar even when two share a name.
        let calendarId = event.calendar?.calendarIdentifier
        return MacDataItem(
            id: "calendar:\(identifier)@\(Int(start))",
            source: .calendar,
            revision: macDataStableHash(
                "\(modified)|\(event.title ?? "")|\(start)|\(end)|\(event.location ?? "")|\(event.status.rawValue)|\(calendarId ?? "")"),
            occurredAt: start,
            endAt: end,
            title: event.title,
            sender: event.organizer?.name,
            participants: attendees,
            thread: nil,
            body: String(body.prefix(20_000)),
            isFromMe: nil,
            location: event.location,
            calendar: event.calendar?.title,
            allDay: event.isAllDay,
            mailbox: event.status == .canceled ? "Canceled" : nil,
            isRead: nil,
            extra: calendarId.map { ["calendarId": .string($0)] })
    }
}
#endif
