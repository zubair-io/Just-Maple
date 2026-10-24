#if !os(watchOS)
import EventKit
import Foundation
import Observation

/// Represents a user calendar for display in settings.
struct CalendarInfo: Identifiable, Hashable {
    let id: String          // calendarIdentifier
    let title: String
    let color: CGColor?
    let sourceName: String  // e.g. "iCloud", "Google", "Exchange"
}

@Observable
final class CalendarManager {
    var authorizationStatus: EKAuthorizationStatus = .notDetermined
    var calendars: [CalendarInfo] = []

    private let eventStore = EKEventStore()

    init() {
        refreshAuthorizationStatus()
    }

    /// Check the current status without prompting.
    func refreshAuthorizationStatus() {
        authorizationStatus = EKEventStore.authorizationStatus(for: .event)
        if authorizationStatus == .fullAccess {
            loadCalendars()
        }
    }

    /// Request calendar access. Only call this when the user explicitly enables the feature.
    /// Apple's EventKit requires "full access" to read events — there is no read-only API.
    func requestAccess() async -> Bool {
        guard authorizationStatus != .fullAccess else { return true }

        do {
            let granted = try await eventStore.requestFullAccessToEvents()
            authorizationStatus = granted ? .fullAccess : .denied
            if granted {
                loadCalendars()
            }
            return granted
        } catch {
            print("[CalendarManager] Access request failed: \(error)")
            authorizationStatus = .denied
            return false
        }
    }

    /// Revoke access by resetting internal state. The actual OS permission stays
    /// (user must revoke in System Settings), but we stop using it.
    func disconnectAccess() {
        calendars = []
    }

    private func loadCalendars() {
        let ekCalendars = eventStore.calendars(for: .event)
        calendars = ekCalendars.map { cal in
            CalendarInfo(
                id: cal.calendarIdentifier,
                title: cal.title,
                color: cal.cgColor,
                sourceName: cal.source?.title ?? "Local"
            )
        }
        .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
    }

    /// Returns the title of a calendar event happening right now, filtered to the
    /// selected calendars if any are specified. Returns nil if no matching event.
    func currentMeetingTitle(calendarIdentifiers: [String]) -> String? {
        guard authorizationStatus == .fullAccess else { return nil }

        let now = Date()
        let startWindow = now.addingTimeInterval(-5 * 60)
        let endWindow = now.addingTimeInterval(8 * 60 * 60)

        // Filter to selected calendars if specified (empty = all)
        let targetCalendars: [EKCalendar]?
        if calendarIdentifiers.isEmpty {
            targetCalendars = nil  // all calendars
        } else {
            let matched = calendarIdentifiers.compactMap { eventStore.calendar(withIdentifier: $0) }
            targetCalendars = matched.isEmpty ? nil : matched
        }

        let predicate = eventStore.predicateForEvents(
            withStart: startWindow,
            end: endWindow,
            calendars: targetCalendars
        )

        let events = eventStore.events(matching: predicate)

        let currentEvent = events
            .filter { event in
                event.startDate <= now && event.endDate > now && !event.isAllDay
            }
            .sorted { a, b in
                a.startDate > b.startDate
            }
            .first

        guard let event = currentEvent else { return nil }

        let title = event.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return title.isEmpty ? nil : title
    }
}
#endif
