//
//  HomeAssistantSettingsWindow.swift
//  JapaneseMaple
//
//  A native window for Home Assistant's address and access token, opened from Settings →
//  Devices in the web app. The token is typed here, straight into the Keychain: it never
//  passes through the web page, and is never shown again once saved.
//

#if os(macOS)
import AppKit
import SwiftUI

@MainActor
final class HomeAssistantSettingsWindow {
    static let shared = HomeAssistantSettingsWindow()

    private var window: NSWindow?
    /// Called after the settings were saved or removed.
    var onChange: (() -> Void)?

    func show(store: HomeAssistantSettingsStore = HomeAssistantSettingsStore()) {
        if let window {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }
        let model = HomeAssistantSettingsModel(store: store) { [weak self] in self?.onChange?() }
        let view = HomeAssistantSettingsView(model: model) { [weak self] in self?.close() }
        let window = NSWindow(contentViewController: NSHostingController(rootView: view))
        window.title = "Home Assistant"
        window.styleMask = [.titled, .closable]
        window.isReleasedWhenClosed = false
        window.center()
        NotificationCenter.default.addObserver(
            forName: NSWindow.willCloseNotification, object: window, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.window = nil }
        }
        self.window = window
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func close() {
        window?.close()
        window = nil
    }
}

@MainActor
@Observable
final class HomeAssistantSettingsModel {
    var url: String
    /// Empty keeps the saved token (for the same address).
    var token = ""
    var message: String?
    var failed = false
    var busy = false
    var hasSavedToken: Bool

    private let store: HomeAssistantSettingsStore
    private let saved: HomeAssistantSettings?
    private let onChange: () -> Void
    private let factory: HomeSocketFactory

    init(
        store: HomeAssistantSettingsStore, factory: HomeSocketFactory = URLSessionHomeSocketFactory(),
        onChange: @escaping () -> Void
    ) {
        self.store = store
        self.factory = factory
        self.onChange = onChange
        saved = store.settings
        url = saved?.url.absoluteString ?? ""
        hasSavedToken = store.load() != nil
    }

    /// The address and token to use: a blank token means the saved one, for the same address.
    private func entered() throws -> (HomeAssistantSettings, String) {
        let settings = HomeAssistantSettings(url: try HomeAssistantSettings.validatedURL(url))
        if token.isEmpty, let loaded = store.load(), loaded.settings.account == settings.account {
            return (settings, loaded.token)
        }
        return (settings, try HomeAssistantSettings.validatedToken(token))
    }

    /// Connects once and reports how many entities are exposed to assistants.
    func test() async {
        _ = await probe()
    }

    /// Saves only after a successful test, so a typo can't be saved.
    func save() async -> Bool {
        guard let (settings, token, _) = await probe() else { return false }
        do {
            try store.save(settings, token: token)
            self.token = ""
            hasSavedToken = true
            onChange()
            return true
        } catch {
            show(error, failed: true)
            return false
        }
    }

    func remove() {
        store.remove()
        token = ""
        hasSavedToken = false
        url = ""
        message = "Removed. Just Maple no longer connects to Home Assistant."
        failed = false
        onChange()
    }

    private func probe() async -> (HomeAssistantSettings, String, Int)? {
        busy = true
        defer { busy = false }
        message = nil
        do {
            let (settings, token) = try entered()
            let count = try await HomeAssistantConnector.probe(
                settings: settings, token: token, factory: factory)
            if count == 0 {
                message =
                    "Connected, but nothing is exposed to assistants. In Home Assistant, go to Settings → Voice assistants → Expose and choose what Just Maple may see."
            } else {
                message = "Connected. \(count) \(count == 1 ? "entity is" : "entities are") exposed to assistants."
            }
            failed = false
            return (settings, token, count)
        } catch {
            show(error, failed: true)
            return nil
        }
    }

    private func show(_ error: Error, failed: Bool) {
        message = HomeAssistantConnector.describe(error)
        self.failed = failed
    }
}

struct HomeAssistantSettingsView: View {
    @Bindable var model: HomeAssistantSettingsModel
    let close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(
                "Just Maple reads only the entities you expose to assistants in Home Assistant (Settings → Voice assistants → Expose), and changes one only after you tap to confirm."
            )
            .font(.callout)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)

            Form {
                TextField("Address", text: $model.url, prompt: Text("http://homeassistant.local:8123"))
                SecureField(
                    "Access token", text: $model.token,
                    prompt: Text(model.hasSavedToken ? "Saved in the Keychain" : "Long-lived access token"))
            }

            Text(
                "Create a long-lived access token in Home Assistant under your profile → Security. It stays in this Mac's Keychain and is never uploaded."
            )
            .font(.caption)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)

            if let message = model.message {
                Text(message)
                    .font(.callout)
                    .foregroundStyle(model.failed ? Color.red : Color.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack {
                if model.hasSavedToken {
                    Button("Remove", role: .destructive) { model.remove() }
                }
                Spacer()
                if model.busy { ProgressView().controlSize(.small) }
                Button("Test connection") { Task { await model.test() } }
                    .disabled(model.busy)
                Button("Save") {
                    Task { if await model.save() { close() } }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(model.busy)
            }
        }
        .padding(20)
        .frame(width: 460)
    }
}
#endif
