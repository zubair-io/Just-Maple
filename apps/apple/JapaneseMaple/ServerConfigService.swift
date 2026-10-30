//
//  ServerConfigService.swift
//  JapaneseMaple
//
//  Server configuration and token management service
//

import Foundation
import Security
import Network

nonisolated final class ServerConfigService: @unchecked Sendable {
    static let shared = ServerConfigService()

    private static let defaultServer: ServerConfig = {
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

    private let lock = NSLock()
    private let defaults: UserDefaults
    private var effectiveURL: String?
    private var lastProbe: Date?
    private var monitor: NWPathMonitor?
    static let configurationDidChange = Notification.Name("MapleServerConfigurationDidChange")
    static let connectionDidChange = Notification.Name("MapleServerConnectionDidChange")
    static let openSettings = Notification.Name("MapleOpenServerSettings")

    init(defaults: UserDefaults = .standard, monitorNetwork: Bool = true) {
        self.defaults = defaults
        if monitorNetwork {
            let monitor = NWPathMonitor()
            monitor.pathUpdateHandler = { [weak self] _ in
                guard let self else { return }
                self.lock.withLock { self.effectiveURL = nil; self.lastProbe = nil }
                Task {
                    await self.resolveEndpoint()
                    NotificationCenter.default.post(name: Self.connectionDidChange, object: nil)
                }
            }
            monitor.start(queue: DispatchQueue(label: "maple.server-network"))
            self.monitor = monitor
        }
    }

    var hasConfiguredServer: Bool {
        guard let address = defaults.string(forKey: "maple.server.publicURL") else { return false }
        return (try? Self.normalizeAddress(address)) == address
    }
    var localURL: String? { defaults.string(forKey: "maple.server.localURL") }

    /// Only origins are accepted: no credentials, paths, query strings or fragments.
    static func normalizeAddress(_ input: String) throws -> String {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        let text = trimmed.contains("://") ? trimmed : "https://" + trimmed
        guard !trimmed.isEmpty, let url = URL(string: text), let host = url.host, !host.isEmpty,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path.isEmpty || url.path == "/",
              url.scheme == "https" || (url.scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(host))
        else { throw ConfigurationError.invalidAddress }
        var parts = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        parts.host = host.lowercased()
        parts.path = ""
        if parts.port == 443 && parts.scheme == "https" { parts.port = nil }
        return parts.string!
    }

    enum ConfigurationError: LocalizedError {
        case invalidAddress, unavailable, differentServer
        var errorDescription: String? {
            switch self {
            case .invalidAddress: return "Enter a server hostname or HTTPS origin, without a path."
            case .unavailable: return "Could not reach that JapaneseMaple server over a trusted HTTPS connection."
            case .differentServer: return "The local address belongs to a different JapaneseMaple server."
            }
        }
    }

    struct ServerIdentity: Decodable, Sendable {
        let instanceId: String
        let publicUrl: String
    }

    static func identity(at origin: String, session: URLSession = .shared) async throws -> ServerIdentity {
        var request = URLRequest(url: URL(string: origin + "/api/server-info")!)
        request.timeoutInterval = 2
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              http.url?.scheme == URL(string: origin)?.scheme,
              http.url?.host == URL(string: origin)?.host,
              http.url?.port == URL(string: origin)?.port else { throw ConfigurationError.unavailable }
        let identity = try JSONDecoder().decode(ServerIdentity.self, from: data)
        guard !identity.instanceId.isEmpty else { throw ConfigurationError.unavailable }
        return identity
    }

    func configure(publicAddress: String, localAddress: String, session: URLSession = .shared) async throws {
        let primary = try Self.normalizeAddress(publicAddress)
        let local = localAddress.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? nil : try Self.normalizeAddress(localAddress)
        let identity = try await Self.identity(at: primary, session: session)
        guard try Self.normalizeAddress(identity.publicUrl) == primary else { throw ConfigurationError.differentServer }
        // A local server may be unreachable while away from home. It is never used until verified.
        if let local, let candidate = try? await Self.identity(at: local, session: session),
           candidate.instanceId != identity.instanceId || candidate.publicUrl != identity.publicUrl {
            throw ConfigurationError.differentServer
        }
        lock.withLock {
            defaults.set(primary, forKey: "maple.server.publicURL")
            defaults.set(local, forKey: "maple.server.localURL")
            defaults.set(identity.instanceId, forKey: "maple.server.instanceId")
            effectiveURL = nil
            lastProbe = nil
        }
        await resolveEndpoint(session: session)
        NotificationCenter.default.post(name: Self.configurationDidChange, object: nil)
    }

    /// Anonymous probe first; bearer tokens stay keyed to the public identity.
    @discardableResult
    func resolveEndpoint(session: URLSession = .shared) async -> String {
        let primary = getActiveServer().url
        let local = localURL
        if let cached = lock.withLock({ () -> String? in
            guard let lastProbe, Date().timeIntervalSince(lastProbe) < 30 else { return nil }
            return effectiveURL ?? primary
        }) { return cached }
        var resolved: String?
        if let local, let expected = defaults.string(forKey: "maple.server.instanceId"),
           let identity = try? await Self.identity(at: local, session: session),
           identity.instanceId == expected, identity.publicUrl == primary {
            resolved = local
        }
        lock.withLock {
            if getConfiguredURL() == primary && localURL == local {
                effectiveURL = resolved
                lastProbe = Date()
            }
        }
        return resolved ?? primary
    }

    private func getConfiguredURL() -> String { defaults.string(forKey: "maple.server.publicURL") ?? Self.defaultServer.url }

    func getEffectiveWebURL() -> String { lock.withLock { effectiveURL ?? getConfiguredURL() } }


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
        if let configured = defaults.string(forKey: "maple.server.publicURL") {
            return ServerConfig(name: URL(string: configured)?.host ?? "Server", url: configured)
        }
        return Self.defaultServer
    }

    func getAPIUrl() -> String {
        lock.withLock { effectiveURL ?? getActiveServer().getAPIUrl() }
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
        // A legacy keychain session does not select a server for a new installation.
        guard serverId != nil || hasConfiguredServer else { return nil }
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
