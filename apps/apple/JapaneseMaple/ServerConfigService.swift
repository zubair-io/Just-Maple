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

    private let server: ServerConfig = {
        #if DEBUG
        #if os(macOS)
        // MAPLE_DEV_SERVER_URL lets a worktree's dev server run beside the main one,
        // e.g. `open JapaneseMaple.app --env MAPLE_DEV_SERVER_URL=http://localhost:4300`.
        return ServerConfig(
            name: "Development",
            url: ProcessInfo.processInfo.environment["MAPLE_DEV_SERVER_URL"] ?? "http://localhost:4200"
        )
        #else
        // Set at build time to reach a dev server on the Mac over Wi-Fi, e.g.
        // `xcodebuild … MAPLE_DEV_SERVER_URL=http://192.168.0.91:4301`.
        let configured = Bundle.main.object(forInfoDictionaryKey: "MapleDevServerURL") as? String
        return ServerConfig(
            name: "Development",
            url: configured?.isEmpty == false ? configured! : "http://192.168.1.123:4200"
        )
        #endif
        #else
        return ServerConfig(
            name: "Production",
            url: "https://justmaple.app",
            apiUrl: "https://paperbark.justmaple.app"
        )
        #endif
    }()

    private init() {}

    // MARK: - Server Configuration

    struct ServerConfig {
        let id: String
        let name: String
        let url: String
        let apiUrl: String?

        init(name: String, url: String, apiUrl: String? = nil) {
            self.id = url
            self.name = name
            self.url = url
            self.apiUrl = apiUrl
        }

        /// Get the API URL (uses apiUrl if set, otherwise falls back to url)
        func getAPIUrl() -> String {
            return apiUrl ?? url
        }
    }

    func getActiveServer() -> ServerConfig {
        return server
    }

    func getAPIUrl() -> String {
        return server.getAPIUrl()
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
        return "\(tokenKeyPrefix):\(server.url)"
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

    /// Posted after the bearer token is saved or cleared (sign-in, sign-out).
    static let tokenDidChange = Notification.Name("MapleTokenDidChange")

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
            NotificationCenter.default.post(name: Self.tokenDidChange, object: nil)
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

        if status == errSecSuccess,
           let data = result as? Data,
           let token = String(data: data, encoding: .utf8) {
            return token
        }

        #if DEBUG && os(macOS)
        // WKWebView cannot complete a platform-passkey assertion for a localhost
        // development origin. Reuse the existing production session in debug builds
        // so local UI work does not require exporting or duplicating credentials.
        if serverId == "http://localhost:4200" {
            return getToken(serverId: "https://justmaple.app")
        }
        #endif

        return nil
    }

    func clearToken(serverId: String? = nil) -> Bool {
        let account = tokenKey(for: serverId)

        let query = keychainQuery(account: account)

        let status = SecItemDelete(query as CFDictionary)
        NotificationCenter.default.post(name: Self.tokenDidChange, object: nil)
        return status == errSecSuccess || status == errSecItemNotFound
    }
}
