//
//  WebSocketManager.swift
//  Just Maple Watch App
//
//  Native WebSocket client for real-time messaging
//  Uses unified /ws/realtime endpoint with channel-based protocol
//

import Foundation
import Combine

/// Chat event from WebSocket
struct ChatEvent: Codable {
    let action: String  // 'message', 'typing', 'edited', 'deleted', etc.
    let data: ChatEventData?
    let tagId: String
    let userId: String
    let timestamp: String
}

/// AnyCodable wrapper for type-erased values
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
class WebSocketManager: NSObject, ObservableObject {
    static let shared = WebSocketManager()

    // Configuration
    private let wsBaseURL: String = {
        #if DEBUG
        return "ws://localhost:8081"  // Local dev
        #else
        return "wss://paperbark.justmaple.app"  // Production
        #endif
    }()

    // State
    @Published var connectionStatus: ConnectionStatus = .disconnected
    @Published var subscribedTags: [String] = []
    @Published var debugLogs: [String] = []

    // Event publishers
    private let _chatEvents = PassthroughSubject<ChatEvent, Never>()
    var chatEvents: AnyPublisher<ChatEvent, Never> {
        _chatEvents.eraseToAnyPublisher()
    }

    // WebSocket connection
    private var webSocketTask: URLSessionWebSocketTask?
    private var urlSession: URLSession?
    private var reconnectAttempts = 0
    private let maxReconnectAttempts = 5
    private var reconnectTask: Task<Void, Never>?
    private var pingTask: Task<Void, Never>?

    private override init() {
        super.init()

        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 300
        self.urlSession = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }

    // MARK: - Debug Logging

    private func log(_ message: String) {
        print(message)
        debugLogs.append(message)
        // Keep only last 50 logs to avoid memory issues
        if debugLogs.count > 50 {
            debugLogs.removeFirst()
        }
    }

    // MARK: - Public API

    /// Connect to WebSocket
    func connect() async {
        guard connectionStatus == .disconnected else {
            log("[WebSocket] ⚠️ Already connected or connecting")
            return
        }

        connectionStatus = .connecting
        log("[WebSocket] 🔄 Starting connection...")

        do {
            // Get authentication token
            guard let token = KeychainHelper.shared.getToken() else {
                log("[WebSocket] ❌ No token found in keychain")
                throw WebSocketError.noToken
            }

            // Build WebSocket URL (without token in URL for security)
            let wsURLString = "\(wsBaseURL)/ws/realtime"
            guard let url = URL(string: wsURLString) else {
                log("[WebSocket] ❌ Invalid WebSocket URL")
                throw WebSocketError.invalidURL
            }

            log("[WebSocket] 📡 Connecting to: \(wsBaseURL)/ws/realtime")

            // Create WebSocket task with token in Sec-WebSocket-Protocol header
            guard let session = urlSession else {
                throw WebSocketError.sessionUnavailable
            }

            var request = URLRequest(url: url)
            // Pass JWT token via Sec-WebSocket-Protocol header (secure method)
            request.setValue(token, forHTTPHeaderField: "Sec-WebSocket-Protocol")

            webSocketTask = session.webSocketTask(with: request)
            webSocketTask?.resume()

            // Start receiving messages
            startReceiving()

            // Start ping interval
            startPingInterval()

            connectionStatus = .connected
            reconnectAttempts = 0
            log("[WebSocket] ✅ Connected successfully")

        } catch {
            log("[WebSocket] ❌ Connection failed: \(error)")
            connectionStatus = .disconnected
            scheduleReconnect()
        }
    }

    /// Disconnect from WebSocket
    func disconnect() {
        log("[WebSocket] 🔌 Disconnecting...")

        stopPingInterval()
        reconnectTask?.cancel()
        reconnectTask = nil

        webSocketTask?.cancel(with: .goingAway, reason: nil)
        webSocketTask = nil

        connectionStatus = .disconnected
        subscribedTags.removeAll()
        reconnectAttempts = 0

        log("[WebSocket] ✅ Disconnected")
    }

    /// Subscribe to a tag
    func subscribe(to tagId: String) {
        guard connectionStatus == .connected else {
            log("[WebSocket] ⚠️ Cannot subscribe - not connected")
            return
        }
        guard !subscribedTags.contains(tagId) else {
            log("[WebSocket] ⚠️ Already subscribed to tag: \(tagId)")
            return
        }

        log("[WebSocket] 📥 Subscribing to tag: \(tagId)")
        sendMessage(["channel": "chat", "action": "subscribe", "tagId": tagId])
        subscribedTags.append(tagId)
        log("[WebSocket] ✅ Subscribed to tag: \(tagId)")
    }

    /// Unsubscribe from a tag
    func unsubscribe(from tagId: String) {
        guard connectionStatus == .connected else { return }

        log("[WebSocket] 📤 Unsubscribing from tag: \(tagId)")
        sendMessage(["channel": "chat", "action": "unsubscribe", "tagId": tagId])
        subscribedTags.removeAll { $0 == tagId }
        log("[WebSocket] ✅ Unsubscribed from tag: \(tagId)")
    }

    /// Get events for a specific tag
    func eventsForTag(_ tagId: String) -> AnyPublisher<ChatEvent, Never> {
        chatEvents.filter { $0.tagId == tagId }.eraseToAnyPublisher()
    }

    // MARK: - Private Methods

    private func startReceiving() {
        webSocketTask?.receive { [weak self] result in
            guard let self = self else { return }

            switch result {
            case .success(let message):
                Task { @MainActor in
                    await self.handleMessage(message)
                    // Continue receiving
                    self.startReceiving()
                }

            case .failure(let error):
                Task { @MainActor in
                    self.log("[WebSocket] ❌ Receive error: \(error)")
                    self.connectionStatus = .disconnected
                    self.scheduleReconnect()
                }
            }
        }
    }

    private func handleMessage(_ message: URLSessionWebSocketTask.Message) async {
        switch message {
        case .string(let text):
            do {
                let data = Data(text.utf8)
                let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]

                guard let channel = json?["channel"] as? String else {
                    log("[WebSocket] ⚠️ Message missing channel field")
                    return
                }

                switch channel {
                case "system":
                    // Handle system messages (connected, pong, ping)
                    if let event = json?["event"] as? [String: Any],
                       let type = event["type"] as? String {
                        switch type {
                        case "connected":
                            if let tags = event["subscribedTags"] as? [String] {
                                subscribedTags = tags
                                log("[WebSocket] ✅ Connection confirmed, subscribed to \(tags.count) tags")
                            }
                        case "pong":
                            // Keepalive response, nothing to do
                            break
                        case "ping":
                            // Server ping, respond with pong
                            sendMessage(["channel": "system", "action": "pong"])
                        default:
                            break
                        }
                    }

                case "chat":
                    // Handle chat events
                    if let eventData = json?["event"] {
                        let eventJson = try JSONSerialization.data(withJSONObject: eventData)
                        let event = try JSONDecoder().decode(ChatEvent.self, from: eventJson)
                        log("[WebSocket] 📬 RECEIVED - Action: \(event.action), Tag: \(event.tagId), User: \(event.userId)")
                        _chatEvents.send(event)
                        log("[WebSocket] ✅ Event published successfully")
                    }

                case "app":
                    // Handle app events (notes/tags CRUD) - not needed for watch yet
                    break

                default:
                    log("[WebSocket] ⚠️ Unknown channel: \(channel)")
                }

            } catch {
                log("[WebSocket] ⚠️ Failed to parse message: \(error)")
            }

        case .data(let data):
            // Handle binary data if needed
            log("[WebSocket] 📦 Received binary data: \(data.count) bytes")

        @unknown default:
            log("[WebSocket] ⚠️ Received unknown message type")
        }
    }

    private func sendMessage(_ payload: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let jsonString = String(data: data, encoding: .utf8) else {
            log("[WebSocket] ❌ Failed to serialize message")
            return
        }

        webSocketTask?.send(.string(jsonString)) { [weak self] error in
            if let error = error {
                Task { @MainActor in
                    self?.log("[WebSocket] ❌ Send error: \(error)")
                }
            }
        }
    }

    private func startPingInterval() {
        stopPingInterval()

        pingTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)  // 30 seconds

                guard let self = self, !Task.isCancelled else { return }

                await MainActor.run {
                    self.sendMessage(["channel": "system", "action": "ping"])
                }
            }
        }
    }

    private func stopPingInterval() {
        pingTask?.cancel()
        pingTask = nil
    }

    private func scheduleReconnect() {
        guard reconnectAttempts < maxReconnectAttempts else {
            log("[WebSocket] ❌ Max reconnect attempts reached")
            return
        }

        reconnectAttempts += 1
        connectionStatus = .reconnecting

        let delay = min(pow(2.0, Double(reconnectAttempts - 1)), 30.0)
        log("[WebSocket] 🔄 Reconnecting in \(delay)s (attempt \(reconnectAttempts))")

        reconnectTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))

            guard let self = self, !Task.isCancelled else { return }

            await self.connect()
        }
    }
}

// MARK: - URLSessionWebSocketDelegate

extension WebSocketManager: URLSessionWebSocketDelegate {
    nonisolated func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        Task { @MainActor in
            log("[WebSocket] ✅ WebSocket opened")
        }
    }

    nonisolated func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        Task { @MainActor in
            log("[WebSocket] 🔌 WebSocket closed: \(closeCode.rawValue)")
            connectionStatus = .disconnected
            scheduleReconnect()
        }
    }
}

// MARK: - Errors

enum WebSocketError: LocalizedError {
    case noToken
    case invalidURL
    case sessionUnavailable

    var errorDescription: String? {
        switch self {
        case .noToken: return "No authentication token"
        case .invalidURL: return "Invalid WebSocket URL"
        case .sessionUnavailable: return "URL session unavailable"
        }
    }
}
