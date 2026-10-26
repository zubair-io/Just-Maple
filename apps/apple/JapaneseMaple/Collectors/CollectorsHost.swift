//
//  CollectorsHost.swift
//  JapaneseMaple
//
//  Runs the iPhone's collectors (Location and Health) and lets the web app's Devices
//  page turn them on and off:
//
//    window.webkit.messageHandlers.deviceCollectors.postMessage({ action, ... })
//
//  Actions, each answered with a Promise:
//    status            → { location: SourceStatus, health: SourceStatus }
//    enable { source } → asks permission if needed, starts collecting, returns status
//    disable { source }→ stops collecting, returns status
//    syncNow           → collects and uploads now, returns status
//
//  SourceStatus is { available, authorized, enabled, lastUploadAt, pending }, plus for
//  location `permission` ("always", "whenInUse", "denied", …), `places` (the named
//  places' names) and `lastTravelUpdate` (the last travel-time pass, or null).
//
//  Enabled flags live in UserDefaults; enabled collectors resume at every launch,
//  including background launches for a visit or new Health data. While Places is on,
//  travel times to upcoming events are refreshed on foreground, after visits, and from
//  a background app refresh task.
//

#if os(iOS)
import BackgroundTasks
import Foundation
import UIKit
import WebKit

@MainActor
final class CollectorsHost: NSObject, WKScriptMessageHandlerWithReply {
    static let shared = CollectorsHost()
    static let handlerName = "deviceCollectors"
    static let sources: [DeviceSource] = [.location, .health]
    /// Re-register at least this often so the server's "last seen" and time zone stay fresh.
    static let registrationInterval: TimeInterval = 6 * 60 * 60
    /// Background refresh for travel times; also listed in Info.plist's
    /// `BGTaskSchedulerPermittedIdentifiers`.
    static let refreshTaskId = "com.just.maple.JapaneseMaple.travel-refresh"
    static let refreshInterval: TimeInterval = 15 * 60

    private let client = DeviceDataClient.shared
    private(set) lazy var location = LocationCollector(client: client)
    private(set) lazy var health = HealthCollector(client: client)
    private(set) lazy var travel = TravelCollector(client: client)
    private var resumed = false
    private var registered: (sources: [DeviceSource], active: Set<DeviceSource>, at: Date)?
    private var observers: [NSObjectProtocol] = []

    // MARK: - Enabled flags

    private static func enabledKey(_ source: DeviceSource) -> String {
        "collectors.\(source.rawValue).enabled"
    }

    func isEnabled(_ source: DeviceSource) -> Bool {
        UserDefaults.standard.bool(forKey: Self.enabledKey(source))
    }

    private func setEnabled(_ source: DeviceSource, _ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: Self.enabledKey(source))
    }

    // MARK: - Lifecycle

    /// Called at launch (also background launches), before any web view exists.
    func resume() {
        guard !resumed else { return }
        resumed = true

        location.beforeUpload = { [weak self] in try await self?.ensureRegistered(.location) ?? false }
        health.beforeUpload = { [weak self] in try await self?.ensureRegistered(.health) ?? false }
        travel.beforeUpload = { [weak self] in try await self?.ensureRegistered(.location) ?? false }
        travel.places = { [weak self] in self?.location.places ?? [] }
        location.onMoved = { [weak self] in self?.updateTravelSoon() }

        // Must be registered before launch finishes, even while Places is off.
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.refreshTaskId, using: .main) {
            task in
            MainActor.assumeIsolated { CollectorsHost.shared.runBackgroundRefresh(task) }
        }

        if isEnabled(.location) {
            location.start()
            let inForeground = UIApplication.shared.applicationState != .background
            Task {
                await location.refreshPlaces(force: true)
                if inForeground { await travelUpdate() }
            }
            scheduleBackgroundRefresh()
        }
        if isEnabled(.health), HealthCollector.isAvailable { health.start() }

        observers.append(
            NotificationCenter.default.addObserver(
                forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main
            ) { [weak self] _ in
                Task { @MainActor in await self?.refreshOnForeground() }
            })
        observers.append(
            NotificationCenter.default.addObserver(
                forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
            ) { _ in
                Task { @MainActor in CollectorsHost.shared.scheduleBackgroundRefresh() }
            })
    }

    func attach(to webView: WKWebView) {
        resume()
        webView.configuration.userContentController.addScriptMessageHandler(
            self, contentWorld: .page, name: Self.handlerName)
    }

    private func refreshOnForeground() async {
        if isEnabled(.location) {
            await location.refreshPlaces(force: true)
            await location.flush()
            await travelUpdate()
        }
        if isEnabled(.health) { await health.sync() }
    }

    // MARK: - Travel times

    private var travelEnabled: Bool { isEnabled(.location) && location.canCollect }

    private func travelUpdate() async {
        guard travelEnabled else { return }
        await travel.update()
    }

    /// After a visit or a named-place crossing.
    private func updateTravelSoon() {
        guard travelEnabled else { return }
        Task { await travel.update() }
    }

    /// Asks iOS to wake the app in about 15 minutes. iOS decides when, or whether, it runs.
    private func scheduleBackgroundRefresh() {
        guard isEnabled(.location) else {
            BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.refreshTaskId)
            return
        }
        let request = BGAppRefreshTaskRequest(identifier: Self.refreshTaskId)
        request.earliestBeginDate = Date(timeIntervalSinceNow: Self.refreshInterval)
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            // Simulator, or Background App Refresh is off for this app.
            print("[Collectors] Background refresh not scheduled: \(error.localizedDescription)")
        }
    }

    private func runBackgroundRefresh(_ task: BGTask) {
        scheduleBackgroundRefresh()
        let work = Task { @MainActor in
            guard self.travelEnabled else { return }
            await self.location.refreshPlaces()
            await self.travel.update()
            await self.location.flush()
        }
        task.expirationHandler = { work.cancel() }
        Task { @MainActor in
            await work.value
            task.setTaskCompleted(success: !work.isCancelled)
        }
    }

    // MARK: - Registration

    /// Sources this device collects right now: switched on and allowed.
    private func collectingSources() async -> [DeviceSource] {
        var sources: [DeviceSource] = []
        if isEnabled(.location), location.canCollect { sources.append(.location) }
        if isEnabled(.health), HealthCollector.isAvailable, await health.hasAsked() {
            sources.append(.health)
        }
        return sources
    }

    /// Registers before uploading when the sources changed or it's been a while.
    /// Returns whether this phone is the device collecting `source`.
    private func ensureRegistered(_ source: DeviceSource) async throws -> Bool {
        let sources = await collectingSources()
        if let registered, registered.sources == sources,
            Date().timeIntervalSince(registered.at) < Self.registrationInterval
        {
            return registered.active.contains(source)
        }
        return try await register(sources).contains(source)
    }

    @discardableResult
    private func register(_ sources: [DeviceSource]) async throws -> Set<DeviceSource> {
        let collector = try await client.register(name: UIDevice.current.name, sources: sources)
        let active = Set(collector.activeSources)
        // A source that moved to another device: the server dropped this phone's copy.
        for source in registered?.active ?? [] where !active.contains(source) {
            if source == .location { location.uploadsMovedAway() }
            if source == .health { health.uploadsMovedAway() }
        }
        registered = (sources, active, Date())
        if active.contains(.location) {
            // Not awaited: registering can happen in the middle of an upload.
            Task { await self.location.refreshPlaces(force: true) }
        }
        let inactive = sources.filter { !active.contains($0) }
        if !inactive.isEmpty {
            // Another device collects these; uploads wait until this phone collects them.
            print("[Collectors] Another device collects: \(inactive.map(\.rawValue))")
        }
        return active
    }

    /// After a switch is flipped: tell the server now, even with nothing to upload.
    private func registerNow() async {
        do {
            try await register(await collectingSources())
        } catch {
            print("[Collectors] Registration failed: \(error.localizedDescription)")
        }
    }

    // MARK: - Web → Native

    func userContentController(
        _ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
        replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void
    ) {
        guard let body = message.body as? [String: Any], let action = body["action"] as? String
        else {
            replyHandler(nil, "Invalid request")
            return
        }
        Task {
            do {
                replyHandler(try await self.handle(action, body), nil)
            } catch {
                replyHandler(nil, error.localizedDescription)
            }
        }
    }

    private enum HostError: LocalizedError {
        case unknownAction(String)
        case badSource
        case unavailable(DeviceSource)

        var errorDescription: String? {
            switch self {
            case .unknownAction(let action): "Unknown action: \(action)"
            case .badSource: "source must be \"location\" or \"health\""
            case .unavailable(let source): "\(source.rawValue.capitalized) isn't available on this device"
            }
        }
    }

    private func handle(_ action: String, _ body: [String: Any]) async throws -> Any {
        switch action {
        case "status":
            return await status()
        case "enable":
            try await enable(try Self.source(body))
            return await status()
        case "disable":
            disable(try Self.source(body))
            await registerNow()
            return await status()
        case "syncNow":
            await registerNow()
            if isEnabled(.location) {
                await location.refreshPlaces(force: true)
                await location.flush()
                await travelUpdate()
            }
            if isEnabled(.health) { await health.sync(force: true) }
            return await status()
        default:
            throw HostError.unknownAction(action)
        }
    }

    private static func source(_ body: [String: Any]) throws -> DeviceSource {
        guard let raw = body["source"] as? String, let source = DeviceSource(rawValue: raw),
            CollectorsHost.sources.contains(source)
        else { throw HostError.badSource }
        return source
    }

    func enable(_ source: DeviceSource) async throws {
        switch source {
        case .location:
            await location.requestPermission()
            guard location.canCollect else {
                // Denied: nothing to collect. The page explains how to allow it in Settings.
                setEnabled(.location, false)
                return
            }
            setEnabled(.location, true)
            location.start()
            scheduleBackgroundRefresh()
            await registerNow()
            await location.refreshPlaces(force: true)
            updateTravelSoon()
        case .health:
            guard HealthCollector.isAvailable else { throw HostError.unavailable(.health) }
            try await health.requestPermission()
            setEnabled(.health, true)
            health.start()
            await registerNow()
            await health.sync(force: true)
        default:
            throw HostError.badSource
        }
    }

    func disable(_ source: DeviceSource) {
        setEnabled(source, false)
        switch source {
        case .location:
            location.stop()
            scheduleBackgroundRefresh()
        case .health: health.stop()
        default: break
        }
    }

    // MARK: - Status

    func status() async -> [String: Any] {
        let healthAsked = await health.hasAsked()
        return [
            "location": [
                "available": true,
                "authorized": location.isAuthorized,
                "permission": location.permission,
                "enabled": isEnabled(.location),
                "lastUploadAt": Self.iso(location.state.lastUploadAt),
                "pending": location.pendingCount,
                "places": location.places.map(\.name),
                "lastTravelUpdate": Self.iso(travel.lastUpdate),
            ],
            "health": [
                "available": HealthCollector.isAvailable,
                "authorized": healthAsked,
                "enabled": isEnabled(.health),
                "lastUploadAt": Self.iso(health.state.lastUploadAt),
                "pending": health.pendingCount,
            ],
        ]
    }

    private static func iso(_ date: Date?) -> Any {
        guard let date else { return NSNull() }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}
#endif
