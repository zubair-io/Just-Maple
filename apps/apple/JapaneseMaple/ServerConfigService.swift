//
//  ServerConfigService.swift
//  JapaneseMaple
//
//  Server configuration and token management service
//

import Foundation
import Security

class ServerConfigService {
    static let shared = ServerConfigService()

    private let userDefaults = UserDefaults(suiteName: "group.com.just.maple.JapaneseMaple") ?? UserDefaults.standard
    private let serverListKey = "saved_servers"
    private let activeServerKey = "active_server"
    private let sharedServersKey = "saved_servers_shared"

    // Default servers (ID is derived from URL for consistency)
    private let defaultServers: [ServerConfig] = [
        ServerConfig(name: "Production", url: "https://justmaple.app", apiUrl: "https://paperbark.justmaple.app", isCustom: false),
    ]

    private init() {}

    // MARK: - Server Management

    struct ServerConfig: Codable {
        let id: String
        let name: String
        let url: String
        let apiUrl: String?  // Optional separate API URL
        let isCustom: Bool

        /// Initialize a server config. ID is always derived from URL for consistency
        /// with token storage and push notification registration.
        init(name: String, url: String, apiUrl: String? = nil, isCustom: Bool) {
            // Use URL as the ID for consistency - tokens are stored by URL
            self.id = url
            self.name = name
            self.url = url
            self.apiUrl = apiUrl
            self.isCustom = isCustom
        }

        /// Get the API URL (uses apiUrl if set, otherwise falls back to url)
        func getAPIUrl() -> String {
            return apiUrl ?? url
        }
    }

    func getServers() -> [ServerConfig] {
        guard let data = userDefaults.data(forKey: serverListKey),
              let customServers = try? JSONDecoder().decode([ServerConfig].self, from: data) else {
            return defaultServers
        }
        return defaultServers + customServers
    }

    func addServer(_ server: ServerConfig) {
        var servers = getCustomServers()
        servers.append(server)
        saveCustomServers(servers)
        syncServersToSharedStorage()
    }

    func removeServer(id: String) {
        var servers = getCustomServers()
        servers.removeAll { $0.id == id }
        saveCustomServers(servers)
        syncServersToSharedStorage()
    }
    
    /// Sync server configurations to shared storage for extension access
    func syncServersToSharedStorage() {
        let servers = getServers()
        if let data = try? JSONEncoder().encode(servers) {
            userDefaults.set(data, forKey: sharedServersKey)
            print("[ServerConfigService] Synced \(servers.count) servers to shared storage")
        }
    }

    func getActiveServer() -> ServerConfig {
        if let serverID = userDefaults.string(forKey: activeServerKey),
           let server = getServers().first(where: { $0.id == serverID }) {
            return server
        }
        // Default to production
        return defaultServers[0]
    }

    func setActiveServer(id: String) {
        userDefaults.set(id, forKey: activeServerKey)
    }

    func getAPIUrl() -> String {
        let activeServer = getActiveServer()
        return activeServer.getAPIUrl()
    }

    func validateServer(url: String) async throws -> Bool {
        guard let url = URL(string: url) else {
            throw ServerError.invalidURL
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 10

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw ServerError.serverNotReachable
        }

        // Check if HTML title contains "Just Maple"
        guard let html = String(data: data, encoding: .utf8),
              html.contains("<title>") else {
            throw ServerError.invalidResponse
        }

        // Extract title content
        if let titleRange = html.range(of: "<title>.*?</title>", options: .regularExpression),
           html[titleRange].localizedCaseInsensitiveContains("Just Maple") {
            return true
        }

        throw ServerError.invalidServer
    }

    // MARK: - Token Management (Keychain)

    private let keychainService = "com.just.maple.JapaneseMaple"
    private let tokenKeyPrefix = "bearer_token"
    /// Shared keychain access group for iOS + Watch. Omitted on macOS to avoid
    /// the login-keychain password prompt (macOS doesn't need cross-target sharing).
    private let keychainAccessGroup: String? = {
        #if os(iOS)
        return "group.com.just.maple.JapaneseMaple"
        #else
        return nil
        #endif
    }()

    /// Get the keychain account name for a server
    private func tokenKey(for serverId: String?) -> String {
        if let serverId = serverId, !serverId.isEmpty {
            return "\(tokenKeyPrefix):\(serverId)"
        }
        // Fallback to active server URL if no serverId provided
        return "\(tokenKeyPrefix):\(getActiveServer().url)"
    }

    /// Build a keychain query dictionary, conditionally including the access group.
    private func keychainQuery(account: String, extras: [String: Any] = [:]) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account,
        ]
        if let group = keychainAccessGroup {
            query[kSecAttrAccessGroup as String] = group
        }
        for (key, value) in extras {
            query[key] = value
        }
        return query
    }

    func saveToken(_ token: String, serverId: String? = nil) -> Bool {
        let data = token.data(using: .utf8)!
        let account = tokenKey(for: serverId)

        // Delete existing token first
        let deleteQuery = keychainQuery(account: account)
        SecItemDelete(deleteQuery as CFDictionary)

        // Add new token
        let addQuery = keychainQuery(account: account, extras: [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ])

        let status = SecItemAdd(addQuery as CFDictionary, nil)
        let success = status == errSecSuccess

        if success {
            print("[ServerConfigService] Saved token to keychain for account: \(account)")
        } else {
            print("[ServerConfigService] Failed to save token: \(status)")
        }

        return success
    }

    func getToken(serverId: String? = nil) -> String? {
        let account = tokenKey(for: serverId)

        let query = keychainQuery(account: account, extras: [
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ])

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess,
              let data = result as? Data,
              let token = String(data: data, encoding: .utf8) else {
            return nil
        }

        return token
    }

    func clearToken(serverId: String? = nil) -> Bool {
        let account = tokenKey(for: serverId)

        let query = keychainQuery(account: account)

        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }

    // MARK: - Private Helpers

    private func getCustomServers() -> [ServerConfig] {
        guard let data = userDefaults.data(forKey: serverListKey),
              let servers = try? JSONDecoder().decode([ServerConfig].self, from: data) else {
            return []
        }
        return servers
    }

    private func saveCustomServers(_ servers: [ServerConfig]) {
        if let data = try? JSONEncoder().encode(servers) {
            userDefaults.set(data, forKey: serverListKey)
        }
    }

    enum ServerError: LocalizedError {
        case invalidURL
        case serverNotReachable
        case invalidResponse
        case invalidServer

        var errorDescription: String? {
            switch self {
            case .invalidURL:
                return "Invalid server URL"
            case .serverNotReachable:
                return "Server is not reachable"
            case .invalidResponse:
                return "Invalid response from server"
            case .invalidServer:
                return "Server does not appear to be a Just Maple instance"
            }
        }
    }
}
