//
//  MacDataConnection.swift
//  JapaneseMaple
//
//  The Mac's own link to the API, independent of the web view. The Mac uploads its
//  data over HTTPS (see MacDataEngine+Upload); this socket only tells the server the
//  Mac is online and lets it ask for a search query's vector, embedded with the same
//  on-device model as the uploaded items.
//
//  Protocol (realtime socket, channel "macData"):
//    Mac → server  { channel, action: "register", info }
//                  { channel, action: "heartbeat", info }
//                  { channel, action: "result", requestId, result | error }
//    server → Mac  { channel, event: { type: "request", requestId, op: "embed", params: { text } } }
//                  answered with the normalized vector, or null
//

#if os(macOS)
import Foundation
import os

@MainActor
final class MacDataConnection {
    private static let log = Logger(subsystem: "com.just.maple.JapaneseMaple", category: "MacData")

    /// What the user sees on Mac pages: whether the server can reach this Mac.
    private(set) var state = "Not connected" {
        didSet { onStateChange?(state) }
    }
    var onStateChange: ((String) -> Void)?

    private func note(_ message: String, state newState: String? = nil) {
        Self.log.info("\(message, privacy: .public)")
        if let newState { state = newState }
    }
    private static let heartbeatInterval: TimeInterval = 30

    private let engine: MacDataEngine
    private var task: URLSessionWebSocketTask?
    private var heartbeat: Timer?
    private var reconnectDelay: TimeInterval = 2
    private var tokenObserver: NSObjectProtocol?
    private(set) var isConnected = false

    init(engine: MacDataEngine) {
        self.engine = engine
    }

    func start() {
        tokenObserver = NotificationCenter.default.addObserver(
            forName: ServerConfigService.tokenDidChange, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.reconnect(immediately: true) }
        }
        connect()
    }

    // MARK: - Connection

    private func connect() {
        guard task == nil else { return }
        guard let token = ServerConfigService.shared.getToken(), let url = Self.socketURL() else {
            // Not signed in yet; the token observer reconnects after sign-in.
            note("Not connecting: no saved sign-in", state: "Not connected: sign in on this Mac first")
            return
        }
        note("Connecting to \(url.absoluteString)", state: "Connecting…")
        let task = URLSession.shared.webSocketTask(with: url, protocols: [token])
        self.task = task
        task.resume()
        receive(on: task)
        // Registration waits for the server's "connected" message: anything sent before
        // the server finishes setting up the connection is dropped.
        heartbeat = Timer.scheduledTimer(withTimeInterval: Self.heartbeatInterval, repeats: true) {
            [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                await self.send(["action": "heartbeat", "info": await self.hostInfoJSON()])
            }
        }
    }

    private func reconnect(immediately: Bool = false) {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        heartbeat?.invalidate()
        heartbeat = nil
        isConnected = false
        let delay = immediately ? 0 : reconnectDelay
        reconnectDelay = min(reconnectDelay * 2, 60)
        Task {
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            self.connect()
        }
    }

    static func socketURL() -> URL? {
        var base = ServerConfigService.shared.getAPIUrl()
        if base.hasPrefix("https://") {
            base = "wss://" + base.dropFirst("https://".count)
        } else if base.hasPrefix("http://") {
            base = "ws://" + base.dropFirst("http://".count)
        }
        return URL(string: base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/ws/realtime")
    }

    // MARK: - Receive

    private func receive(on task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            Task { @MainActor in
                guard let self, self.task === task else { return }
                switch result {
                case .failure(let error):
                    self.note("Socket closed: \(error.localizedDescription) (code \(task.closeCode.rawValue))", state: "Not connected: \(error.localizedDescription) (code \(task.closeCode.rawValue)). Retrying…")
                    self.reconnect()
                case .success(let message):
                    
                    self.isConnected = true
                    self.reconnectDelay = 2
                    if case .string(let text) = message { await self.handle(text) }
                    self.receive(on: task)
                }
            }
        }
    }

    private func handle(_ text: String) async {
        guard let data = text.data(using: .utf8),
            let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return }
        if message["channel"] as? String == "system",
            (message["event"] as? [String: Any])?["type"] as? String == "connected"
        {
            await send(["action": "register", "info": await hostInfoJSON()])
            note("Registered as data host", state: "Connected")
            return
        }
        guard message["channel"] as? String == "macData",
            let event = message["event"] as? [String: Any],
            let type = event["type"] as? String
        else { return }

        guard type == "request", let requestId = event["requestId"] as? String,
            let op = event["op"] as? String
        else { return }
        let params = event["params"] as? [String: Any] ?? [:]
        do {
            let result = try await Self.answer(op, params)
            await send(["action": "result", "requestId": requestId, "result": result])
        } catch {
            await send([
                "action": "result", "requestId": requestId, "error": error.localizedDescription,
            ])
        }
    }

    /// The JSON result for one server request. `embed` answers null when the text can't
    /// be embedded, so the server falls back to keyword search.
    static func answer(_ op: String, _ params: [String: Any]) async throws -> Any {
        switch op {
        case "embed":
            let vector = await MacDataEngine.embedAnswer(text: params["text"] as? String)
            return vector.map { $0.map(Double.init) } ?? NSNull()
        default:
            throw MacDataError.invalid("Unknown request: \(op)")
        }
    }

    // MARK: - Send

    @discardableResult
    private func send(_ message: [String: Any]) async -> Bool {
        guard let task else { return false }
        var payload = message
        payload["channel"] = "macData"
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
            let text = String(data: data, encoding: .utf8)
        else { return false }
        do {
            try await task.send(.string(text))
            return true
        } catch {
            reconnect()
            return false
        }
    }

    private func hostInfoJSON() async -> Any {
        (try? Self.json(await engine.hostInfo())) ?? [:]
    }

    private static func json<T: Encodable>(_ value: T) throws -> Any {
        try JSONSerialization.jsonObject(
            with: JSONEncoder().encode(value), options: .fragmentsAllowed)
    }
}
#endif
