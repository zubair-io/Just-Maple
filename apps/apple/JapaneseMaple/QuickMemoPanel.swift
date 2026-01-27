//
//  QuickMemoPanel.swift
//  JapaneseMaple
//
//  Quick Memo floating panel for system-wide note capture
//

import Foundation
import WebKit

#if os(macOS)
import AppKit
import Carbon.HIToolbox

class QuickMemoPanel: NSObject {
    static let shared = QuickMemoPanel()

    private var panel: NSPanel?
    private var webView: WKWebView?
    private var bridge: NativeBridge?
    private var globalMonitor: Any?
    private var localMonitor: Any?

    // Panel dimensions
    private let panelWidth: CGFloat = 600
    private let panelHeight: CGFloat = 280

    private override init() {
        super.init()
    }

    // MARK: - Setup

    func setup() {
        setupGlobalShortcut()
        print("[QuickMemoPanel] Setup complete - Use Cmd+Shift+M to open Quick Memo")
    }

    private func setupGlobalShortcut() {
        // Global monitor - works when app is in background
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            self?.handleKeyEvent(event)
        }

        // Local monitor - works when app is in foreground
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if self?.handleKeyEvent(event) == true {
                return nil // Consume the event
            }
            return event
        }
    }

    @discardableResult
    private func handleKeyEvent(_ event: NSEvent) -> Bool {
        // Check for Cmd+Shift+M
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        let isCmd = flags.contains(.command)
        let isShift = flags.contains(.shift)
        let isM = event.keyCode == kVK_ANSI_M

        if isCmd && isShift && isM {
            DispatchQueue.main.async { [weak self] in
                self?.togglePanel()
            }
            return true
        }
        return false
    }

    // MARK: - Panel Management

    func togglePanel() {
        if let panel = panel, panel.isVisible {
            hidePanel()
        } else {
            showPanel()
        }
    }

    func showPanel() {
        if panel == nil {
            createPanel()
        }

        guard let panel = panel else { return }

        // Position panel in upper-center of main screen
        if let screen = NSScreen.main {
            let screenFrame = screen.visibleFrame
            let x = screenFrame.midX - (panelWidth / 2)
            let y = screenFrame.maxY - panelHeight - 100 // 100px from top
            panel.setFrame(NSRect(x: x, y: y, width: panelWidth, height: panelHeight), display: true)
        }

        // Show and focus
        panel.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        // Load or reload the quick memo page
        loadQuickMemoPage()

        print("[QuickMemoPanel] Showing Quick Memo panel")
    }

    func hidePanel() {
        panel?.orderOut(nil)
        print("[QuickMemoPanel] Hiding Quick Memo panel")
    }

    private func createPanel() {
        // Create floating panel
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: panelWidth, height: panelHeight),
            styleMask: [.titled, .closable, .fullSizeContentView, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )

        // Panel configuration
        panel.level = .floating
        panel.isFloatingPanel = true
        panel.becomesKeyOnlyIfNeeded = false
        panel.hidesOnDeactivate = false
        panel.titlebarAppearsTransparent = true
        panel.titleVisibility = .hidden
        panel.isMovableByWindowBackground = true
        panel.backgroundColor = .clear
        panel.isOpaque = false

        // Create WebView
        let config = WKWebViewConfiguration()
        let prefs = WKWebpagePreferences()
        prefs.allowsContentJavaScript = true
        config.defaultWebpagePreferences = prefs
        config.websiteDataStore = WKWebsiteDataStore.default()

        // Setup bridge for popup
        let contentController = WKUserContentController()
        config.userContentController = contentController

        let webView = WKWebView(frame: panel.contentView!.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]

        #if DEBUG
        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }
        #endif

        // Setup bridge
        bridge = NativeBridge(webView: webView)
        contentController.add(bridge!, name: "nativeBridge")

        // Add webview to panel
        panel.contentView?.addSubview(webView)

        // Handle escape key to close
        panel.delegate = self

        self.panel = panel
        self.webView = webView

        print("[QuickMemoPanel] Created Quick Memo panel")
    }

    private func loadQuickMemoPage() {
        guard let webView = webView else { return }

        // Get active server URL and append quick-memo-popup route
        let activeServer = ServerConfigService.shared.getActiveServer()
        let baseURL = activeServer.url.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let quickMemoURL = "\(baseURL)/#/quick-memo-popup"

        if let url = URL(string: quickMemoURL) {
            let request = URLRequest(url: url)
            webView.load(request)
            print("[QuickMemoPanel] Loading: \(quickMemoURL)")
        }
    }

    // MARK: - Bridge Communication

    func sendShowQuickMemo() {
        bridge?.send(.initialize(NativeToWebMessage.InitialState(
            appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0",
            platform: "macOS",
            timestamp: ISO8601DateFormatter().string(from: Date()),
            serverUrl: ServerConfigService.shared.getActiveServer().url,
            serverName: ServerConfigService.shared.getActiveServer().name
        )))
    }

    // MARK: - Cleanup

    func cleanup() {
        if let globalMonitor = globalMonitor {
            NSEvent.removeMonitor(globalMonitor)
        }
        if let localMonitor = localMonitor {
            NSEvent.removeMonitor(localMonitor)
        }
        panel?.close()
        panel = nil
        webView = nil
        bridge = nil
    }
}

// MARK: - NSWindowDelegate

extension QuickMemoPanel: NSWindowDelegate {
    func windowWillClose(_ notification: Notification) {
        // Don't destroy panel, just hide it
    }

    func windowDidResignKey(_ notification: Notification) {
        // Hide panel when it loses focus (click outside)
        hidePanel()
    }
}

#endif
