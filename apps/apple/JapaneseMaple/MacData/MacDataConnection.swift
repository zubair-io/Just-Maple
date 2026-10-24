//
//  MacDataConnection.swift
//  JapaneseMaple
//
//  The Mac's own link to the API, independent of the web view. It registers
//  this Mac as the signed-in user's data host, answers search requests from
//  bots (on any device), and delivers proactive change batches.
//
//  Protocol (realtime socket, channel "macData"):
//    Mac → server  { channel, action: "register", info }
//                  { channel, action: "heartbeat", info }
//                  { channel, action: "result", requestId, result | error }
//                  { channel, action: "changes", batches, now, timeZone }
//    server → Mac  { channel, event: { type: "request", requestId, op, params } }
//                  op "http": a model-list or chat call to an AI server on this Mac's
//                  own machine or network (Ollama), which the API can't reach
//                  { channel, event: { type: "proactive", notebookIds } }
//

#if os(macOS)
import Foundation
import os

@MainActor
final class MacDataConnection {
    private static let log = Logger(subsystem: "com.just.maple.JapaneseMaple", category: "MacData")

    /// What the user sees on Mac pages: whether bots on other devices can reach this Mac.
    private(set) var state = "Not connected" {
        didSet { onStateChange?(state) }
    }
    var onStateChange: ((String) -> Void)?

    private func note(_ message: String, state newState: String? = nil) {
        Self.log.info("\(message, privacy: .public)")
        if let newState { state = newState }
    }
    private static let heartbeatInterval: TimeInterval = 30
    /// How often new data is offered to proactive bots. Batching keeps model calls down.
    static let proactiveInterval: TimeInterval = 5 * 60

    private let engine: MacDataEngine
    private var task: URLSessionWebSocketTask?
    private var heartbeat: Timer?
    private var proactiveTimer: Timer?
    private var reconnectDelay: TimeInterval = 2
    private var tokenObserver: NSObjectProtocol?
    /// Notebooks whose messages page has a proactive bot; told to us by the server.
    private(set) var proactiveNotebooks: Set<String> = []
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
        proactiveTimer = Timer.scheduledTimer(
            withTimeInterval: Self.proactiveInterval, repeats: true
        ) { [weak self] _ in
            Task { @MainActor in await self?.sendProactiveBatches() }
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

    /// Re-announces which notebooks have Mac pages (after a page is created or removed).
    func announce() {
        Task { await send(["action": "heartbeat", "info": await hostInfoJSON()]) }
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

        switch type {
        case "proactive":
            proactiveNotebooks = Set(event["notebookIds"] as? [String] ?? [])
        case "request":
            guard let requestId = event["requestId"] as? String, let op = event["op"] as? String
            else { return }
            let params = event["params"] as? [String: Any] ?? [:]
            do {
                let result = try await answer(op, params)
                await send(["action": "result", "requestId": requestId, "result": result])
            } catch {
                await send([
                    "action": "result", "requestId": requestId, "error": error.localizedDescription,
                ])
            }
        default:
            break
        }
    }

    private func answer(_ op: String, _ params: [String: Any]) async throws -> Any {
        switch op {
        case "info":
            return try Self.json(await engine.hostInfo())
        case "search":
            let data = try JSONSerialization.data(withJSONObject: params)
            let request = try JSONDecoder().decode(MacDataSearchRequest.self, from: data)
            return try Self.json(await engine.search(request))
        case "get":
            guard let id = params["id"] as? String, let notebookId = params["notebookId"] as? String
            else { throw MacDataError.invalid("Missing id or notebookId.") }
            guard var item = try await engine.item(id: id, notebookId: notebookId) else {
                throw MacDataError.invalid("No item \(id) in this notebook's Mac data.")
            }
            item.body = String(item.body.prefix(6_000))
            return try Self.json(item)
        case "http":
            return try await MacDataLocalHTTP.perform(params)
        default:
            throw MacDataError.invalid("Unknown request: \(op)")
        }
    }

    // MARK: - Proactive

    func sendProactiveBatches() async {
        guard isConnected else { return }
        do {
            let (batches, cursor) = try await engine.proactiveBatches(for: proactiveNotebooks)
            if !batches.isEmpty {
                let sent = await send([
                    "action": "changes",
                    "batches": try Self.json(batches),
                    "now": MacDataEngine.localISO(Date()),
                    "timeZone": TimeZone.current.identifier,
                ])
                // Keep the cursor if delivery failed so the next batch retries these.
                guard sent else { return }
            }
            try await engine.commitProactiveCursor(cursor)
        } catch {
            // Try again on the next interval.
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
// MARK: - Local AI servers

/// Calls an OpenAI-compatible server on this machine or home network (Ollama, LM Studio)
/// for a bot whose server the API can't reach. Only model lists and chat requests to
/// local addresses are allowed, so the server can't use this Mac to reach anything else.
nonisolated enum MacDataLocalHTTP {
    static let timeout: TimeInterval = 170
    static let maxBodyBytes = 4_000_000

    static func perform(_ params: [String: Any]) async throws -> [String: Any] {
        guard let method = params["method"] as? String,
            let string = params["url"] as? String,
            let url = URL(string: string)
        else { throw MacDataError.invalid("Missing method or url.") }
        try check(method: method, url: url)

        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.httpMethod = method
        for (name, value) in params["headers"] as? [String: String] ?? [:] {
            request.setValue(value, forHTTPHeaderField: name)
        }
        if method == "POST", let body = params["body"] as? String {
            request.httpBody = Data(body.utf8)
        }
        let session = URLSession(configuration: .ephemeral, delegate: NoRedirects(), delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        return ["status": status, "body": String(decoding: data.prefix(maxBodyBytes), as: UTF8.self)]
    }

    static func check(method: String, url: URL) throws {
        guard let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme),
            let host = url.host(percentEncoded: false), isLocalHost(host)
        else { throw MacDataError.invalid("Only AI servers on this Mac or its local network can be called.") }
        let path = url.path(percentEncoded: false)
        let allowed =
            (method == "GET" && path.hasSuffix("/models"))
            || (method == "POST" && path.hasSuffix("/chat/completions"))
        guard allowed else { throw MacDataError.invalid("Only model lists and chat requests are allowed.") }
    }

    /// Matches the API's rule: localhost, private and link-local addresses, and local names.
    static func isLocalHost(_ hostname: String) -> Bool {
        let host = hostname.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
        if let ipv4 = ipv4Octets(host) { return isPrivate(ipv4) }
        if host.contains(":") {
            if let mapped = host.split(separator: ":").last.map(String.init), let ipv4 = ipv4Octets(mapped) {
                return isPrivate(ipv4)
            }
            return host == "::1" || host.hasPrefix("fc") || host.hasPrefix("fd")
                || ["fe8", "fe9", "fea", "feb"].contains { host.hasPrefix($0) }
        }
        return host == "localhost" || !host.contains(".")
            || [".localhost", ".local", ".lan", ".home.arpa", ".internal"].contains { host.hasSuffix($0) }
    }

    private static func ipv4Octets(_ host: String) -> [Int]? {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false).compactMap { Int($0) }
        guard parts.count == 4, host.split(separator: ".").count == 4, parts.allSatisfy({ (0...255).contains($0) })
        else { return nil }
        return parts
    }

    private static func isPrivate(_ ip: [Int]) -> Bool {
        let (a, b) = (ip[0], ip[1])
        return a == 0 || a == 10 || a == 127 || (a == 100 && (64...127).contains(b))
            || (a == 169 && b == 254) || (a == 172 && (16...31).contains(b)) || (a == 192 && b == 168)
    }

    /// The URL was checked; a redirect could lead somewhere it wasn't.
    private final class NoRedirects: NSObject, URLSessionTaskDelegate {
        func urlSession(
            _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
            newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void
        ) {
            completionHandler(nil)
        }
    }
}
#endif
