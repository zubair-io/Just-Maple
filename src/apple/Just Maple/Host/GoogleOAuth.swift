import AppKit
import CryptoKit
import Foundation
import LocalAuthentication
import MapleCore
import Network
import Security

struct GoogleClientConfiguration: Codable, Sendable {
    struct Installed: Codable, Sendable { let client_id: String; let client_secret: String }
    let installed: Installed
    static func load(_ url: URL) throws -> Self {
        let data = try Data(contentsOf: url)
        guard data.count < 64000, let config = try? JSONDecoder().decode(Self.self, from: data),
              config.installed.client_id.hasSuffix(".apps.googleusercontent.com"), !config.installed.client_secret.isEmpty else {
            throw MapleError.invalid("Choose a Google Desktop app OAuth client JSON file.")
        }
        return config
    }
}

struct GoogleTokens: Codable, Sendable {
    var access: String
    var refresh: String
    var expires: Date
    var scopes: [String]
}

enum GoogleCredentials {
    static let service = "com.just.maple.google-oauth"
    static func query(_ account: String) -> [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account] }
    static func read(_ account: String, interactive: Bool) throws -> GoogleTokens? {
        var query = query(account); query[kSecReturnData as String] = true
        let auth = LAContext(); auth.interactionNotAllowed = !interactive
        query[kSecUseAuthenticationContext as String] = auth
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw MapleError.invalid("Unlock the saved Google connection, or reconnect Google.") }
        return try JSONDecoder().decode(GoogleTokens.self, from: data)
    }
    static func save(_ tokens: GoogleTokens, account: String) throws {
        let data = try JSONEncoder().encode(tokens)
        var item = query(account); item[kSecValueData as String] = data
        let status = SecItemAdd(item as CFDictionary, nil)
        let final = status == errSecDuplicateItem ? SecItemUpdate(query(account) as CFDictionary, [kSecValueData as String: data] as CFDictionary) : status
        guard final == errSecSuccess else { throw MapleError.invalid("Could not save Google credentials in Keychain.") }
    }
    static func remove(_ account: String) throws {
        let status = SecItemDelete(query(account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw MapleError.invalid("Could not remove Google credentials from Keychain.") }
    }
}

@MainActor
final class GoogleOAuth {
    static let contactsScope = "https://www.googleapis.com/auth/contacts.readonly"
    static let scopes = [contactsScope, "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/calendar.events.readonly", "https://www.googleapis.com/auth/calendar.calendarlist.readonly"]
    private var listener: NWListener?
    private var continuation: CheckedContinuation<(String, String), Error>?
    private var timeout: Task<Void, Never>?
    private var expectedState = ""
    private var redirect = ""
    private var connections: [NWConnection] = []
    static func random() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw MapleError.invalid("Could not initialize secure Google sign-in.") }
        return base64(Data(bytes))
    }
    static func base64(_ data: Data) -> String { data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
    static func form(_ fields: [String: String]) -> Data {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        return Data(fields.sorted { $0.key < $1.key }.map { $0.key.addingPercentEncoding(withAllowedCharacters: allowed)! + "=" + $0.value.addingPercentEncoding(withAllowedCharacters: allowed)! }.joined(separator: "&").utf8)
    }
    func authorize(_ config: GoogleClientConfiguration) async throws -> GoogleTokens {
        guard continuation == nil else { throw MapleError.invalid("Google sign-in is already open.") }
        expectedState = try Self.random()
        let verifier = try Self.random(), challenge = Self.base64(Data(SHA256.hash(data: Data(verifier.utf8))))
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        let listener = try NWListener(using: parameters); self.listener = listener
        let (code, redirect) = try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                listener.stateUpdateHandler = { [weak self] state in
                    Task { @MainActor in
                        guard let self, self.continuation != nil else { return }
                        switch state {
                        case .ready:
                            guard let port = listener.port else { self.finish(.failure(MapleError.invalid("Could not start Google sign-in."))); return }
                            self.redirect = "http://127.0.0.1:\(port.rawValue)/oauth/callback"
                            var url = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
                            url.queryItems = ["client_id": config.installed.client_id, "redirect_uri": self.redirect, "response_type": "code",
                                "scope": Self.scopes.joined(separator: " "), "state": self.expectedState, "code_challenge": challenge,
                                "code_challenge_method": "S256", "access_type": "offline", "prompt": "consent select_account"].map { URLQueryItem(name: $0.key, value: $0.value) }
                            if !NSWorkspace.shared.open(url.url!) { self.finish(.failure(MapleError.invalid("Could not open the browser for Google sign-in."))) }
                        case .failed: self.finish(.failure(MapleError.invalid("Could not start the local Google sign-in callback.")))
                        default: break
                        }
                    }
                }
                listener.newConnectionHandler = { [weak self] connection in
                    Task { @MainActor in
                        guard let self, self.connections.count < 20, self.continuation != nil else { connection.cancel(); return }
                        self.connections.append(connection)
                        connection.start(queue: .main); self.receive(connection, data: Data())
                    }
                }
                timeout = Task { [weak self] in
                    do { try await Task.sleep(for: .seconds(300)); self?.cancel() } catch {}
                }
                listener.start(queue: .main)
            }
        } onCancel: { Task { @MainActor in self.cancel() } }
        return try await Self.exchange(config, fields: ["code": code, "code_verifier": verifier, "redirect_uri": redirect, "grant_type": "authorization_code"], previous: nil)
    }
    /// Only a matching state and callback path can complete this sign-in attempt.
    static func callback(_ target: String, expectedState: String) throws -> String? {
        guard target.hasPrefix("/oauth/callback?"), let parts = URLComponents(string: "http://127.0.0.1" + target), parts.path == "/oauth/callback" else { return nil }
        let fields = parts.queryItems ?? []
        guard fields.filter({ $0.name == "state" }).count == 1, fields.first(where: { $0.name == "state" })?.value == expectedState else { return nil }
        if fields.contains(where: { $0.name == "error" }) { throw MapleError.invalid("Google sign-in was not approved. You can reconnect when ready.") }
        guard fields.filter({ $0.name == "code" }).count == 1, let code = fields.first(where: { $0.name == "code" })?.value, !code.isEmpty else { return nil }
        return code
    }
    private func receive(_ connection: NWConnection, data: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] chunk, _, complete, error in
            Task { @MainActor in
                guard let self, self.continuation != nil else { connection.cancel(); return }
                var data = data; if let chunk { data.append(chunk) }
                guard data.count <= 16384 else { connection.cancel(); return }
                if let text = String(data: data, encoding: .utf8), text.contains("\r\n\r\n") {
                    let line = text.components(separatedBy: "\r\n")[0].split(separator: " ")
                    do {
                        let code = line.count == 3 && line[0] == "GET" ? try Self.callback(String(line[1]), expectedState: self.expectedState) : nil
                        let body = code == nil ? "This sign-in callback is invalid. Return to Just Maple." : "Google sign-in received. You can close this tab and return to Just Maple."
                        self.reply(connection, body: body)
                        if let code { self.finish(.success((code, self.redirect)), keeping: connection) }
                    } catch { self.reply(connection, body: "Sign-in was not approved. Return to Just Maple."); self.finish(.failure(error), keeping: connection) }
                } else if complete || error != nil { connection.cancel() }
                else { self.receive(connection, data: data) }
            }
        }
    }
    private func reply(_ connection: NWConnection, body: String) {
        let response = "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: \(body.utf8.count)\r\n\r\n\(body)"
        connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in connection.cancel() })
    }
    func cancel() { finish(.failure(MapleError.invalid("Google sign-in canceled or timed out. Try connecting again."))) }
    private func finish(_ result: Result<(String, String), Error>, keeping: NWConnection? = nil) {
        let completion = continuation; continuation = nil
        timeout?.cancel(); timeout = nil; listener?.cancel(); listener = nil
        for connection in connections where connection !== keeping { connection.cancel() }; connections = []
        completion?.resume(with: result)
    }
    static func refresh(_ config: GoogleClientConfiguration, tokens: GoogleTokens) async throws -> GoogleTokens {
        try await exchange(config, fields: ["refresh_token": tokens.refresh, "grant_type": "refresh_token"], previous: tokens)
    }
    static func exchange(_ config: GoogleClientConfiguration, fields: [String: String], previous: GoogleTokens?, transport: any HTTPTransport = GoogleHTTPTransport()) async throws -> GoogleTokens {
        var fields = fields; fields["client_id"] = config.installed.client_id; fields["client_secret"] = config.installed.client_secret
        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"; request.httpBody = form(fields); request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        let (data, status) = try await transport.send(request)
        guard status == 200, data.count < 64000 else { throw MapleError.provider("Google token exchange failed. Reconnect Google and check your OAuth client configuration.") }
        struct Response: Decodable { let access_token: String; let refresh_token: String?; let expires_in: Double; let scope: String? }
        let result = try JSONDecoder().decode(Response.self, from: data)
        let scopes = result.scope?.split(separator: " ").map(String.init) ?? previous?.scopes ?? []
        guard Set(previous?.scopes ?? Self.scopes).isSubset(of: Set(scopes)), let refresh = result.refresh_token ?? previous?.refresh,
              !refresh.isEmpty, !result.access_token.isEmpty, result.expires_in > 0, result.expires_in.isFinite else {
            throw MapleError.provider("Google did not grant all requested read-only permissions. Reconnect and select Gmail, Calendar, and Contacts permissions.")
        }
        return GoogleTokens(access: result.access_token, refresh: refresh, expires: Date().addingTimeInterval(result.expires_in), scopes: scopes)
    }
}
