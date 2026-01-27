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

// Global hotkey callback - must be at file scope
private func hotKeyHandler(
    nextHandler: EventHandlerCallRef?,
    event: EventRef?,
    userData: UnsafeMutableRawPointer?
) -> OSStatus {
    QuickMemoPanel.shared.togglePanel()
    return noErr
}

class QuickMemoPanel: NSObject {
    static let shared = QuickMemoPanel()

    private var panel: NSPanel?
    private var webView: WKWebView?
    private var bridge: NativeBridge?
    private var hotKeyRef: EventHotKeyRef?
    private var eventHandlerRef: EventHandlerRef?
    private var localMonitor: Any?

    // Panel dimensions
    private let panelWidth: CGFloat = 600
    private let panelHeight: CGFloat = 280

    private override init() {
        super.init()
    }

    // MARK: - Setup

    func setup() {
        registerGlobalHotKey()
        setupLocalMonitor()
        print("[QuickMemoPanel] Setup complete - Use Cmd+Shift+M to open Quick Memo")
    }

    private func registerGlobalHotKey() {
        // Register Cmd+Shift+M as global hotkey using Carbon API
        // This works without requiring Accessibility permissions

        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )

        // Install event handler
        let status = InstallEventHandler(
            GetApplicationEventTarget(),
            hotKeyHandler,
            1,
            &eventType,
            nil,
            &eventHandlerRef
        )

        guard status == noErr else {
            print("[QuickMemoPanel] Failed to install event handler: \(status)")
            return
        }

        // Register the hotkey: Cmd+Shift+M
        // keyCode for M is 46 (kVK_ANSI_M)
        var hotKeyID = EventHotKeyID(
            signature: OSType(0x4A4D_514D), // "JMQM" - Just Maple Quick Memo
            id: 1
        )

        let modifiers: UInt32 = UInt32(cmdKey | shiftKey)

        let registerStatus = RegisterEventHotKey(
            UInt32(kVK_ANSI_M),
            modifiers,
            hotKeyID,
            GetApplicationEventTarget(),
            0,
            &hotKeyRef
        )

        if registerStatus == noErr {
            print("[QuickMemoPanel] Global hotkey registered: Cmd+Shift+M")
        } else {
            print("[QuickMemoPanel] Failed to register hotkey: \(registerStatus)")
        }
    }

    private func setupLocalMonitor() {
        // Local monitor for when app is in foreground (backup)
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            let isCmd = flags.contains(.command)
            let isShift = flags.contains(.shift)
            let isM = event.keyCode == UInt16(kVK_ANSI_M)

            if isCmd && isShift && isM {
                DispatchQueue.main.async {
                    self?.togglePanel()
                }
                return nil // Consume the event
            }
            return event
        }
    }

    // MARK: - Panel Management

    func togglePanel() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }

            if let panel = self.panel, panel.isVisible {
                self.hidePanel()
            } else {
                self.showPanel()
            }
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

        // Activate app and show panel
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)

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
            styleMask: [.titled, .closable, .fullSizeContentView, .nonactivatingPanel, .hudWindow],
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
        panel.backgroundColor = NSColor.windowBackgroundColor
        panel.isOpaque = false
        panel.hasShadow = true

        // Allow panel to receive key events
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]

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

        // Make webview background match system
        webView.setValue(false, forKey: "drawsBackground")

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
        // Unregister hotkey
        if let hotKeyRef = hotKeyRef {
            UnregisterEventHotKey(hotKeyRef)
        }

        // Remove event handler
        if let eventHandlerRef = eventHandlerRef {
            RemoveEventHandler(eventHandlerRef)
        }

        // Remove local monitor
        if let localMonitor = localMonitor {
            NSEvent.removeMonitor(localMonitor)
        }

        panel?.close()
        panel = nil
        webView = nil
        bridge = nil

        print("[QuickMemoPanel] Cleaned up")
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
