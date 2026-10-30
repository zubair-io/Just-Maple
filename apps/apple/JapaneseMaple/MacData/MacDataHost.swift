//
//  MacDataHost.swift
//  JapaneseMaple
//
//  Connects the Mac data engine to the web app:
//  - answers `window.webkit.messageHandlers.macData.postMessage({ action, ... })`
//    with a Promise result,
//  - watches Messages, Mail, Calendar and Contacts for changes and re-reads them,
//  - uploads what changed to the cloud, where pages (type `devicedata`) and bots read it,
//  - tells the page what changed with a `maple:mac-data` window event.
//
//  Actions: status, relayStatus, requestAccess {source}, syncNow {source?},
//  enableSource {source}, disableSource {source}, actionCalendars /
//  setActionCalendar {calendarId?} for where "Add to calendar" puts events, and
//  listPages / deletePage for moving the old local-only pages to the cloud.
//
//  It also adds the events the user confirmed in chats (CalendarActions) after each
//  upload, on every poll, when the relay connects, and when the server asks.
//
//  Home Assistant (HomeAssistant/): homeStatus, and homeOpenSettings for the native
//  window where the address and token are entered (the token never reaches the page).
//  The connector runs while the source is on, it's set up, and the server takes Home
//  Assistant from this Mac.
//

#if os(macOS)
import AppKit
import Contacts
import EventKit
import Foundation
import WebKit

@MainActor
final class MacDataHost: NSObject, WKScriptMessageHandlerWithReply {
    static let shared = MacDataHost()
    static let handlerName = "macData"

    /// Safety net for missed file events; the watchers normally trigger sooner.
    private static let pollInterval: TimeInterval = 120

    private let engine = MacDataEngine()
    private lazy var connection = MacDataConnection(engine: engine)
    private weak var webView: WKWebView?
    private var started = false
    private var watchers: [MacDataFileWatcher] = []
    private var pollTimer: Timer?
    private var observers: [NSObjectProtocol] = []
    private let homeSettings = HomeAssistantSettingsStore()
    /// Read from the Keychain at launch and after the settings window saves.
    private lazy var homeCredentials = homeSettings.load()
    private lazy var homeConnector = HomeAssistantConnector(
        sink: HomeEngineSink(engine: engine) { [weak self] change in
            self?.homeChanged(change)
        })

    func attach(to webView: WKWebView) {
        self.webView = webView
        webView.configuration.userContentController.addScriptMessageHandler(
            self, contentWorld: .page, name: Self.handlerName)
        start()
    }

    // MARK: - Lifecycle

    private func start() {
        guard !started else { return }
        started = true

        watchers = [
            MacDataFileWatcher(paths: [MacDataPaths.messagesDatabase.deletingLastPathComponent().path]) {
                [weak self] in self?.sync(.imessage)
            },
            MacDataFileWatcher(paths: [MacDataPaths.mailRoot.path]) { [weak self] in
                self?.sync(.mail)
            },
        ]

        observers.append(
            NotificationCenter.default.addObserver(
                forName: .EKEventStoreChanged, object: nil, queue: .main
            ) { [weak self] _ in
                Task { @MainActor in self?.sync(.calendar) }
            })
        observers.append(
            NotificationCenter.default.addObserver(
                forName: .CNContactStoreDidChange, object: nil, queue: .main
            ) { [weak self] _ in
                Task { @MainActor in self?.sync(.contacts) }
            })
        // A new sign-in may be a different account: register again, then upload.
        observers.append(
            NotificationCenter.default.addObserver(
                forName: ServerConfigService.tokenDidChange, object: nil, queue: .main
            ) { [weak self] _ in
                Task { @MainActor in
                    guard let self else { return }
                    await self.engine.registrationChanged()
                    self.upload()
                }
            })
        // Full Disk Access is granted in System Settings; re-check when the user comes back.
        observers.append(
            NotificationCenter.default.addObserver(
                forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main
            ) { [weak self] _ in
                Task { @MainActor in self?.syncAll() }
            })

        pollTimer = Timer.scheduledTimer(withTimeInterval: Self.pollInterval, repeats: true) {
            [weak self] _ in
            Task { @MainActor in self?.syncAll() }
        }
        syncAll()
        // Registers this Mac and resumes an upload a previous launch didn't finish.
        upload()
        connection.onStateChange = { [weak self] state in
            Task { @MainActor in
                await self?.emitStatus()
                // Back online: add anything confirmed while this Mac was away.
                if state == "Connected" { self?.runActions() }
            }
        }
        connection.onActionsRequested = { [weak self] in self?.runActions() }
        connection.start()
        HomeAssistantSettingsWindow.shared.onChange = { [weak self] in
            guard let self else { return }
            self.homeCredentials = self.homeSettings.load()
            self.updateHome()
        }
    }

    /// Starts or stops the Home Assistant connection to match the settings and the server.
    private func updateHome() {
        Task {
            let enabled = (try? await engine.enabledSources())?.contains(.home) == true
            let active = await engine.homeIsActive
            if let credentials = homeCredentials, enabled, active {
                await homeConnector.start(settings: credentials.settings, token: credentials.token)
                await engine.setHomePerformer(homeConnector)
            } else {
                await engine.setHomePerformer(nil)
                await homeConnector.stop()
            }
            await engine.setHomeState(
                configured: homeCredentials != nil, status: await homeConnector.status)
            await emitStatus()
        }
    }

    private func homeChanged(_ change: HomeEngineSink.Change) {
        switch change {
        case .items:
            upload()
        case .exposure:
            emit(["type": "changed", "source": MacDataSource.home.rawValue])
            upload()
        case .status:
            Task { await self.emitStatus() }
        }
    }

    private func syncAll() {
        Task {
            for source in (try? await engine.enabledSources()) ?? [] {
                sync(source)
            }
        }
        runActions()
    }

    /// Adds events the user confirmed in JapaneseMaple; registers first if needed.
    private func runActions() {
        Task {
            if await engine.registration == nil { await engine.uploadPending() }
            await engine.runActions()
        }
    }

    private func sync(_ source: MacDataSource) {
        Task {
            await self.emitStatus()
            let changed = await engine.sync(source)
            if changed {
                self.emit(["type": "changed", "source": source.rawValue])
            }
            await self.emitStatus()
            // Text first, so keyword search works right away; vectors follow once embedded.
            await engine.uploadPending()
            if await engine.embedPending() > 0 {
                await engine.uploadPending()
            }
            await self.emitStatus()
            if source == .home { self.updateHome() }
        }
    }

    private func upload() {
        Task {
            await engine.uploadPending()
            await self.emitStatus()
            await engine.runActions()
            self.updateHome()
        }
    }

    /// Calendar and Contacts ask for permission in a system prompt; Messages and Mail
    /// need Full Disk Access, which only System Settings can grant.
    private func requestAccess(_ source: MacDataSource, openSettingsIfDenied: Bool) async {
        switch source {
        case .calendar:
            if !(await engine.requestCalendarAccess()), openSettingsIfDenied, CalendarReader.accessDenied {
                Self.openPrivacySettings("Privacy_Calendars")
            }
        case .contacts:
            if !(await engine.requestContactsAccess()), openSettingsIfDenied, ContactsReader.accessDenied {
                Self.openPrivacySettings("Privacy_Contacts")
            }
        case .imessage, .mail:
            if openSettingsIfDenied { Self.openPrivacySettings("Privacy_AllFiles") }
        case .home:
            // "Access" is the address and token, entered in a native window.
            if openSettingsIfDenied || homeCredentials == nil { HomeAssistantSettingsWindow.shared.show() }
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

    private func handle(_ action: String, _ body: [String: Any]) async throws -> Any? {
        switch action {
        case "status":
            return try Self.json(await engine.statuses())

        case "relayStatus":
            return connection.state

        case "enableSource":
            // A device data page for this source was created or opened.
            let source = try Self.source(body)
            if try await engine.enable(source) {
                await engine.registrationChanged()
            }
            // The page shouldn't wait on a system prompt the user may leave open.
            Task {
                await self.requestAccess(source, openSettingsIfDenied: false)
                self.sync(source)
            }
            return true

        case "disableSource":
            let source = try Self.source(body)
            if try await engine.disable(source) {
                await engine.registrationChanged()
            }
            if source == .home { updateHome() }
            upload()
            await emitStatus()
            return true

        // The old local-only pages, read once by the web app to move them to the cloud.
        case "listPages":
            return try Self.json(await engine.pages(notebookId: body["notebookId"] as? String))

        // Where "Add to calendar" puts events: one of these, or the default calendar.
        case "actionCalendars":
            let (calendars, selected, defaultId) = try await engine.actionCalendars()
            return [
                "calendars": try Self.json(calendars),
                "selected": selected ?? NSNull(),
                "defaultId": defaultId ?? NSNull(),
            ]

        case "setActionCalendar":
            try await engine.setActionCalendar(body["calendarId"] as? String)
            return true

        // Home Assistant: whether it's set up and connected; never the token.
        case "homeStatus":
            let status = await homeConnector.status
            var reply: [String: Any] = [
                "configured": homeCredentials != nil,
                "url": homeSettings.settings?.url.absoluteString ?? NSNull(),
                "state": "stopped",
            ]
            switch status {
            case .stopped: break
            case .connecting: reply["state"] = "connecting"
            case .connected(let exposed):
                reply["state"] = "connected"
                reply["exposed"] = exposed
            case .failed(let message, let retrying):
                reply["state"] = retrying ? "retrying" : "failed"
                reply["error"] = message
            }
            return reply

        case "homeOpenSettings":
            HomeAssistantSettingsWindow.shared.show()
            return true

        case "deletePage":
            try await engine.deletePage(id: try Self.string(body, "id"))
            return true

        case "requestAccess":
            let source = try Self.source(body)
            await requestAccess(source, openSettingsIfDenied: true)
            sync(source)
            return true

        case "syncNow":
            if let raw = body["source"] as? String, let source = MacDataSource(rawValue: raw) {
                sync(source)
            } else {
                syncAll()
            }
            return true

        default:
            throw MacDataError.invalid("Unknown Mac data action: \(action)")
        }
    }

    // MARK: - Native → Web

    private func emitStatus() async {
        guard let statuses = try? await engine.statuses(), let json = try? Self.json(statuses)
        else { return }
        var detail: [String: Any] = ["type": "status", "statuses": json, "relay": connection.state]
        if let upload = try? await engine.uploadStatus(), let uploadJSON = try? Self.json(upload) {
            detail["upload"] = uploadJSON
        }
        emit(detail)
    }

    private func emit(_ detail: [String: Any]) {
        guard let webView,
            let data = try? JSONSerialization.data(withJSONObject: detail),
            let json = String(data: data, encoding: .utf8)
        else { return }
        webView.evaluateJavaScript(
            "window.dispatchEvent(new CustomEvent('maple:mac-data', { detail: \(json) }))")
    }

    // MARK: - Helpers

    private static func json<T: Encodable>(_ value: T) throws -> Any {
        try JSONSerialization.jsonObject(
            with: JSONEncoder().encode(value), options: .fragmentsAllowed)
    }

    private static func string(_ body: [String: Any], _ key: String) throws -> String {
        guard let value = body[key] as? String, !value.isEmpty else {
            throw MacDataError.invalid("Missing \(key).")
        }
        return value
    }

    private static func source(_ body: [String: Any]) throws -> MacDataSource {
        guard let raw = body["source"] as? String, let source = MacDataSource(rawValue: raw) else {
            throw MacDataError.invalid("Unknown data source.")
        }
        return source
    }

    private static func openPrivacySettings(_ anchor: String) {
        if let url = URL(
            string: "x-apple.systempreferences:com.apple.preference.security?\(anchor)")
        {
            NSWorkspace.shared.open(url)
        }
    }
}

/// Calls `onChange` on the main queue a few seconds after files under `paths` change.
nonisolated final class MacDataFileWatcher: @unchecked Sendable {
    private var stream: FSEventStreamRef?
    private let onChange: @MainActor () -> Void

    init(paths: [String], latency: TimeInterval = 5, onChange: @escaping @MainActor () -> Void) {
        self.onChange = onChange
        var context = FSEventStreamContext(
            version: 0, info: Unmanaged.passUnretained(self).toOpaque(), retain: nil, release: nil,
            copyDescription: nil)
        let callback: FSEventStreamCallback = { _, info, _, _, _, _ in
            guard let info else { return }
            let watcher = Unmanaged<MacDataFileWatcher>.fromOpaque(info).takeUnretainedValue()
            DispatchQueue.main.async {
                MainActor.assumeIsolated { watcher.onChange() }
            }
        }
        guard
            let stream = FSEventStreamCreate(
                nil, callback, &context, paths as CFArray,
                FSEventStreamEventId(kFSEventStreamEventIdSinceNow), latency,
                FSEventStreamCreateFlags(kFSEventStreamCreateFlagNone))
        else { return }
        FSEventStreamSetDispatchQueue(stream, DispatchQueue.global(qos: .utility))
        if FSEventStreamStart(stream) {
            self.stream = stream
        } else {
            FSEventStreamInvalidate(stream)
            FSEventStreamRelease(stream)
        }
    }

    deinit {
        guard let stream else { return }
        FSEventStreamStop(stream)
        FSEventStreamInvalidate(stream)
        FSEventStreamRelease(stream)
    }
}
#endif
