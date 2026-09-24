import AppKit
import Foundation
import MapleCore
import UniformTypeIdentifiers

struct GoogleSettings: Codable {
    var account = ""
    var mailEnabled = false
    var calendarEnabled = false
    var selected: [String] = []
    var contactsEnabled: Bool? = false
}

extension AppModel {
    var googleSettingsURL: URL { directory.appendingPathComponent("google-settings.json") }
    var googleConfigURL: URL { directory.appendingPathComponent("google-client.json") }
    func loadGoogleSettings() async {
        googleConfigured = (try? GoogleClientConfiguration.load(googleConfigURL)) != nil
        googleSettings = (try? JSONDecoder().decode(GoogleSettings.self, from: Data(contentsOf: googleSettingsURL))) ?? GoogleSettings()
        guard !googleSettings.account.isEmpty else { return }
        let account = googleSettings.account
        do {
            googleTokens = try await Task.detached { try GoogleCredentials.read(account, interactive: false) }.value
            googleStatus = googleTokens == nil ? "Unlock or reconnect Google" : "Connected · ready to import"
        } catch { googleStatus = error.localizedDescription }
    }
    func saveGoogleSettings() throws { try JSONEncoder().encode(googleSettings).write(to: googleSettingsURL, options: .atomic) }
    func importGoogleConfiguration() throws {
        guard !googleBusy else { throw MapleError.invalid("Wait for the current Google operation.") }
        let panel = NSOpenPanel(); panel.allowedContentTypes = [.json]; panel.allowsMultipleSelection = false
        panel.message = "Select your Google Desktop app OAuth client JSON file."
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let config = try GoogleClientConfiguration.load(url)
        // A changed client cannot reuse credentials issued to the old client.
        if let prior = try? GoogleClientConfiguration.load(googleConfigURL), prior.installed.client_id != config.installed.client_id {
            try disconnectGoogle()
        }
        try JSONEncoder().encode(config).write(to: googleConfigURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: googleConfigURL.path)
        googleConfigured = true; googleStatus = "Configuration ready · connect Google"
    }
    func connectGoogle() async throws {
        guard !googleBusy else { throw MapleError.invalid("Google is already connecting or importing.") }
        let config = try GoogleClientConfiguration.load(googleConfigURL)
        googleBusy = true; googleStatus = "Finish Google sign-in in your browser"
        defer { googleBusy = false }
        do {
            let tokens = try await googleOAuth.authorize(config)
            let account = try await GoogleAPI(token: tokens.access).email()
            try await Task.detached { try GoogleCredentials.save(tokens, account: account) }.value
            if googleSettings.account != account { googleSettings.selected = [] }
            googleSettings.account = account; googleSettings.mailEnabled = true; googleSettings.calendarEnabled = true; googleSettings.contactsEnabled = true
            googleTokens = tokens; googleCalendars = []; try saveGoogleSettings()
            googleStatus = "Google connected · choose calendars; Gmail imports shortly"
            // Preserve the usable Gmail connection even if Calendar API still needs enabling.
            do { googleCalendars = try await GoogleAPI(token: tokens.access).calendars() }
            catch { googleCalendarStatus = error.localizedDescription }
            lastGooglePoll = .distantPast
        } catch { googleStatus = error.localizedDescription; throw error }
    }
    func unlockGoogle() async throws {
        guard !googleBusy, !googleSettings.account.isEmpty else { return }
        googleBusy = true; defer { googleBusy = false }
        let account = googleSettings.account
        googleTokens = try await Task.detached { try GoogleCredentials.read(account, interactive: true) }.value
        googleStatus = googleTokens == nil ? "No saved token · reconnect Google" : "Google unlocked"
        lastGooglePoll = .distantPast
    }
    func disconnectGoogle() throws {
        guard !googleBusy else { throw MapleError.invalid("Wait for Google to finish, or cancel sign-in first.") }
        if !googleSettings.account.isEmpty { try GoogleCredentials.remove(googleSettings.account) }
        googleTokens = nil; googleSettings = GoogleSettings(); googleCalendars = []; googleCalendar = []
        try saveGoogleSettings(); googleStatus = "Disconnected · imported context retained"
    }
    func setGoogleEnabled(_ kind: String, enabled: Bool) throws {
        if kind == "mail" { googleSettings.mailEnabled = enabled }
        else if kind == "contacts" { googleSettings.contactsEnabled = enabled }
        else { googleSettings.calendarEnabled = enabled }
        try saveGoogleSettings(); lastGooglePoll = .distantPast
    }
    func googleAccess() async throws -> String {
        guard var tokens = googleTokens else { throw MapleError.invalid("Unlock or reconnect Google first.") }
        if tokens.expires.timeIntervalSinceNow < 60 {
            tokens = try await GoogleOAuth.refresh(GoogleClientConfiguration.load(googleConfigURL), tokens: tokens)
            let saved = tokens, account = googleSettings.account
            try await Task.detached { try GoogleCredentials.save(saved, account: account) }.value
            googleTokens = tokens
        }
        return tokens.access
    }
    func refreshGoogleCalendars() async throws {
        guard !googleBusy else { throw MapleError.invalid("Wait for Google to finish importing.") }
        googleBusy = true; defer { googleBusy = false }
        googleCalendars = try await GoogleAPI(token: googleAccess()).calendars()
    }
    func selectGoogleCalendars(_ ids: [String]) async throws {
        guard !googleBusy, Set(ids).isSubset(of: Set(googleCalendars.map(\.id))) else { throw MapleError.invalid("Refresh Google calendars before selecting them.") }
        let previous = googleSettings.selected
        googleSettings.selected = Array(Set(ids)).sorted()
        do { try saveGoogleSettings() } catch { googleSettings.selected = previous; throw error }
        await pollGoogle(force: true)
    }
    func pollGoogle(force: Bool = false) async {
        guard !googleBusy, googleTokens != nil, let store, googleSettings.mailEnabled || googleSettings.calendarEnabled || googleSettings.contactsEnabled == true,
              force || Date().timeIntervalSince(lastGooglePoll) >= 300 else { return }
        googleBusy = true; defer { googleBusy = false; lastGooglePoll = Date() }
        let account = googleSettings.account, selected = Set(googleSettings.selected)
        do {
            let api = try await GoogleAPI(token: googleAccess())
            if googleSettings.contactsEnabled == true {
                if googleTokens?.scopes.contains(GoogleOAuth.contactsScope) != true {
                    googleContactsStatus = "Reconnect Google to grant read-only Contacts access"
                } else {
                    do {
                        let records = try await api.contacts(account: account)
                        if googleSettings.contactsEnabled == true && googleSettings.account == account {
                            let changes = try await store.ingestSourceSnapshot(records, connector: "google_contacts", scopeIDs: [ConnectorSourceRecord.identifier(account)], account: account)
                            googleContactsStatus = "\(records.count) contacts · \(changes) changes"
                        }
                    } catch { googleContactsStatus = error.localizedDescription }
                }
            }
            if googleSettings.mailEnabled {
                googleMailStatus = "Importing up to 100 recent messages…"
                do {
                    let events = try await api.recentMail(account: account)
                    if googleSettings.mailEnabled && account == googleSettings.account {
                        let changes = try await store.ingestGoogleMail(events)
                        googleMailStatus = "\(events.count) recent messages checked · \(changes) new observations"
                    }
                } catch { googleMailStatus = error.localizedDescription }
            }
            if googleSettings.calendarEnabled {
                do {
                    googleCalendars = try await api.calendars()
                    guard selected.isSubset(of: Set(googleCalendars.map(\.id))) else { throw MapleError.invalid("A selected Google calendar is unavailable. Refresh and update your selection.") }
                    if selected.isEmpty { googleCalendarStatus = "Choose Google calendars to import" }
                    else {
                        let now = Date(), start = Calendar.current.startOfDay(for: Date()).addingTimeInterval(-30 * 86400), end = Calendar.current.startOfDay(for: Date()).addingTimeInterval(90 * 86400)
                        let records = try await api.calendarRecords(account: account, choices: googleCalendars.filter { selected.contains($0.id) }, start: start, end: end)
                        if googleSettings.calendarEnabled && googleSettings.account == account && Set(googleSettings.selected) == selected {
                            let scopes = Set(selected.map { GoogleAPI.scope(account: account, calendar: $0) })
                            let changes = try await store.ingestSourceSnapshot(records, connector: "google_calendar", windowStart: start, windowEnd: end, scopeIDs: scopes, now: now, account: account)
                            googleCalendarStatus = "\(records.count) events · \(changes) changes"
                        }
                    }
                } catch { googleCalendarStatus = error.localizedDescription }
            }
            googleStatus = "Connected to \(account)"
            await refresh()
        } catch { googleStatus = error.localizedDescription }
    }
}
