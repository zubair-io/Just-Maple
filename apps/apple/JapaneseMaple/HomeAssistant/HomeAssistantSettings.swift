//
//  HomeAssistantSettings.swift
//  JapaneseMaple
//
//  Where Home Assistant is, and the long-lived access token to reach it.
//
//  The address is a setting; the token lives in the Keychain only (this Mac, never
//  synced). Neither is ever uploaded, and the token is never logged or shown again.
//

#if os(macOS)
import Foundation
import Security

/// The Keychain, behind a protocol so tests never touch the real one.
nonisolated protocol HomeCredentialStore: Sendable {
    func token(for account: String) throws -> String?
    func save(_ token: String, for account: String) throws
    func delete(account: String) throws
}

nonisolated enum HomeAssistantError: LocalizedError, Equatable {
    case invalidURL
    case insecureURL
    case invalidToken
    case notConfigured
    case authInvalid
    case notAdmin
    case unreachable(String)
    case timedOut
    case protocolError(String)
    case keychain

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            "Enter Home Assistant's address, like http://homeassistant.local:8123, without a user name or anything after the port."
        case .insecureURL:
            "Use https:// for a Home Assistant outside your home network. http:// works for local addresses."
        case .invalidToken:
            "Enter a long-lived access token from your Home Assistant profile (Security → Long-lived access tokens)."
        case .notConfigured:
            "Set up Home Assistant in Settings → Devices on this Mac."
        case .authInvalid:
            "Home Assistant didn't accept the access token. Create a new long-lived access token and try again."
        case .notAdmin:
            "Just Maple couldn't read which entities are exposed. Use a token from an administrator account."
        case .unreachable(let detail):
            "Couldn't reach Home Assistant (\(detail)). Check the address and that this Mac is on your home network."
        case .timedOut:
            "Home Assistant didn't answer in time."
        case .protocolError(let detail):
            "Home Assistant sent something unexpected: \(detail)"
        case .keychain:
            "Couldn't save the access token in the Keychain."
        }
    }
}

nonisolated struct HomeAssistantSettings: Equatable, Sendable {
    static let urlKey = "homeAssistant.url"

    /// The base address, e.g. `http://homeassistant.local:8123`.
    var url: URL

    /// Checks an address the way MapleCore does: http(s) only, no credentials, query or
    /// fragment, and https unless it's a local address.
    static func validatedURL(_ text: String) throws -> URL {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var parts = URLComponents(string: trimmed),
            let scheme = parts.scheme?.lowercased(), ["http", "https"].contains(scheme),
            let host = parts.host?.lowercased(), !host.isEmpty,
            parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil
        else { throw HomeAssistantError.invalidURL }
        let octets = host.split(separator: ".").compactMap { Int($0) }
        let privateIPv4 =
            octets.count == 4 && octets.allSatisfy { (0...255).contains($0) }
            && (octets[0] == 10 || octets[0] == 127 || (octets[0] == 192 && octets[1] == 168)
                || (octets[0] == 172 && (16...31).contains(octets[1])))
        // The same local addresses App Transport Security lets through over http.
        let local =
            privateIPv4 || host == "localhost" || host == "[::1]" || host == "::1"
            || host.hasSuffix(".local")
        guard scheme == "https" || local else { throw HomeAssistantError.insecureURL }
        parts.scheme = scheme
        parts.host = host
        // Keep a path prefix (a reverse proxy) but drop the trailing slash.
        while parts.path.hasSuffix("/") { parts.path.removeLast() }
        guard let url = parts.url else { throw HomeAssistantError.invalidURL }
        return url
    }

    static func validatedToken(_ token: String) throws -> String {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.utf8.count <= 8192,
            trimmed.unicodeScalars.allSatisfy({ $0.value > 32 && $0.value < 127 })
        else { throw HomeAssistantError.invalidToken }
        return trimmed
    }

    /// `ws(s)://host/api/websocket`.
    var webSocketURL: URL {
        var parts = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        parts.scheme = parts.scheme == "https" ? "wss" : "ws"
        parts.path += "/api/websocket"
        return parts.url!
    }

    /// The Keychain account for this server's token.
    var account: String { url.absoluteString }
}

/// The saved address (UserDefaults) and token (Keychain), read and written together.
nonisolated struct HomeAssistantSettingsStore: @unchecked Sendable {
    let defaults: UserDefaults
    let credentials: HomeCredentialStore

    init(defaults: UserDefaults = .standard, credentials: HomeCredentialStore = KeychainHomeCredentials()) {
        self.defaults = defaults
        self.credentials = credentials
    }

    var settings: HomeAssistantSettings? {
        guard let text = defaults.string(forKey: HomeAssistantSettings.urlKey),
            let url = try? HomeAssistantSettings.validatedURL(text)
        else { return nil }
        return HomeAssistantSettings(url: url)
    }

    /// The address and token, when both are saved.
    func load() -> (settings: HomeAssistantSettings, token: String)? {
        guard let settings, let token = try? credentials.token(for: settings.account), !token.isEmpty
        else { return nil }
        return (settings, token)
    }

    /// Saves both. A different address forgets the old one's token.
    func save(_ settings: HomeAssistantSettings, token: String) throws {
        if let previous = self.settings, previous.account != settings.account {
            try? credentials.delete(account: previous.account)
        }
        try credentials.save(token, for: settings.account)
        defaults.set(settings.url.absoluteString, forKey: HomeAssistantSettings.urlKey)
    }

    func remove() {
        if let settings { try? credentials.delete(account: settings.account) }
        defaults.removeObject(forKey: HomeAssistantSettings.urlKey)
    }
}

/// Generic passwords in the login Keychain, for this Mac only.
nonisolated struct KeychainHomeCredentials: HomeCredentialStore {
    static let service = "app.justmaple.home-assistant"

    private func query(_ account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: account,
        ]
    }

    func token(for account: String) throws -> String? {
        var query = query(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &value)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = value as? Data else { throw HomeAssistantError.keychain }
        return String(data: data, encoding: .utf8)
    }

    func save(_ token: String, for account: String) throws {
        let data = Data(token.utf8)
        var add = query(account)
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        add[kSecAttrSynchronizable as String] = false
        var status = SecItemAdd(add as CFDictionary, nil)
        if status == errSecDuplicateItem {
            status = SecItemUpdate(
                query(account) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        }
        guard status == errSecSuccess else { throw HomeAssistantError.keychain }
    }

    func delete(account: String) throws {
        let status = SecItemDelete(query(account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw HomeAssistantError.keychain
        }
    }
}
#endif
