//
//  MacDataHost.swift
//  JapaneseMaple
//
//  Connects the Mac data engine to the web app:
//  - answers `window.webkit.messageHandlers.macData.postMessage({ action, ... })`
//    with a Promise result,
//  - watches Messages, Mail and Calendar for changes and re-reads them,
//  - tells the page what changed with a `maple:mac-data` window event.
//

#if os(macOS)
import AppKit
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
        connection.onStateChange = { [weak self] _ in
            Task { @MainActor in await self?.emitStatus() }
        }
        connection.start()
    }

    private func syncAll() {
        Task {
            for source in (try? await engine.enabledSources()) ?? [] {
                sync(source)
            }
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
            // Make new items searchable by bots; cheap when nothing is pending.
            await engine.embedPending()
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

        case "listPages":
            return try Self.json(await engine.pages(notebookId: body["notebookId"] as? String))

        case "getPage":
            let id = try Self.string(body, "id")
            return try await engine.page(id: id).map(Self.json) ?? NSNull()

        case "createPage":
            let notebookId = try Self.string(body, "notebookId")
            let source = try Self.source(body)
            let page = try await engine.createPage(
                notebookId: notebookId, source: source, title: body["title"] as? String)
            if source == .calendar {
                _ = await engine.requestCalendarAccess()
            }
            sync(source)
            connection.announce()
            return try Self.json(page)

        case "renamePage":
            try await engine.renamePage(id: try Self.string(body, "id"), title: try Self.string(body, "title"))
            return true

        case "deletePage":
            try await engine.deletePage(id: try Self.string(body, "id"))
            connection.announce()
            return true

        case "getItem":
            let id = try Self.string(body, "id")
            return try await engine.localItem(id: id).map(Self.json) ?? NSNull()

        case "query":
            let data = try JSONSerialization.data(withJSONObject: body)
            let query = try JSONDecoder().decode(MacDataQuery.self, from: data)
            return try Self.json(await engine.query(query))

        case "requestAccess":
            let source = try Self.source(body)
            if source == .calendar {
                if !(await engine.requestCalendarAccess()), CalendarReader.accessDenied {
                    Self.openPrivacySettings("Privacy_Calendars")
                }
            } else {
                Self.openPrivacySettings("Privacy_AllFiles")
            }
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
        emit(["type": "status", "statuses": json, "relay": connection.state])
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
