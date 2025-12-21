//
//  SignalRManager.swift
//  Just Maple Watch App
//
//  SignalR client for real-time messaging using official SignalR Swift SDK
//

import Foundation
import Combine
import SignalRClient

/// Chat event from SignalR
struct ChatEvent: Codable {
    let action: String  // 'message', 'typing', 'edited', 'deleted', etc.
    let data: ChatEventData?
    let tagId: String
    let userId: String
    let timestamp: String
}

/// AnyCodable wrapper for type-erased values (SignalR-specific)
struct ChatEventData: Codable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let array = try? container.decode([ChatEventData].self) {
            value = array.map { $0.value }
        } else if let dict = try? container.decode([String: ChatEventData].self) {
            value = dict.mapValues { $0.value }
        } else {
            value = NSNull()
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let string as String:
            try container.encode(string)
        case let bool as Bool:
            try container.encode(bool)
        case let array as [Any]:
            try container.encode(array.map { ChatEventData($0) })
        case let dict as [String: Any]:
            try container.encode(dict.mapValues { ChatEventData($0) })
        default:
            try container.encodeNil()
        }
    }
}

/// Connection status
enum ConnectionStatus: String {
    case disconnected
    case connecting
    case connected
    case reconnecting
}

@MainActor
class SignalRManager: ObservableObject {
    static let shared = SignalRManager()

    // Configuration
    private let negotiateURL = "https://autumn-blaze.justmaple.app/api/signalr"

    // State
    @Published var connectionStatus: ConnectionStatus = .disconnected
    @Published var subscribedTags: [String] = []
    @Published var debugLogs: [String] = []

    // Event publishers
    private let _chatEvents = PassthroughSubject<ChatEvent, Never>()
    var chatEvents: AnyPublisher<ChatEvent, Never> {
        _chatEvents.eraseToAnyPublisher()
    }

    // SignalR Hub Connection
    private var hubConnection: HubConnection?
    private var userId: String?

    private init() {}

    // MARK: - Debug Logging

    private func log(_ message: String) {
        print(message)
        debugLogs.append(message)
        // Keep only last 50 logs to avoid memory issues
        if debugLogs.count > 50 {
            debugLogs.removeFirst()
        }
    }

    // MARK: - JWT Decoding

    /// Extract user ID from JWT token (from "sub" claim)
    private func getUserIdFromToken(_ token: String) -> String? {
        let parts = token.split(separator: ".")
        guard parts.count == 3 else { return nil }

        // Decode the payload (second part)
        let payloadBase64 = String(parts[1])
        // Add padding if needed
        var base64 = payloadBase64
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 {
            base64.append("=")
        }

        guard let data = Data(base64Encoded: base64),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let sub = json["sub"] as? String
        else {
            return nil
        }

        return sub
    }

    // MARK: - Negotiate

    /// Negotiate with server to get SignalR connection info
    private func negotiate(userId: String, token: String) async throws -> (url: String, accessToken: String) {
        let urlString = "\(negotiateURL)?userId=\(userId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")"
        log("[SignalR] 📡 Negotiating with: \(urlString)")

        guard let url = URL(string: urlString) else {
            log("[SignalR] ❌ Invalid negotiate URL")
            throw SignalRError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        log("[SignalR] 📤 Sending negotiate request...")
        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            log("[SignalR] ❌ Invalid HTTP response")
            throw SignalRError.negotiateFailed
        }

        log("[SignalR] 📥 Negotiate response status: \(httpResponse.statusCode)")

        guard (200...299).contains(httpResponse.statusCode) else {
            if let responseString = String(data: data, encoding: .utf8) {
                log("[SignalR] ❌ Negotiate failed: \(responseString)")
            }
            throw SignalRError.negotiateFailed
        }

        let connectionInfo = try JSONDecoder().decode(NegotiateResponse.self, from: data)
        log("[SignalR] ✅ Negotiate successful")
        log("[SignalR] 📍 SignalR URL: \(connectionInfo.url)")
        log("[SignalR] 🔑 SignalR token length: \(connectionInfo.accessToken.count) chars")

        return (connectionInfo.url, connectionInfo.accessToken)
    }

    // MARK: - Public API

    /// Connect to SignalR
    func connect() async {
        guard connectionStatus == .disconnected else {
            log("[SignalR] ⚠️ Already connected or connecting")
            return
        }

        connectionStatus = .connecting
        log("[SignalR] 🔄 Starting connection...")

        do {
            // Get authentication token
            guard let token = KeychainHelper.shared.getToken() else {
                log("[SignalR] ❌ No token found in keychain")
                throw SignalRError.noToken
            }

            // Extract user ID from JWT
            if userId == nil {
                log("[SignalR] 📋 Extracting user ID from JWT...")
                if let extractedUserId = getUserIdFromToken(token) {
                    userId = extractedUserId
                    log("[SignalR] ✅ Got user ID from JWT: \(extractedUserId)")
                } else {
                    log("[SignalR] ❌ Failed to decode user ID from JWT")
                    throw SignalRError.noUserId
                }
            }

            guard let userId = userId else {
                throw SignalRError.noUserId
            }

            // Negotiate to get SignalR connection URL and access token
            let (signalrUrl, signalrToken) = try await negotiate(userId: userId, token: token)

            // Build connection URL with access token
            // The signalrUrl from negotiate already includes query params like ?hub=chat

            log("[SignalR] 📡 Connecting to SignalR service...")
            log("[SignalR] 🔗 Base URL: \(signalrUrl)")

//             Create hub connection with automatic reconnect
            
            var options = HttpConnectionOptions()
            options.accessTokenFactory = { signalrToken }

            let connection = HubConnectionBuilder()
                .withUrl(url: signalrUrl, options: options)
                .withAutomaticReconnect()
                .withKeepAliveInterval(keepAliveInterval: 15)
                .withServerTimeout(serverTimeout: 30)
                .build()
            

            // Register event handler for incoming messages
            log("[SignalR] 📡 Registering 'newMessage' event handler...")

            // Try receiving as ChatEvent directly (like web client)
            await connection.on("newMessage") { [weak self] (event: ChatEvent) in
                guard let self = self else {
                    print("[SignalR] ⚠️ Self is nil in message handler")
                    return
                }
                print("[SignalR] 🔔🔔🔔 MESSAGE RECEIVED AS OBJECT!")
                await MainActor.run {
                    self.log("[SignalR] 📬 RECEIVED - Action: \(event.action), Tag: \(event.tagId), User: \(event.userId)")
                    self.log("[SignalR] 📤 Publishing event to subscribers...")
                    self._chatEvents.send(event)
                    self.log("[SignalR] ✅ Event published successfully")
                }
            }

            // Start connection
            log("[SignalR] 🚀 Starting hub connection...")
            try await connection.start()

            log("[SignalR] ✅ Hub connection started successfully!")
            log("[SignalR] 📡 Event handler 'newMessage' is registered and listening...")
            log("[SignalR] ⏳ Waiting for messages from server...")

            // Handle reconnecting state
            await connection.onReconnecting { [weak self] (error: Error?) in
                await MainActor.run {
                    if let error = error {
                        self?.log("[SignalR] 🔄 Reconnecting due to error: \(error)")
                    } else {
                        self?.log("[SignalR] 🔄 Reconnecting...")
                    }
                    self?.connectionStatus = .reconnecting
                }
            }

            // Handle reconnected state
            await connection.onReconnected { [weak self] in
                await MainActor.run {
                    self?.log("[SignalR] ✅ Reconnected successfully")
                    self?.connectionStatus = .connected

                    // Resubscribe to all tags
                    let tagsToResubscribe = self?.subscribedTags ?? []
                    self?.subscribedTags.removeAll()
                    for tagId in tagsToResubscribe {
                        self?.subscribe(to: tagId)
                    }
                }
            }

            hubConnection = connection
            connectionStatus = .connected
            log("[SignalR] ✅ Connected successfully")

        } catch {
            log("[SignalR] ❌ Connection failed: \(error)")
            connectionStatus = .disconnected
            hubConnection = nil
        }
    }

    /// Disconnect from SignalR
    func disconnect() {
        log("[SignalR] 🔌 Disconnecting...")

        Task {
            await hubConnection?.stop()
            await MainActor.run {
                hubConnection = nil
                connectionStatus = .disconnected
                subscribedTags.removeAll()
                userId = nil
                log("[SignalR] ✅ Disconnected")
            }
        }
    }

    /// Subscribe to a tag
    func subscribe(to tagId: String) {
        guard connectionStatus == .connected else {
            log("[SignalR] ⚠️ Cannot subscribe - not connected")
            return
        }
        guard !subscribedTags.contains(tagId) else {
            log("[SignalR] ⚠️ Already subscribed to tag: \(tagId)")
            return
        }

        Task {
            do {
                log("[SignalR] 📥 Subscribing to tag: \(tagId)")
                try await hubConnection?.invoke(method: "Subscribe", arguments: tagId)
                await MainActor.run {
                    subscribedTags.append(tagId)
                    log("[SignalR] ✅ Subscribed to tag: \(tagId)")
                }
            } catch {
                await MainActor.run {
                    log("[SignalR] ❌ Failed to subscribe: \(error)")
                }
            }
        }
    }

    /// Unsubscribe from a tag
    func unsubscribe(from tagId: String) {
        guard connectionStatus == .connected else { return }

        Task {
            do {
                log("[SignalR] 📤 Unsubscribing from tag: \(tagId)")
                try await hubConnection?.invoke(method: "Unsubscribe", arguments: tagId)
                await MainActor.run {
                    subscribedTags.removeAll { $0 == tagId }
                    log("[SignalR] ✅ Unsubscribed from tag: \(tagId)")
                }
            } catch {
                await MainActor.run {
                    log("[SignalR] ❌ Failed to unsubscribe: \(error)")
                }
            }
        }
    }

    /// Get events for a specific tag
    func eventsForTag(_ tagId: String) -> AnyPublisher<ChatEvent, Never> {
        chatEvents.filter { $0.tagId == tagId }.eraseToAnyPublisher()
    }
}

// MARK: - Models

private struct NegotiateResponse: Codable {
    let url: String
    let accessToken: String
}

// MARK: - Errors

enum SignalRError: LocalizedError {
    case noToken
    case noUserId
    case invalidURL
    case negotiateFailed

    var errorDescription: String? {
        switch self {
        case .noToken: return "No authentication token"
        case .noUserId: return "No user ID available"
        case .invalidURL: return "Invalid URL"
        case .negotiateFailed: return "Negotiate request failed"
        }
    }
}
