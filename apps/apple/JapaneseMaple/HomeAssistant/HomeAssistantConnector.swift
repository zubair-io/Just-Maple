//
//  HomeAssistantConnector.swift
//  JapaneseMaple
//
//  The Mac's live connection to Home Assistant. Home Assistant is on the home network,
//  which the cloud can't reach, so this Mac reads it and acts for the server.
//
//  1. Connect to `/api/websocket`: `auth_required` → `auth` → `auth_ok` (or
//     `auth_invalid`, which stops retrying: Home Assistant bans addresses that keep
//     failing).
//  2. Read the exposed list (`homeassistant/expose_entity/list`), and the area, device
//     and entity registries for names and areas.
//  3. `subscribe_entities` with `entity_ids` set to exactly the exposed entities. Never a
//     subscription to everything filtered afterwards; with nothing exposed, no
//     subscription at all (an empty list would mean every entity).
//  4. Re-read the exposed list on every connect and every 5 minutes, and before every
//     action. When it changes: resubscribe, drop pending updates of entities no longer
//     exposed, and tell the sink so the server hides them at once.
//  5. Updates go through HomeChangeCoalescer, then to the sink as items.
//  6. A lost connection reconnects after 1, 2, 4… seconds, at most 60. Everything the
//     connection started (receiving, pings, refreshes, request timeouts) ends with it.
//

#if os(macOS)
import Foundation
import os

/// Where the connector's output goes (the engine, in the app; a recorder, in tests).
nonisolated protocol HomeAssistantSink: Sendable {
    func homeItems(_ items: [MacDataItem]) async
    func homeExposure(_ exposed: Set<String>) async
    func homeStatus(_ status: HomeAssistantStatus) async
}

nonisolated enum HomeAssistantStatus: Equatable, Sendable {
    case stopped
    case connecting
    case connected(exposed: Int)
    /// `retrying` is false when only a settings change can fix it (a bad token).
    case failed(String, retrying: Bool)
}

/// Waits, so tests can run the clock themselves.
nonisolated struct HomeAssistantTiming: Sendable {
    /// Before reconnecting.
    var backoff: @Sendable (TimeInterval) async throws -> Void
    /// Between pings, exposure refreshes and flushes.
    var interval: @Sendable (TimeInterval) async throws -> Void
    var requestTimeout: TimeInterval = 15

    static let live = HomeAssistantTiming(
        backoff: { try await Task.sleep(nanoseconds: UInt64($0 * 1_000_000_000)) },
        interval: { try await Task.sleep(nanoseconds: UInt64($0 * 1_000_000_000)) })
}

actor HomeAssistantConnector: HomeActionPerforming {
    static let exposureRefresh: TimeInterval = 5 * 60
    static let pingInterval: TimeInterval = 30
    static let maxBackoff: TimeInterval = 60
    private static let log = Logger(subsystem: "app.justmaple", category: "HomeAssistant")

    private let factory: HomeSocketFactory
    private let timing: HomeAssistantTiming
    private let sink: HomeAssistantSink
    private let now: @Sendable () -> Double

    private var settings: HomeAssistantSettings?
    private var token: String?
    private var runTask: Task<Void, Never>?
    private var flushTask: Task<Void, Never>?

    // One connection's state; reset when it ends.
    private var socket: HomeSocket?
    private var nextId = 0
    private var pending: [Int: CheckedContinuation<[String: Any], Error>] = [:]
    private var timeouts: [Int: Task<Void, Never>] = [:]
    private var subscriptionId: Int?
    private var connected = false

    // Kept across reconnects.
    private(set) var exposed: Set<String> = []
    private(set) var states: [String: HomeEntityState] = [:]
    private var info: [String: HomeEntityInfo] = [:]
    private var coalescer = HomeChangeCoalescer()
    private(set) var status: HomeAssistantStatus = .stopped

    init(
        factory: HomeSocketFactory = URLSessionHomeSocketFactory(),
        timing: HomeAssistantTiming = .live,
        sink: HomeAssistantSink,
        now: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 }
    ) {
        self.factory = factory
        self.timing = timing
        self.sink = sink
        self.now = now
    }

    // MARK: - Lifecycle

    var isRunning: Bool { runTask != nil }

    /// Connects (or reconnects with new settings). The same settings again do nothing.
    func start(settings: HomeAssistantSettings, token: String) {
        if runTask != nil, settings == self.settings, token == self.token { return }
        stop()
        if settings != self.settings {
            // Another Home Assistant: nothing from the old one carries over.
            states = [:]
            info = [:]
            exposed = []
            coalescer = HomeChangeCoalescer()
        }
        self.settings = settings
        self.token = token
        runTask = Task { await self.run() }
    }

    func stop() {
        runTask?.cancel()
        runTask = nil
        flushTask?.cancel()
        flushTask = nil
        endConnection(HomeAssistantError.unreachable("stopped"), of: socket)
        token = nil
        setStatus(.stopped)
    }

    private func run() async {
        var failures = 0
        while !Task.isCancelled {
            do {
                try await connection()
            } catch HomeAssistantError.authInvalid {
                setStatus(.failed(HomeAssistantError.authInvalid.localizedDescription, retrying: false))
                break
            } catch HomeAssistantError.notAdmin {
                setStatus(.failed(HomeAssistantError.notAdmin.localizedDescription, retrying: false))
                break
            } catch {
                if Task.isCancelled { break }
                setStatus(.failed(Self.describe(error), retrying: true))
            }
            if connectedOnce { failures = 0 }
            connectedOnce = false
            guard !Task.isCancelled else { break }
            let delay = Self.backoff(after: failures)
            failures += 1
            do { try await timing.backoff(delay) } catch { break }
        }
    }

    private var connectedOnce = false

    /// 1, 2, 4, 8… seconds, at most a minute.
    static func backoff(after failures: Int) -> TimeInterval {
        min(maxBackoff, pow(2, Double(min(failures, 10))))
    }

    // MARK: - One connection

    private func connection() async throws {
        guard let settings, let token else { throw HomeAssistantError.notConfigured }
        setStatus(.connecting)
        let socket = factory.open(settings.webSocketURL)
        self.socket = socket
        nextId = 0
        do {
            try await authenticate(socket, token: token)
            try await withThrowingTaskGroup(of: Void.self) { group in
                group.addTask { try await self.receiveLoop(socket) }
                group.addTask { try await self.setUp() }
                group.addTask { try await self.keepAlive() }
                do {
                    _ = try await group.next()
                    // Nothing should finish while connected; if one did, start over.
                    throw HomeAssistantError.unreachable("connection ended")
                } catch {
                    // Closing the socket ends the receive loop; cancelling ends the rest.
                    self.endConnection(error, of: socket)
                    group.cancelAll()
                    throw error
                }
            }
        } catch {
            endConnection(error, of: socket)
            throw error
        }
    }

    private func authenticate(_ socket: HomeSocket, token: String) async throws {
        guard try Self.messageType(try await socket.receive()) == "auth_required" else {
            throw HomeAssistantError.protocolError("expected auth_required")
        }
        try await socket.send(try Self.encode(["type": "auth", "access_token": token]))
        switch try Self.messageType(try await socket.receive()) {
        case "auth_ok": return
        case "auth_invalid": throw HomeAssistantError.authInvalid
        default: throw HomeAssistantError.protocolError("expected auth_ok")
        }
    }

    private func setUp() async throws {
        let list = try await readExposure()
        await readRegistries(for: list)
        try await applyExposure(list, force: true)
        connected = true
        connectedOnce = true
        setStatus(.connected(exposed: exposed.count))
        while true {
            try await timing.interval(Self.exposureRefresh)
            try await refreshExposure()
        }
    }

    private func keepAlive() async throws {
        while true {
            try await timing.interval(Self.pingInterval)
            _ = try await request(["type": "ping"])
        }
    }

    private func receiveLoop(_ socket: HomeSocket) async throws {
        while true {
            let text = try await socket.receive()
            handle(text)
        }
    }

    /// Fails every waiting request, cancels their timeouts and closes the socket. Only for
    /// the current connection: a stopped one finishing late leaves its successor alone.
    private func endConnection(_ error: Error, of ended: HomeSocket?) {
        guard let ended, ended === socket else {
            ended?.close()
            return
        }
        connected = false
        subscriptionId = nil
        socket?.close()
        socket = nil
        for task in timeouts.values { task.cancel() }
        timeouts = [:]
        let waiting = pending
        pending = [:]
        for continuation in waiting.values { continuation.resume(throwing: error) }
    }

    // MARK: - Exposure

    /// Reads the exposed list now and applies any change.
    func refreshExposure() async throws {
        let list = try await readExposure()
        if list != exposed { await readRegistries(for: list) }
        try await applyExposure(list, force: false)
    }

    private func readExposure() async throws -> Set<String> {
        let id = takeId()
        let message: [String: Any]
        do {
            message = try await request(["type": "homeassistant/expose_entity/list"], id: id)
        } catch HomeRequestError.failed(let code, _) where code == "unauthorized" {
            throw HomeAssistantError.notAdmin
        }
        return try HomeExposure.parse(message: message, id: id)
    }

    /// Subscribes to exactly `list`, when it changed (or always, on connect).
    private func applyExposure(_ list: Set<String>, force: Bool) async throws {
        let removed = exposed.subtracting(list)
        let changed = list != exposed
        exposed = list
        if !removed.isEmpty {
            // Stop at once: nothing more goes up for these, and nothing waits to.
            coalescer.forget(removed)
            for id in removed { states[id] = nil }
        }
        if changed || force { await sink.homeExposure(list) }
        if connected { setStatus(.connected(exposed: list.count)) }
        // Decided before any wait, so overlapping refreshes subscribe once.
        guard changed || force else { return }
        if let old = subscriptionId {
            subscriptionId = nil
            _ = try? await request(["type": "unsubscribe_events", "subscription": old])
        }
        // An empty entity_ids would subscribe to every entity: subscribe to none instead.
        guard !list.isEmpty else { return }
        let id = takeId()
        // Set before sending: the first event can arrive right after the result.
        subscriptionId = id
        _ = try await request(["type": "subscribe_entities", "entity_ids": list.sorted()], id: id)
    }

    /// Names and areas of the exposed entities. Missing registries only cost names.
    private func readRegistries(for list: Set<String>) async {
        guard !list.isEmpty else { return }
        do {
            let areas = try await request(["type": "config/area_registry/list"])["result"] as? [[String: Any]] ?? []
            let devices = try await request(["type": "config/device_registry/list"])["result"] as? [[String: Any]] ?? []
            let entities = try await request(["type": "config/entity_registry/list"])["result"] as? [[String: Any]] ?? []
            var areaNames: [String: String] = [:]
            for area in areas {
                if let id = area["area_id"] as? String, let name = area["name"] as? String { areaNames[id] = name }
            }
            var deviceAreas: [String: String] = [:]
            for device in devices {
                if let id = device["id"] as? String, let area = device["area_id"] as? String { deviceAreas[id] = area }
            }
            var next: [String: HomeEntityInfo] = [:]
            for entity in entities {
                guard let id = entity["entity_id"] as? String, list.contains(id) else { continue }
                let areaId = (entity["area_id"] as? String) ?? (entity["device_id"] as? String).flatMap { deviceAreas[$0] }
                next[id] = HomeEntityInfo(
                    name: (entity["name"] as? String) ?? (entity["original_name"] as? String),
                    area: areaId.flatMap { areaNames[$0] })
            }
            info = next
        } catch {
            Self.log.notice("Home Assistant registries unavailable: \(error.localizedDescription, privacy: .public)")
        }
    }

    // MARK: - Messages

    private func handle(_ text: String) {
        guard let message = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
            let type = message["type"] as? String
        else { return }
        let id = (message["id"] as? NSNumber)?.intValue
        switch type {
        case "result", "pong":
            guard let id, let continuation = pending.removeValue(forKey: id) else { return }
            timeouts.removeValue(forKey: id)?.cancel()
            if type == "result", (message["success"] as? NSNumber)?.boolValue != true {
                let error = message["error"] as? [String: Any]
                continuation.resume(
                    throwing: HomeRequestError.failed(
                        error?["code"] as? String ?? "unknown", error?["message"] as? String ?? ""))
            } else {
                continuation.resume(returning: message)
            }
        case "event":
            // Only our current subscription, and only exposed entities within it.
            guard let id, id == subscriptionId, let event = message["event"] as? [String: Any] else { return }
            let changes = HomeEntityDiff.apply(event, to: &states, allowed: exposed)
            for change in changes {
                if let after = change.after { coalescer.observe(after, before: change.before) }
            }
            if !changes.isEmpty { scheduleFlush() }
        default:
            return
        }
    }

    private func takeId() -> Int {
        nextId += 1
        return nextId
    }

    private func request(_ payload: [String: Any], id: Int? = nil) async throws -> [String: Any] {
        // A stopped connection's tasks must not send on the next one.
        try Task.checkCancellation()
        guard let socket else { throw HomeAssistantError.unreachable("not connected") }
        let id = id ?? takeId()
        var message = payload
        message["id"] = id
        let text = try Self.encode(message)
        let timeout = timing.requestTimeout
        return try await withCheckedThrowingContinuation { continuation in
            pending[id] = continuation
            timeouts[id] = Task { [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                guard !Task.isCancelled else { return }
                await self?.timedOut(id)
            }
            Task {
                do { try await socket.send(text) } catch { self.failRequest(id, error) }
            }
        }
    }

    private func timedOut(_ id: Int) {
        failRequest(id, HomeAssistantError.timedOut)
    }

    private func failRequest(_ id: Int, _ error: Error) {
        timeouts.removeValue(forKey: id)?.cancel()
        pending.removeValue(forKey: id)?.resume(throwing: error)
    }

    // MARK: - Uploading

    private func scheduleFlush() {
        guard flushTask == nil else { return }
        let timing = timing
        flushTask = Task {
            try? await timing.interval(HomeChangeCoalescer.flushInterval)
            guard !Task.isCancelled else { return }
            await self.flushNow()
        }
    }

    /// Hands what's pending to the sink now (also called by the flush timer).
    func flushNow() async {
        flushTask?.cancel()
        flushTask = nil
        let info = self.info
        let items = coalescer.flush(now: now(), info: { info[$0] })
        if !items.isEmpty { await sink.homeItems(items) }
        if !coalescer.isEmpty { scheduleFlush() }
    }

    /// The state items of every exposed entity, for a fresh upload.
    func currentItems() -> [MacDataItem] {
        states.values.filter { exposed.contains($0.entityId) }
            .map { HomeItems.state($0, info: info[$0.entityId]) }
    }

    // MARK: - Actions

    /// Calls a confirmed service, after checking it's allowed and the entity is still exposed.
    func perform(_ call: HomeServiceCall) async -> DeviceActionResult {
        if let problem = HomeServiceRules.problem(call) {
            return DeviceActionResult(ok: false, error: problem)
        }
        guard connected else { return HomeActionError.notConnected() }
        do {
            // Read the exposed list right now, not the one from minutes ago.
            try await refreshExposure()
            guard exposed.contains(call.entityId) else {
                return DeviceActionResult(
                    ok: false,
                    error: "\(call.name ?? call.entityId) is no longer exposed in Home Assistant, so Just Maple can't change it.")
            }
            let id = takeId()
            var message = HomeServiceRules.message(call, id: id)
            message["id"] = nil
            _ = try await request(message, id: id)
            return DeviceActionResult(ok: true)
        } catch {
            return DeviceActionResult(ok: false, error: String(Self.describe(error).prefix(500)))
        }
    }

    // MARK: - Helpers

    private func setStatus(_ next: HomeAssistantStatus) {
        guard next != status else { return }
        status = next
        let sink = sink
        Task { await sink.homeStatus(next) }
    }

    static func describe(_ error: Error) -> String {
        switch error {
        case let error as HomeAssistantError: error.localizedDescription
        case let error as HomeRequestError: error.localizedDescription
        case let error as HomeExposure.ParseError: error.localizedDescription
        default: HomeAssistantError.unreachable(error.localizedDescription).localizedDescription
        }
    }

    static func messageType(_ text: String) throws -> String {
        guard let message = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
            let type = message["type"] as? String
        else { throw HomeAssistantError.protocolError("unreadable message") }
        return type
    }

    static func encode(_ message: [String: Any]) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: message, options: [.sortedKeys]), as: UTF8.self)
    }

    // MARK: - Test connection

    /// Connects once, reads the exposed list and disconnects. Returns how many are exposed.
    static func probe(
        settings: HomeAssistantSettings, token: String,
        factory: HomeSocketFactory = URLSessionHomeSocketFactory(), timeout: TimeInterval = 20
    ) async throws -> Int {
        let socket = factory.open(settings.webSocketURL)
        defer { socket.close() }
        return try await withThrowingTaskGroup(of: Int.self) { group in
            group.addTask {
                guard try HomeAssistantConnector.messageType(try await socket.receive()) == "auth_required" else {
                    throw HomeAssistantError.protocolError("expected auth_required")
                }
                try await socket.send(try HomeAssistantConnector.encode(["type": "auth", "access_token": token]))
                switch try HomeAssistantConnector.messageType(try await socket.receive()) {
                case "auth_ok": break
                case "auth_invalid": throw HomeAssistantError.authInvalid
                default: throw HomeAssistantError.protocolError("expected auth_ok")
                }
                try await socket.send(#"{"id":1,"type":"homeassistant/expose_entity/list"}"#)
                while true {
                    let text = try await socket.receive()
                    guard let message = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any],
                        (message["id"] as? NSNumber)?.intValue == 1
                    else { continue }
                    if (message["success"] as? NSNumber)?.boolValue != true,
                        (message["error"] as? [String: Any])?["code"] as? String == "unauthorized"
                    {
                        throw HomeAssistantError.notAdmin
                    }
                    return try HomeExposure.parse(message: message, id: 1).count
                }
            }
            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
                throw HomeAssistantError.timedOut
            }
            defer { group.cancelAll() }
            guard let count = try await group.next() else { throw HomeAssistantError.timedOut }
            return count
        }
    }
}

nonisolated enum HomeRequestError: LocalizedError, Equatable {
    case failed(String, String)

    var errorDescription: String? {
        switch self {
        case .failed(let code, let message):
            "Home Assistant refused it (\(code))\(message.isEmpty ? "" : ": \(message)")."
        }
    }
}
#endif
