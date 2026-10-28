//
//  HomeAssistantTests.swift
//  JapaneseMapleTests
//
//  Home Assistant on the Mac, against a fake WebSocket server. Nothing here reaches a real
//  Home Assistant or the real Keychain.
//

#if os(macOS)
import Foundation
import Testing

@testable import JapaneseMaple

// MARK: - Fakes

/// Plays Home Assistant: answers auth, the exposed list, registries, subscriptions,
/// pings and service calls. It also sends states of entities nobody subscribed to, the
/// way a misbehaving server might, so the connector's own filtering is tested.
final class FakeHomeServer: HomeSocketFactory, @unchecked Sendable {
    private let lock = NSLock()
    private var _exposure: [String: Any]
    private var _received: [[String: Any]] = []
    private var _sockets: [FakeHomeSocket] = []
    private var _lastSubscription: Int?
    var acceptsToken = true
    var states: [String: [String: Any]]

    init(exposure: [String: Any], states: [String: [String: Any]] = [:]) {
        _exposure = exposure
        self.states = states
    }

    var exposure: [String: Any] {
        get { lock.withLock { _exposure } }
        set { lock.withLock { _exposure = newValue } }
    }

    var received: [[String: Any]] { lock.withLock { _received } }
    var connections: Int { lock.withLock { _sockets.count } }
    var lastSubscription: Int? { lock.withLock { _lastSubscription } }

    func received(_ type: String) -> [[String: Any]] {
        received.filter { $0["type"] as? String == type }
    }

    func open(_ url: URL) -> HomeSocket {
        let socket = FakeHomeSocket(server: self)
        lock.withLock { _sockets.append(socket) }
        socket.deliver(["type": "auth_required", "ha_version": "2026.10.0"])
        return socket
    }

    /// Drops the current connection, as a restart of Home Assistant would.
    func disconnect() {
        lock.withLock { _sockets.last }?.serverClose()
    }

    /// Sends a `subscribe_entities` event on the current subscription.
    func push(_ event: [String: Any]) {
        let (socket, id) = lock.withLock { (_sockets.last, _lastSubscription) }
        guard let socket, let id else { return }
        socket.deliver(["id": id, "type": "event", "event": event])
    }

    fileprivate func handle(_ message: [String: Any], from socket: FakeHomeSocket) {
        lock.withLock { _received.append(message) }
        let id = message["id"] as? Int ?? 0
        func result(_ value: Any) {
            socket.deliver(["id": id, "type": "result", "success": true, "result": value])
        }
        switch message["type"] as? String {
        case "auth":
            socket.deliver(["type": acceptsToken ? "auth_ok" : "auth_invalid"])
        case "homeassistant/expose_entity/list":
            result(["exposed_entities": exposure])
        case "config/area_registry/list":
            result([["area_id": "kitchen", "name": "Kitchen"]])
        case "config/device_registry/list":
            result([["id": "dev1", "area_id": "kitchen"]])
        case "config/entity_registry/list":
            result([["entity_id": "light.kitchen", "device_id": "dev1", "name": NSNull()]])
        case "subscribe_entities":
            lock.withLock { _lastSubscription = id }
            socket.deliver(["id": id, "type": "result", "success": true, "result": NSNull()])
            // Everything it has, exposed or not.
            socket.deliver(["id": id, "type": "event", "event": ["a": states]])
        case "unsubscribe_events", "call_service":
            result(NSNull())
        case "ping":
            socket.deliver(["id": id, "type": "pong"])
        default:
            socket.deliver(["id": id, "type": "result", "success": false, "error": ["code": "unknown_command"]])
        }
    }
}

final class FakeHomeSocket: HomeSocket, @unchecked Sendable {
    private let server: FakeHomeServer
    private let stream: AsyncStream<String>
    private let continuation: AsyncStream<String>.Continuation
    private var iterator: AsyncStream<String>.AsyncIterator
    private let lock = NSLock()
    private var closed = false

    init(server: FakeHomeServer) {
        self.server = server
        (stream, continuation) = AsyncStream<String>.makeStream()
        iterator = stream.makeAsyncIterator()
    }

    func deliver(_ message: [String: Any]) {
        let data = try! JSONSerialization.data(withJSONObject: message)
        continuation.yield(String(decoding: data, as: UTF8.self))
    }

    func serverClose() { continuation.finish() }

    var isClosed: Bool { lock.withLock { closed } }

    func send(_ text: String) async throws {
        guard !isClosed else { throw HomeAssistantError.unreachable("closed") }
        let message = try JSONSerialization.jsonObject(with: Data(text.utf8)) as! [String: Any]
        server.handle(message, from: self)
    }

    func receive() async throws -> String {
        guard let text = await iterator.next() else { throw HomeAssistantError.unreachable("closed") }
        return text
    }

    func close() {
        lock.withLock { closed = true }
        continuation.finish()
    }
}

actor RecordingSink: HomeAssistantSink {
    var items: [MacDataItem] = []
    var exposures: [Set<String>] = []
    var statuses: [HomeAssistantStatus] = []

    func homeItems(_ items: [MacDataItem]) { self.items += items }
    func homeExposure(_ exposed: Set<String>) { exposures.append(exposed) }
    func homeStatus(_ status: HomeAssistantStatus) { statuses.append(status) }
}

final class MemoryCredentials: HomeCredentialStore, @unchecked Sendable {
    private let lock = NSLock()
    private var tokens: [String: String] = [:]

    var accounts: Set<String> { lock.withLock { Set(tokens.keys) } }
    func token(for account: String) throws -> String? { lock.withLock { tokens[account] } }
    func save(_ token: String, for account: String) throws { lock.withLock { tokens[account] = token } }
    func delete(account: String) throws { _ = lock.withLock { tokens.removeValue(forKey: account) } }
}

/// Backoff returns at once (and is recorded); intervals wait until cancelled, so pings,
/// refreshes and flushes only happen when a test calls them.
final class ManualTiming: @unchecked Sendable {
    private let lock = NSLock()
    private var _backoffs: [TimeInterval] = []
    var backoffs: [TimeInterval] { lock.withLock { _backoffs } }

    var timing: HomeAssistantTiming {
        HomeAssistantTiming(
            backoff: { [self] delay in
                lock.withLock { _backoffs.append(delay) }
                try await Task.sleep(nanoseconds: 1_000_000)
            },
            interval: { _ in try await Task.sleep(nanoseconds: 3_600 * 1_000_000_000) },
            requestTimeout: 5)
    }
}

/// Waits up to two seconds for `condition`.
func eventually(_ condition: @escaping () async -> Bool) async -> Bool {
    for _ in 0..<200 {
        if await condition() { return true }
        try? await Task.sleep(nanoseconds: 10_000_000)
    }
    return await condition()
}

private let settings = HomeAssistantSettings(url: URL(string: "http://homeassistant.local:8123")!)

private func state(_ value: String, _ attributes: [String: Any] = [:], at time: Double = 1_790_000_000)
    -> [String: Any]
{
    ["s": value, "a": attributes, "lc": time, "lu": time]
}

private let homeStates: [String: [String: Any]] = [
    "light.kitchen": state("off", ["friendly_name": "Kitchen Light"]),
    "lock.front_door": state("locked", ["friendly_name": "Front Door"]),
    "switch.secret": state("on", ["friendly_name": "Secret Switch"]),
    "person.ria": state("home", ["friendly_name": "Ria", "latitude": 1.5, "longitude": 2.5]),
]

private func connector(_ server: FakeHomeServer, _ sink: RecordingSink, _ timing: ManualTiming = ManualTiming())
    -> HomeAssistantConnector
{
    HomeAssistantConnector(
        factory: server, timing: timing.timing, sink: sink, now: { 1_790_000_100 })
}

private func isConnected(_ connector: HomeAssistantConnector) async -> Bool {
    if case .connected = await connector.status { return true }
    return false
}

// MARK: - Exposure

@Suite("Home Assistant exposure list")
struct HomeExposureTests {
    private func message(_ entities: Any, id: Int = 3) -> [String: Any] {
        ["id": id, "type": "result", "success": true, "result": ["exposed_entities": entities]]
    }

    @Test func readsBothFormats() throws {
        let exposed = try HomeExposure.parse(
            message: message([
                "light.kitchen": ["conversation": true],
                "switch.fan": ["cloud.alexa": ["should_expose": true]],
                "lock.front_door": ["conversation": false, "cloud.google_assistant": ["should_expose": false]],
                "sensor.power": ["some_other_assistant": true],
            ]), id: 3)
        #expect(exposed == ["light.kitchen", "switch.fan"])
    }

    @Test func parsesRawJSON() throws {
        let data = Data(
            #"{"id":7,"type":"result","success":true,"result":{"exposed_entities":{"light.a":{"conversation":true}}}}"#.utf8)
        #expect(try HomeExposure.parse(data, id: 7) == ["light.a"])
    }

    @Test func refusesAnythingMalformed() {
        #expect(throws: HomeExposure.ParseError.invalid) {
            try HomeExposure.parse(message: message(["light.a": ["conversation": "yes"]]), id: 3)
        }
        #expect(throws: HomeExposure.ParseError.invalid) {
            try HomeExposure.parse(message: message(["light.a": ["conversation": 1]]), id: 3)
        }
        #expect(throws: HomeExposure.ParseError.invalid) {
            try HomeExposure.parse(message: message(["no_dot": ["conversation": true]]), id: 3)
        }
        #expect(throws: HomeExposure.ParseError.invalid) {
            try HomeExposure.parse(message: message(["light.a": ["conversation": true]]), id: 4)
        }
        #expect(throws: HomeExposure.ParseError.invalid) {
            try HomeExposure.parse(message: message([["light.a"]]), id: 3)
        }
        #expect(throws: HomeExposure.ParseError.invalid) {
            try HomeExposure.parse(
                message: ["id": 3, "type": "result", "success": false, "error": ["code": "unauthorized"]], id: 3)
        }
    }

    @Test func idsTheServerWouldRefuseAreNotExposed() throws {
        let exposed = try HomeExposure.parse(
            message: message([
                "Light.Kitchen": ["conversation": true],
                "light.ok": ["conversation": true],
                "light.has space": ["conversation": true],
            ]), id: 3)
        #expect(exposed == ["light.ok"])
    }

    @Test func capsTheListAtTenThousand() throws {
        var entities: [String: Any] = [:]
        for index in 0..<HomeExposure.maxEntities { entities["sensor.s\(index)"] = ["conversation": true] }
        #expect(try HomeExposure.parse(message: message(entities), id: 3).count == 10_000)
        entities["sensor.one_more"] = ["conversation": true]
        #expect(throws: HomeExposure.ParseError.tooLarge) {
            try HomeExposure.parse(message: message(entities), id: 3)
        }
        #expect(throws: HomeExposure.ParseError.tooLarge) {
            try HomeExposure.parse(Data(count: HomeExposure.maxResponseBytes + 1), id: 3)
        }
    }
}

// MARK: - Connection

@Suite("Home Assistant connection")
struct HomeAssistantConnectionTests {
    @Test func subscribesToExactlyTheExposedEntities() async throws {
        let server = FakeHomeServer(
            exposure: [
                "light.kitchen": ["conversation": true],
                "lock.front_door": ["conversation": true],
                "switch.secret": ["conversation": false],
            ], states: homeStates)
        let sink = RecordingSink()
        let ha = connector(server, sink)
        await ha.start(settings: settings, token: "test-token")
        #expect(await eventually { await isConnected(ha) })

        let subscriptions = server.received("subscribe_entities")
        #expect(subscriptions.count == 1)
        #expect(subscriptions.first?["entity_ids"] as? [String] == ["light.kitchen", "lock.front_door"])
        // Never a subscription to every state change.
        #expect(server.received("subscribe_events").isEmpty)
        #expect(server.received("get_states").isEmpty)
        #expect(server.received("auth").first?["access_token"] as? String == "test-token")
        #expect(await sink.exposures.last == ["light.kitchen", "lock.front_door"])
        await ha.stop()
    }

    @Test func ignoresStatesOfEntitiesThatArentExposed() async throws {
        let server = FakeHomeServer(
            exposure: ["light.kitchen": ["conversation": true]], states: homeStates)
        let sink = RecordingSink()
        let ha = connector(server, sink)
        await ha.start(settings: settings, token: "t")
        #expect(await eventually { await ha.states.keys.contains("light.kitchen") })
        #expect(Set(await ha.states.keys) == ["light.kitchen"])

        await ha.flushNow()
        let items = await sink.items
        #expect(items.map(\.id) == ["home:light.kitchen"])
        // Named and placed from the registries.
        #expect(items.first?.title == "Kitchen Light")
        #expect(items.first?.location == "Kitchen")
        #expect(await ha.currentItems().map(\.id) == ["home:light.kitchen"])
        await ha.stop()
    }

    @Test func nothingExposedMeansNoSubscription() async throws {
        let server = FakeHomeServer(exposure: [:], states: homeStates)
        let sink = RecordingSink()
        let ha = connector(server, sink)
        await ha.start(settings: settings, token: "t")
        #expect(await eventually { await ha.status == .connected(exposed: 0) })
        // An empty entity_ids would mean every entity.
        #expect(server.received("subscribe_entities").isEmpty)
        #expect(await ha.states.isEmpty)
        #expect(await sink.exposures == [[]])
        await ha.stop()
    }

    @Test func resubscribesWhenTheExposedListChanges() async throws {
        let server = FakeHomeServer(
            exposure: ["light.kitchen": ["conversation": true], "lock.front_door": ["conversation": true]],
            states: homeStates)
        let sink = RecordingSink()
        let ha = connector(server, sink)
        await ha.start(settings: settings, token: "t")
        #expect(await eventually { await ha.states.count == 2 })
        let first = try #require(server.lastSubscription)

        // A pending change of the lock, then the lock stops being exposed.
        server.push(["c": ["lock.front_door": ["+": ["s": "unlocked", "lc": 1_790_000_050]]]])
        #expect(await eventually { await ha.states["lock.front_door"]?.state == "unlocked" })
        server.exposure = ["light.kitchen": ["conversation": true], "switch.secret": ["conversation": true]]
        try await ha.refreshExposure()

        #expect(server.received("unsubscribe_events").first?["subscription"] as? Int == first)
        #expect(
            server.received("subscribe_entities").last?["entity_ids"] as? [String]
                == ["light.kitchen", "switch.secret"])
        #expect(await sink.exposures.last == ["light.kitchen", "switch.secret"])
        #expect(await ha.states["lock.front_door"] == nil)

        // Nothing about the lock goes up any more, and its events are ignored.
        server.push(["c": ["lock.front_door": ["+": ["s": "locked", "lc": 1_790_000_060]]]])
        await ha.flushNow()
        #expect(await sink.items.allSatisfy { !$0.id.contains("lock.front_door") })

        // The same list again: no new subscription.
        let count = server.received("subscribe_entities").count
        try await ha.refreshExposure()
        #expect(server.received("subscribe_entities").count == count)
        await ha.stop()
    }

    @Test func readsTheExposedListAgainOnEveryReconnect() async throws {
        let server = FakeHomeServer(exposure: ["light.kitchen": ["conversation": true]], states: homeStates)
        let sink = RecordingSink()
        let timing = ManualTiming()
        let ha = connector(server, sink, timing)
        await ha.start(settings: settings, token: "t")
        #expect(await eventually { await isConnected(ha) })

        // Changed while the connection was down.
        server.exposure = ["switch.secret": ["conversation": true]]
        server.disconnect()
        #expect(await eventually { server.connections == 2 })
        #expect(await eventually { server.received("subscribe_entities").count == 2 })

        #expect(server.received("homeassistant/expose_entity/list").count == 2)
        #expect(server.received("subscribe_entities").last?["entity_ids"] as? [String] == ["switch.secret"])
        #expect(await eventually { await ha.states.keys.contains("switch.secret") })
        #expect(await ha.states["light.kitchen"] == nil)
        #expect(timing.backoffs.first == 1)
        await ha.stop()
    }

    @Test func stopsRetryingWhenTheTokenIsRefused() async throws {
        let server = FakeHomeServer(exposure: ["light.kitchen": ["conversation": true]])
        server.acceptsToken = false
        let sink = RecordingSink()
        let ha = connector(server, sink)
        await ha.start(settings: settings, token: "wrong")
        #expect(
            await eventually {
                if case .failed(_, retrying: false) = await ha.status { return true }
                return false
            })
        try await Task.sleep(nanoseconds: 100_000_000)
        // Home Assistant bans addresses that keep failing: one attempt only.
        #expect(server.connections == 1)
        #expect(server.received("homeassistant/expose_entity/list").isEmpty)
        await ha.stop()
    }

    @Test func backsOffUpToAMinute() {
        #expect(HomeAssistantConnector.backoff(after: 0) == 1)
        #expect(HomeAssistantConnector.backoff(after: 1) == 2)
        #expect(HomeAssistantConnector.backoff(after: 5) == 32)
        #expect(HomeAssistantConnector.backoff(after: 6) == 60)
        #expect(HomeAssistantConnector.backoff(after: 1_000) == 60)
    }

    @Test func stoppingEndsTheConnection() async throws {
        let server = FakeHomeServer(exposure: ["light.kitchen": ["conversation": true]], states: homeStates)
        let sink = RecordingSink()
        let ha = connector(server, sink)
        await ha.start(settings: settings, token: "t")
        #expect(await eventually { await isConnected(ha) })
        await ha.stop()
        #expect(await ha.isRunning == false)
        #expect(await ha.status == .stopped)
        try await Task.sleep(nanoseconds: 50_000_000)
        #expect(server.connections == 1)
    }
}

// MARK: - Coalescing

@Suite("Home Assistant change coalescing")
struct HomeChangeCoalescerTests {
    private func entity(_ id: String, _ value: String, unit: String? = nil, at time: Double = 100)
        -> HomeEntityState
    {
        var attributes: [String: JSONValue] = [:]
        if let unit { attributes["unit_of_measurement"] = .string(unit) }
        return HomeEntityState(
            entityId: id, state: value, attributes: attributes, lastChanged: time, lastUpdated: time)
    }

    @Test func manyUpdatesBecomeOneUpload() {
        var coalescer = HomeChangeCoalescer()
        var before: HomeEntityState? = nil
        for watts in 0..<500 {
            let next = entity("sensor.power", String(watts), unit: "W", at: Double(watts))
            coalescer.observe(next, before: before)
            before = next
        }
        let items = coalescer.flush(now: 1_000, info: { _ in nil })
        #expect(items.map(\.id) == ["home:sensor.power"])
        #expect(items.first?.body == "sensor.power is 499 W")
    }

    @Test func measurementsGoUpAtMostEveryFiveMinutes() {
        var coalescer = HomeChangeCoalescer()
        coalescer.observe(entity("sensor.power", "10", unit: "W"), before: nil)
        #expect(coalescer.flush(now: 1_000, info: { _ in nil }).count == 1)
        coalescer.observe(entity("sensor.power", "11", unit: "W"), before: entity("sensor.power", "10", unit: "W"))
        #expect(coalescer.flush(now: 1_010, info: { _ in nil }).isEmpty)
        #expect(!coalescer.isEmpty)
        #expect(coalescer.flush(now: 1_000 + 301, info: { _ in nil }).map(\.id) == ["home:sensor.power"])
    }

    @Test func aStateChangeIsRecordedOnceFromFirstToLast() {
        var coalescer = HomeChangeCoalescer()
        let off = entity("light.kitchen", "off", at: 100)
        let on = entity("light.kitchen", "on", at: 110)
        let dim = entity("light.kitchen", "on", at: 110)
        coalescer.observe(on, before: off)
        coalescer.observe(dim, before: on)
        let items = coalescer.flush(now: 200, info: { _ in nil })
        #expect(items.map(\.id) == ["home:light.kitchen", "home:light.kitchen@110"])
        #expect(items.last?.extra?["from"] == .string("off"))
    }

    @Test func switchedOnAndBackOffRecordsNoChange() {
        var coalescer = HomeChangeCoalescer()
        let off = entity("light.kitchen", "off", at: 100)
        let on = entity("light.kitchen", "on", at: 105)
        let offAgain = entity("light.kitchen", "off", at: 108)
        coalescer.observe(on, before: off)
        coalescer.observe(offAgain, before: on)
        #expect(coalescer.flush(now: 200, info: { _ in nil }).map(\.id) == ["home:light.kitchen"])
    }

    @Test func aFlappingSensorStopsAtTwentyChangesAnHour() {
        var coalescer = HomeChangeCoalescer()
        var changes = 0
        for index in 0..<40 {
            let time = Double(index * 30)
            let from = entity("binary_sensor.door", index % 2 == 0 ? "off" : "on", at: time)
            let to = entity("binary_sensor.door", index % 2 == 0 ? "on" : "off", at: time + 1)
            coalescer.observe(to, before: from)
            changes += coalescer.flush(now: time + 10, info: { _ in nil }).filter { $0.id.contains("@") }.count
        }
        #expect(changes == HomeChangeCoalescer.maxChangesPerHour)
    }

    @Test func forgottenEntitiesSendNothing() {
        var coalescer = HomeChangeCoalescer()
        coalescer.observe(entity("lock.front_door", "unlocked"), before: entity("lock.front_door", "locked"))
        coalescer.forget(["lock.front_door"])
        #expect(coalescer.flush(now: 200, info: { _ in nil }).isEmpty)
    }

    @Test func presenceNeverKeepsCoordinates() {
        var states: [String: HomeEntityState] = [:]
        _ = HomeEntityDiff.apply(
            ["a": ["person.ria": state("home", ["friendly_name": "Ria", "latitude": 1.5, "longitude": 2.5, "gps_accuracy": 5])]],
            to: &states, allowed: ["person.ria"])
        let attributes = states["person.ria"]?.attributes ?? [:]
        #expect(attributes["latitude"] == nil)
        #expect(attributes["longitude"] == nil)
        #expect(attributes["gps_accuracy"] == nil)
        #expect(states["person.ria"]?.isPresence == true)
    }
}

// MARK: - Actions

@Suite("Home Assistant actions")
struct HomeAssistantActionTests {
    private func call(_ entityId: String, _ service: String, _ data: [String: JSONValue]? = nil) -> HomeServiceCall {
        HomeServiceCall(
            entityId: entityId, domain: String(entityId.split(separator: ".")[0]), service: service, data: data)
    }

    @Test func callsTheServiceWhileTheEntityIsExposed() async throws {
        let server = FakeHomeServer(exposure: ["light.kitchen": ["conversation": true]], states: homeStates)
        let ha = connector(server, RecordingSink())
        await ha.start(settings: settings, token: "t")
        #expect(await eventually { await isConnected(ha) })
        let reads = server.received("homeassistant/expose_entity/list").count

        let result = await ha.perform(call("light.kitchen", "turn_on", ["brightness_pct": .number(80)]))
        #expect(result.ok)
        // The exposed list was read again right before.
        #expect(server.received("homeassistant/expose_entity/list").count == reads + 1)
        let sent = try #require(server.received("call_service").first)
        #expect(sent["domain"] as? String == "light")
        #expect(sent["service"] as? String == "turn_on")
        #expect((sent["target"] as? [String: Any])?["entity_id"] as? String == "light.kitchen")
        #expect((sent["service_data"] as? [String: Any])?["brightness_pct"] as? Int == 80)
        await ha.stop()
    }

    @Test func refusesAnEntityNoLongerExposed() async throws {
        let server = FakeHomeServer(
            exposure: ["lock.front_door": ["conversation": true], "light.kitchen": ["conversation": true]],
            states: homeStates)
        let ha = connector(server, RecordingSink())
        await ha.start(settings: settings, token: "t")
        #expect(await eventually { await isConnected(ha) })

        // Unexposed in Home Assistant after the user confirmed.
        server.exposure = ["light.kitchen": ["conversation": true]]
        let result = await ha.perform(call("lock.front_door", "unlock"))
        #expect(!result.ok)
        #expect(result.error?.contains("no longer exposed") == true)
        #expect(server.received("call_service").isEmpty)
        await ha.stop()
    }

    @Test func refusesCallsOutsideTheAllowedList() async throws {
        let server = FakeHomeServer(exposure: ["alarm_control_panel.home": ["conversation": true]])
        let ha = connector(server, RecordingSink())
        await ha.start(settings: settings, token: "t")
        #expect(await eventually { await isConnected(ha) })
        #expect(!(await ha.perform(call("alarm_control_panel.home", "alarm_disarm"))).ok)
        #expect(server.received("call_service").isEmpty)
        await ha.stop()

        #expect(HomeServiceRules.problem(call("light.kitchen", "turn_on", ["brightness_pct": .number(150)])) != nil)
        #expect(HomeServiceRules.problem(call("lock.front_door", "unlock", ["code": .string("1234")])) != nil)
        #expect(HomeServiceRules.problem(call("light.kitchen", "turn_on", ["rgb_color": .number(1)])) != nil)
        #expect(HomeServiceRules.problem(call("climate.hall", "set_hvac_mode", ["hvac_mode": .string("turbo")])) != nil)
        #expect(
            HomeServiceRules.problem(
                HomeServiceCall(entityId: "lock.front_door", domain: "light", service: "turn_on")) != nil)
        #expect(HomeServiceRules.problem(call("media_player.tv", "volume_set", ["volume_level": .number(0.4)])) == nil)
        #expect(HomeServiceRules.problem(call("scene.movie", "turn_on")) == nil)
    }

    @Test func notConnectedRefuses() async {
        let server = FakeHomeServer(exposure: [:])
        let ha = connector(server, RecordingSink())
        #expect(await ha.perform(call("light.kitchen", "turn_on")) == HomeActionError.notConnected())
    }
}

// MARK: - The action queue

private final class QueueServer: DeviceActionsAPI, @unchecked Sendable {
    let lock = NSLock()
    var pending: [DeviceAction]
    var reports: [String: DeviceActionResult] = [:]
    init(_ pending: [DeviceAction]) { self.pending = pending }
    func pendingActions() async throws -> [DeviceAction] { lock.withLock { pending } }
    func report(_ id: String, _ result: DeviceActionResult) async throws {
        lock.withLock {
            reports[id] = result
            pending.removeAll { $0.id == id }
        }
    }
}

private final class NoLedger: DeviceActionLedger, @unchecked Sendable {
    func result(for id: String) async throws -> DeviceActionResult? { nil }
    func save(_ result: DeviceActionResult, for id: String) async throws {}
}

private final class NoCalendar: CalendarWriting, @unchecked Sendable {
    func writableCalendars() -> [WritableCalendar] { [] }
    func defaultCalendarId() -> String? { nil }
    func existingEvent(marker: URL, around start: Date) -> WrittenCalendarEvent? { nil }
    func create(_ event: DeviceAction.Event, calendarId: String?, marker: URL) throws -> WrittenCalendarEvent {
        throw CalendarActionError.noCalendar
    }
}

private final class RecordingPerformer: HomeActionPerforming, @unchecked Sendable {
    let lock = NSLock()
    var calls: [HomeServiceCall] = []
    func perform(_ call: HomeServiceCall) async -> DeviceActionResult {
        lock.withLock { calls.append(call) }
        return DeviceActionResult(ok: true)
    }
}

@Suite("Home Assistant action queue")
struct HomeActionQueueTests {
    private let now = Date(timeIntervalSince1970: 1_790_000_000)

    private func action(_ id: String, expires: String?) -> DeviceAction {
        DeviceAction(
            id: id, type: "home_service", source: "home", event: nil,
            call: HomeServiceCall(entityId: "light.kitchen", domain: "light", service: "turn_on"),
            expiresAt: expires)
    }

    @Test func decodesTheServersHomeActions() throws {
        let json = #"""
            {"actions":[{"id":"a1","type":"home_service","source":"home","createdAt":"2026-09-21T10:00:00.000Z","expiresAt":"2026-09-21T10:15:00.000Z","call":{"entityId":"cover.garage","domain":"cover","service":"open_cover","name":"Garage","sensitive":true}}]}
            """#
        struct Reply: Decodable { var actions: [DeviceAction] }
        let reply = try JSONDecoder().decode(Reply.self, from: Data(json.utf8))
        #expect(reply.actions.first?.call?.entityId == "cover.garage")
        #expect(reply.actions.first?.call?.sensitive == true)
        #expect(reply.actions.first?.event == nil)
    }

    @Test func runsUnexpiredActionsThroughTheConnector() async throws {
        let server = QueueServer([
            action("fresh", expires: "2026-09-21T10:15:00.000Z"),
            action("stale", expires: "2026-09-21T09:00:00.000Z"),
            action("no-expiry", expires: nil),
        ])
        let performer = RecordingPerformer()
        let runner = CalendarActionRunner(
            api: server, writer: NoCalendar(), ledger: NoLedger(), calendarId: nil, home: performer,
            now: { ISO8601DateFormatter().date(from: "2026-09-21T10:05:00Z")! })
        #expect(try await runner.run() == 3)
        #expect(server.reports["fresh"]?.ok == true)
        #expect(server.reports["stale"] == HomeActionError.expired())
        #expect(server.reports["no-expiry"] == HomeActionError.expired())
        #expect(performer.calls.count == 1)
    }

    @Test func withoutAConnectionItFails() async throws {
        let server = QueueServer([action("a", expires: "2026-09-21T10:15:00Z")])
        let runner = CalendarActionRunner(
            api: server, writer: NoCalendar(), ledger: NoLedger(), calendarId: nil, home: nil,
            now: { ISO8601DateFormatter().date(from: "2026-09-21T10:05:00Z")! })
        try await runner.run()
        #expect(server.reports["a"] == HomeActionError.notConnected())
    }
}

// MARK: - Settings and the Keychain

@Suite("Home Assistant settings")
struct HomeAssistantSettingsTests {
    private func store() -> (HomeAssistantSettingsStore, MemoryCredentials) {
        let credentials = MemoryCredentials()
        let defaults = UserDefaults(suiteName: "home-tests-\(UUID().uuidString)")!
        return (HomeAssistantSettingsStore(defaults: defaults, credentials: credentials), credentials)
    }

    @Test func checksTheAddress() throws {
        #expect(try HomeAssistantSettings.validatedURL("http://homeassistant.local:8123/").absoluteString
            == "http://homeassistant.local:8123")
        #expect(try HomeAssistantSettings.validatedURL(" http://192.168.1.20:8123 ").host == "192.168.1.20")
        #expect(try HomeAssistantSettings.validatedURL("https://ha.example.com").scheme == "https")
        #expect(throws: HomeAssistantError.insecureURL) {
            try HomeAssistantSettings.validatedURL("http://ha.example.com")
        }
        #expect(throws: HomeAssistantError.insecureURL) {
            try HomeAssistantSettings.validatedURL("http://8.8.8.8:8123")
        }
        #expect(throws: HomeAssistantError.invalidURL) {
            try HomeAssistantSettings.validatedURL("https://user:pass@ha.example.com")
        }
        #expect(throws: HomeAssistantError.invalidURL) {
            try HomeAssistantSettings.validatedURL("ftp://ha.local")
        }
        #expect(throws: HomeAssistantError.invalidURL) {
            try HomeAssistantSettings.validatedURL("https://ha.example.com/?token=1")
        }
        let wss = HomeAssistantSettings(url: try HomeAssistantSettings.validatedURL("https://ha.example.com/proxy"))
        #expect(wss.webSocketURL.absoluteString == "wss://ha.example.com/proxy/api/websocket")
        #expect(settings.webSocketURL.absoluteString == "ws://homeassistant.local:8123/api/websocket")
    }

    @Test func checksTheToken() throws {
        #expect(try HomeAssistantSettings.validatedToken("  abc.def  ") == "abc.def")
        #expect(throws: HomeAssistantError.invalidToken) { try HomeAssistantSettings.validatedToken("") }
        #expect(throws: HomeAssistantError.invalidToken) { try HomeAssistantSettings.validatedToken("a b") }
    }

    @Test func theTokenLivesOnlyInTheCredentialStore() throws {
        let (store, credentials) = store()
        #expect(store.load() == nil)
        try store.save(settings, token: "secret-token")
        #expect(store.load()?.token == "secret-token")
        #expect(credentials.accounts == [settings.account])
        // The address is a setting; the token isn't stored next to it.
        let saved = store.defaults.dictionaryRepresentation().values.compactMap { $0 as? String }
        #expect(!saved.contains { $0.contains("secret-token") })
    }

    @Test func anotherAddressForgetsTheOldToken() throws {
        let (store, credentials) = store()
        try store.save(settings, token: "one")
        let other = HomeAssistantSettings(url: URL(string: "https://ha.example.com")!)
        try store.save(other, token: "two")
        #expect(credentials.accounts == [other.account])
        #expect(store.load()?.settings == other)
        store.remove()
        #expect(credentials.accounts.isEmpty)
        #expect(store.load() == nil)
    }
}

// MARK: - Storing and uploading

@Suite("Home Assistant items on this Mac")
struct HomeEngineTests {
    private func engine() throws -> MacDataEngine {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("home-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return MacDataEngine(storePath: url.appendingPathComponent("store.sqlite").path, retriesUploads: false)
    }

    private func item(_ entityId: String, _ value: String, at time: Double, change: String? = nil) -> MacDataItem {
        let entity = HomeEntityState(
            entityId: entityId, state: value, attributes: [:], lastChanged: time, lastUpdated: time)
        if let change { return HomeItems.change(entity, from: change, info: nil) }
        return HomeItems.state(entity, info: nil)
    }

    @Test func storesOnlyExposedEntitiesWhileTheSourceIsOn() async throws {
        let engine = try engine()
        try await engine.setHomeExposure(["light.kitchen"])
        #expect(try await engine.applyHome([item("light.kitchen", "on", at: 1)]) == 0)

        try await engine.enable(.home)
        let applied = try await engine.applyHome([
            item("light.kitchen", "on", at: 1), item("switch.secret", "on", at: 1),
        ])
        #expect(applied == 1)
        #expect(try await engine.store().items(source: .home).map(\.id) == ["home:light.kitchen"])
    }

    @Test func unexposingDropsTheLocalCopyWithoutReportingRemovals() async throws {
        let engine = try engine()
        try await engine.enable(.home)
        try await engine.setHomeExposure(["light.kitchen", "lock.front_door"])
        try await engine.applyHome([
            item("light.kitchen", "on", at: 1), item("lock.front_door", "locked", at: 1),
            item("lock.front_door", "unlocked", at: 2, change: "locked"),
        ])
        let store = try await engine.store()
        let seq = try store.latestChangeSeq()

        #expect(try await engine.setHomeExposure(["light.kitchen"]))
        #expect(try store.items(source: .home).map(\.id) == ["home:light.kitchen"])
        // The server keeps its copy, hidden: nothing is sent as removed.
        #expect(try store.changes(after: seq, limit: 10).isEmpty)
        #expect(try await engine.homeExposure() == ["light.kitchen"])
        #expect(try await engine.setHomeExposure(["light.kitchen"]) == false)
    }

    @Test func uploadsLeaveOutUnexposedEntities() async throws {
        let engine = try engine()
        try await engine.setHomeExposure(["light.kitchen"])
        let kept = try await engine.withoutUnexposedHomeItems([
            item("light.kitchen", "on", at: 1), item("switch.secret", "on", at: 1),
        ])
        #expect(kept.map(\.id) == ["home:light.kitchen"])
    }

    @Test func currentStatesAreKeptHoweverOld() async throws {
        let engine = try engine()
        try await engine.enable(.home)
        try await engine.setHomeExposure(["light.kitchen"])
        try await engine.applyHome([
            item("light.kitchen", "off", at: 1_000),
            item("light.kitchen", "off", at: 1_000, change: "on"),
        ])
        let store = try await engine.store()
        try store.pruneExpired(now: Date(timeIntervalSince1970: 1_790_000_000))
        #expect(try store.items(source: .home).map(\.id) == ["home:light.kitchen"])
        // And never embedded: there's nothing to search by meaning in "Kitchen is off".
        #expect(try store.itemsNeedingEmbedding(limit: 10).isEmpty)
    }

    @Test func statusSaysWhatsMissing() async throws {
        let engine = try engine()
        try await engine.enable(.home)
        var status = try await engine.statuses().first { $0.source == .home }
        #expect(status?.state == .needsAccess)

        await engine.setHomeState(configured: true, status: .failed("Nope", retrying: false))
        status = try await engine.statuses().first { $0.source == .home }
        #expect(status?.state == .needsAccess)
        #expect(status?.message == "Nope")

        await engine.setHomeState(configured: true, status: .connected(exposed: 3))
        status = try await engine.statuses().first { $0.source == .home }
        #expect(status?.state == .ready)
        #expect(await engine.sync(.home) == false)
    }
}
#endif
