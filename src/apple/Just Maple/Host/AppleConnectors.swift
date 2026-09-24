import Foundation
import Contacts
import EventKit
import MapleCore

struct CalendarChoice: Codable, Sendable { let id: String; let name: String; let account: String }

/// Confines Apple's non-Sendable stores and objects to a worker actor.
actor AppleConnectors {
    private let contacts = CNContactStore()
    private let calendar = EKEventStore()

    func authorizeContacts() async throws -> Bool { try await contacts.requestAccess(for: .contacts) }
    func authorizeCalendar() async throws -> Bool { try await calendar.requestFullAccessToEvents() }

    func readContacts() throws -> [AppleSourceRecord] {
        let authorization = CNContactStore.authorizationStatus(for: .contacts)
        guard authorization == .authorized else {
            throw MapleError.invalid("Contacts access is unavailable. Allow Just Maple in System Settings → Privacy & Security → Contacts.")
        }
        let keys: [CNKeyDescriptor] = [CNContactIdentifierKey, CNContactGivenNameKey, CNContactFamilyNameKey,
            CNContactMiddleNameKey, CNContactNicknameKey, CNContactOrganizationNameKey, CNContactJobTitleKey,
            CNContactEmailAddressesKey, CNContactPhoneNumbersKey].map { $0 as CNKeyDescriptor }
        let request = CNContactFetchRequest(keysToFetch: keys)
        request.unifyResults = true
        var records: [AppleSourceRecord] = []
        try contacts.enumerateContacts(with: request) { contact, stop in
            let personal = [contact.givenName, contact.middleName, contact.familyName].filter { !$0.isEmpty }.joined(separator: " ")
            let emails = contact.emailAddresses.map { String($0.value) }.sorted()
            let phones = contact.phoneNumbers.map { $0.value.stringValue }.sorted()
            let name = [personal, contact.organizationName, contact.nickname, emails.first ?? "", phones.first ?? "", "Unnamed contact"].first { !$0.isEmpty }!
            let content = ["Apple Contacts source record (not a user correction)", "Name: \(name)",
                "Organization: \(contact.organizationName)", "Job title: \(contact.jobTitle)",
                "Email: \(emails.joined(separator: ", "))", "Phone: \(phones.joined(separator: ", "))"].joined(separator: "\n")
            records.append(AppleSourceRecord(id: contact.identifier, name: name, content: content))
            if records.count > 10000 { stop.pointee = true }
        }
        guard records.count <= 10000 else { throw MapleError.invalid("Contacts exceeds the 10,000-record import limit. No partial snapshot was saved.") }
        return records
    }

    func calendarChoices() throws -> [CalendarChoice] {
        guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else { throw MapleError.invalid("Connect Apple Calendar to choose calendars.") }
        calendar.refreshSourcesIfNecessary()
        return calendar.calendars(for: .event).map { CalendarChoice(id: $0.calendarIdentifier, name: $0.title, account: $0.source.title) }.sorted { ($0.account, $0.name) < ($1.account, $1.name) }
    }

    func readCalendar(start: Date, end: Date, selected: Set<String>) throws -> [AppleSourceRecord] {
        guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else {
            throw MapleError.invalid("Calendar reading needs Full Access. Allow Just Maple in System Settings → Privacy & Security → Calendars.")
        }
        calendar.refreshSourcesIfNecessary()
        guard !selected.isEmpty else { return [] }
        let calendars = calendar.calendars(for: .event).filter { selected.contains($0.calendarIdentifier) }
        guard Set(calendars.map(\.calendarIdentifier)) == selected else { throw MapleError.invalid("A selected calendar is no longer available. Refresh the calendar list and update your selection.") }
        let predicate = calendar.predicateForEvents(withStart: start, end: end, calendars: calendars)
        let events = calendar.events(matching: predicate)
        guard events.count <= 10000 else { throw MapleError.invalid("Calendar exceeds the 10,000-event import limit. No partial snapshot was saved.") }
        let formatter = ISO8601DateFormatter()
        var records: [String: AppleSourceRecord] = [:]
        for event in events {
            guard let begins = event.startDate, let ends = event.endDate else { throw MapleError.invalid("Calendar returned an event without dates.") }
            let anchor = event.occurrenceDate ?? begins
            let id = AppleSourceRecord.identifier(event.calendar.calendarIdentifier + "|" + event.calendarItemIdentifier + "|" + (event.hasRecurrenceRules || event.occurrenceDate != nil ? formatter.string(from: anchor) : "single"))
            let title = event.title?.isEmpty == false ? event.title! : "Untitled event"
            let attendees = (event.attendees ?? []).map { ($0.name ?? "") + " <" + $0.url.absoluteString + ">" }.sorted()
            let content = ["Apple Calendar source record (not a user correction)", "Title: \(title)",
                "Calendar: \(event.calendar.title)", "Start: \(formatter.string(from: begins))", "End: \(formatter.string(from: ends))",
                "Time zone: \(event.timeZone?.identifier ?? "floating/local")", "All day: \(event.isAllDay)",
                "Status: \(event.status.rawValue)", "Location: \(event.location ?? "")", "Attendees: \(attendees.joined(separator: ", "))",
                "Notes: \(event.notes ?? "")"].joined(separator: "\n")
            let record = AppleSourceRecord(id: id, name: title, content: content, start: begins, end: ends, scopeID: event.calendar.calendarIdentifier)
            if let prior = records[id], prior != record { throw MapleError.invalid("Calendar occurrence identity collided. No partial snapshot was saved.") }
            records[id] = record
        }
        return Array(records.values).sorted { $0.id < $1.id }
    }
}
