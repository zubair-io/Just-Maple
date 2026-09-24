import Foundation
import Security
import LocalAuthentication
import MapleCore

struct HomeSettings: Codable {
    var url = ""; var enabled = false; var selected: [String] = []
    var exposedOnly: Bool? = true
    var usesExposed: Bool { exposedOnly ?? true }
}

enum HomeCredentials {
    static func query(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.just.maple.home-assistant", kSecAttrAccount as String: account]
    }
    static func read(_ account: String, interactive: Bool) throws -> String? {
        var q = query(account)
        if !interactive { let context = LAContext(); context.interactionNotAllowed = true; q[kSecUseAuthenticationContext as String] = context }
        q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &value)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = value as? Data else { throw MapleError.invalid("Unlock the Home Assistant token in Connections.") }
        return String(data: data, encoding: .utf8)
    }
    static func save(_ token: String, account: String) throws {
        let data = Data(token.utf8); var q = query(account); q[kSecValueData as String] = data
        let status = SecItemAdd(q as CFDictionary, nil)
        let result = status == errSecDuplicateItem ? SecItemUpdate(query(account) as CFDictionary, [kSecValueData as String: data] as CFDictionary) : status
        guard result == errSecSuccess else { throw MapleError.invalid("Could not save the Home Assistant token in Keychain.") }
    }
}
extension AppModel {
    var homeSettingsURL: URL { directory.appendingPathComponent("home-assistant.json") }
    func loadHomeSettings() async {
        homeSettings = (try? JSONDecoder().decode(HomeSettings.self, from: Data(contentsOf: homeSettingsURL))) ?? HomeSettings()
        guard !homeSettings.url.isEmpty else { return }
        let account = homeSettings.url
        do { homeToken = try await Task.detached { try HomeCredentials.read(account, interactive: false) }.value }
        catch { homeStatus = error.localizedDescription }
    }
    func saveHomeSettings() throws { try JSONEncoder().encode(homeSettings).write(to: homeSettingsURL, options: .atomic) }
    func connectHome(url: String, token: String) async throws {
        guard !homeImporting else { throw MapleError.invalid("Home Assistant is already refreshing.") }
        homeImporting = true; defer { homeImporting = false }
        let client = try HomeAssistantClient(url: url, token: token)
        let records = try await client.states(onlyExposed: homeSettings.usesExposed)
        let account = client.baseURL.absoluteString
        try await Task.detached { try HomeCredentials.save(token, account: account) }.value
        if account != homeSettings.url { homeSettings.selected = [] }
        homeSettings.url = account; homeSettings.enabled = true; homeToken = token; homeEntities = records
        try saveHomeSettings()
        homeStatus = homeSettings.usesExposed ? "Connected · exposed entities will import automatically" : "Connected · choose entities to import"
    }
    func unlockHome() async throws {
        let account = homeSettings.url
        homeToken = try await Task.detached { try HomeCredentials.read(account, interactive: true) }.value
        await pollHome(force: true)
    }
    func selectHomeEntities(_ ids: [String]) async throws {
        guard !homeSettings.usesExposed, !homeImporting, Set(ids).isSubset(of: Set(homeEntities.map(\.id))) else { throw MapleError.invalid("Refresh the entity list before saving.") }
        let previous = homeSettings.selected
        homeSettings.selected = Array(Set(ids)).sorted()
        do { try saveHomeSettings() } catch { homeSettings.selected = previous; throw error }
        await pollHome(force: true)
    }
    func setHomeExposure(_ enabled: Bool) async throws {
        guard !homeImporting else { throw MapleError.invalid("Wait for Home Assistant to finish refreshing.") }
        let previous = homeSettings.exposedOnly
        homeSettings.exposedOnly = enabled
        do { try saveHomeSettings() } catch { homeSettings.exposedOnly = previous; throw error }
        homeEntities = []
        homeStatus = enabled ? "Using exposed entities" : "Choose entities manually"
        await pollHome(force: true)
    }
    func pauseHome() throws { homeSettings.enabled = false; try saveHomeSettings(); homeStatus = "Paused · imported context retained" }
    func pollHome(force: Bool = false) async {
        guard !homeImporting, homeSettings.enabled, let token = homeToken, let store,
              force || Date().timeIntervalSince(lastHomePoll) >= 60 else { return }
        homeImporting = true; defer { homeImporting = false; lastHomePoll = Date() }
        let selected = Set(homeSettings.selected), url = homeSettings.url, exposedOnly = homeSettings.usesExposed
        do {
            let records = try await HomeAssistantClient(url: url, token: token).states(onlyExposed: exposedOnly)
            guard homeSettings.enabled, homeSettings.url == url, Set(homeSettings.selected) == selected, homeSettings.usesExposed == exposedOnly else { return }
            homeEntities = records
            let effective = exposedOnly ? Set(records.map(\.id)) : selected
            guard !effective.isEmpty else { homeStatus = exposedOnly ? "No exposed entities · nothing imported" : "Connected · choose entities to import"; return }
            let changes = try await store.ingestSourceSnapshot(records.filter { effective.contains($0.id) }, connector: "home_assistant", scopeIDs: effective)
            homeStatus = "\(effective.count) \(exposedOnly ? "exposed" : "selected") · \(changes) changes · \(Date().formatted(date: .omitted, time: .shortened))"
            await refresh()
        } catch { homeStatus = error.localizedDescription }
    }
}
