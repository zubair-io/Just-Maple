import Foundation
import MapleCore

extension AppModel {
    var appleSettingsURL: URL { directory.appendingPathComponent("apple-connectors.json") }
    func loadAppleSettings() {
        if let data = try? Data(contentsOf: appleSettingsURL), let settings = try? JSONDecoder().decode(AppleSettings.self, from: data) {
            contactsEnabled = settings.contacts
            calendarEnabled = settings.calendar
            selectedCalendarIDs = Set(settings.selectedCalendarIDs ?? [])
        }
    }
    func saveAppleSettings() throws {
        try JSONEncoder().encode(AppleSettings(contacts: contactsEnabled, calendar: calendarEnabled, selectedCalendarIDs: selectedCalendarIDs.sorted())).write(to: appleSettingsURL, options: .atomic)
    }
    @discardableResult
    func refreshCalendarChoices() async -> Bool {
        do { calendarChoices = try await appleConnectors.calendarChoices(); return true }
        catch { calendarStatus = error.localizedDescription; return false }
    }
    func selectCalendars(_ ids: [String]) async throws {
        guard !appleImporting else { throw MapleError.invalid("Wait for the current import to finish.") }
        let valid = Set(calendarChoices.map(\.id))
        guard Set(ids).isSubset(of: valid) else { throw MapleError.invalid("Refresh the calendar list before saving.") }
        let previous = selectedCalendarIDs
        selectedCalendarIDs = Set(ids)
        do { try saveAppleSettings() } catch { selectedCalendarIDs = previous; throw error }
        calendarStatus = ids.isEmpty ? "No calendars selected · imports stopped" : "Selection saved"
        if !ids.isEmpty { await pollApple(kind: "calendar", force: true) }
    }
    func connectApple(_ kind: String) async {
        guard !appleImporting else { return }
        appleImporting = true
        do {
            let allowed = try await (kind == "contacts" ? appleConnectors.authorizeContacts() : appleConnectors.authorizeCalendar())
            guard allowed else { throw MapleError.invalid("Access was not granted. You can enable it in System Settings → Privacy & Security.") }
            if kind == "contacts" { contactsEnabled = true } else { calendarEnabled = true }
            try saveAppleSettings()
            appleImporting = false
            if kind == "calendar" {
                if await refreshCalendarChoices() { calendarStatus = "Choose calendars, then save your selection to import." }
            } else { await pollApple(kind: kind, force: true) }
        } catch {
            if kind == "contacts" { contactsStatus = error.localizedDescription } else { calendarStatus = error.localizedDescription }
            appleImporting = false
        }
    }
    func pauseApple(_ kind: String) {
        if kind == "contacts" { contactsEnabled = false; contactsStatus = "Paused · imported context retained" }
        else { calendarEnabled = false; calendarStatus = "Paused · imported context retained" }
        do { try saveAppleSettings() } catch { self.error = error.localizedDescription }
    }
    func pollApple(kind: String? = nil, force: Bool = false) async {
        guard !appleImporting, let store else { return }
        let now = Date()
        guard force || now.timeIntervalSince(lastApplePoll) >= 300 else { return }
        appleImporting = true
        defer { appleImporting = false; lastApplePoll = now }
        if contactsEnabled && (kind == nil || kind == "contacts") {
            do {
                let records = try await appleConnectors.readContacts()
                // A pause while the framework fetch was in flight prevents ingestion.
                if contactsEnabled {
                    let count = try await store.ingestAppleSnapshot(records, connector: "apple_contacts", now: now)
                    contactsStatus = "\(records.count) contacts · \(count) changes · \(now.formatted(date: .omitted, time: .shortened))"
                }
            } catch { contactsStatus = error.localizedDescription }
        }
        if calendarEnabled && (kind == nil || kind == "calendar") {
            guard await refreshCalendarChoices() else { await refresh(); return }
            guard !selectedCalendarIDs.isEmpty else { calendarStatus = "Choose calendars to import"; await refresh(); return }
            let selection = selectedCalendarIDs
            do {
                let start = Calendar.current.startOfDay(for: now).addingTimeInterval(-30 * 86400)
                let end = Calendar.current.startOfDay(for: now).addingTimeInterval(90 * 86400)
                let records = try await appleConnectors.readCalendar(start: start, end: end, selected: selection)
                if calendarEnabled && selectedCalendarIDs == selection {
                    let count = try await store.ingestAppleSnapshot(records, connector: "apple_calendar", windowStart: start, windowEnd: end, scopeIDs: selection, now: now)
                    calendarStatus = "\(records.count) events · \(count) changes · \(now.formatted(date: .omitted, time: .shortened))"
                }
            } catch { calendarStatus = error.localizedDescription }
        }
        await refresh()
    }
}

private struct AppleSettings: Codable { var contacts: Bool; var calendar: Bool; var selectedCalendarIDs: [String]? }
