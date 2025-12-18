//
//  WebViewController.swift
//  JapaneseMaple
//
//  Created by Zubair Lawrence on 11/30/25.
//

import SwiftUI
import WebKit
import Combine

#if os(macOS)
struct WebViewContainer: NSViewRepresentable {
    let webViewController: WebViewController

    func makeNSView(context: Context) -> WKWebView {
        return webViewController.webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {
        // No updates needed for now
    }
}
#else
struct WebViewContainer: UIViewRepresentable {
    let webViewController: WebViewController

    func makeUIView(context: Context) -> WKWebView {
        return webViewController.webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        // No updates needed for now
    }
}
#endif

class WebViewController: NSObject, ObservableObject, WKNavigationDelegate {
    let webView: WKWebView
    private var bridge: NativeBridge?
    private var hasInitialized = false

    override init() {
        // Configure WKWebView
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")

        // Setup user content controller for bridge
        let contentController = WKUserContentController()
        config.userContentController = contentController

        print("[WebViewController] Initializing WebView (service worker will handle offline)")

        webView = WKWebView(frame: .zero, configuration: config)

        #if DEBUG
        // Enable Web Inspector immediately in debug mode
        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }
        #endif

        super.init()

        // Setup bridge after initialization
        bridge = NativeBridge(webView: webView)
        contentController.add(bridge!, name: "nativeBridge")

        webView.navigationDelegate = self

        // Listen for deep link notifications
        NotificationCenter.default.addObserver(
            forName: NSNotification.Name("DeepLinkReceived"),
            object: nil,
            queue: .main
        ) { [weak self] notification in
            if let urlString = notification.userInfo?["url"] as? String {
                self?.handleDeepLink(urlString)
            }
        }

        // Listen for notification tap events
        NotificationCenter.default.addObserver(
            forName: NSNotification.Name("NotificationTapped"),
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let userInfo = notification.userInfo else { return }
            self?.handleNotificationTap(userInfo: userInfo)
        }

        // Load the web app
        loadWebApp()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    private func loadWebApp() {
        // Get active server URL from ServerConfigService
        let activeServer = ServerConfigService.shared.getActiveServer()
        let serverURLString = activeServer.url

        print("[WebViewController] Active server: \(activeServer.name) - \(serverURLString)")

        // Try to load from configured server
        if let url = URL(string: serverURLString) {
            var request = URLRequest(url: url)
            request.timeoutInterval = 10.0

            // For localhost, allow self-signed certificates
            if serverURLString.contains("localhost") {
                print("[WebViewController] Loading from localhost - certificate bypass enabled")
            }

            print("[WebViewController] Loading from server: \(serverURLString)")
            webView.load(request)

            // Service worker will handle offline after first successful load
            // If load fails, didFailProvisionalNavigation will call loadOfflinePage
            return
        }

        // If server URL is invalid, show offline page
        print("[WebViewController] Invalid server URL, loading offline page")
        loadOfflinePage()
    }

    private func loadOfflinePage() {
        // Load the minimal offline.html page from bundle
        if let offlineURL = Bundle.main.url(forResource: "offline", withExtension: "html", subdirectory: "WebApp") {
            print("[WebViewController] Loading offline page from bundle")
            webView.loadFileURL(offlineURL, allowingReadAccessTo: offlineURL.deletingLastPathComponent())
        } else {
            // If offline.html not found, show basic error
            print("[WebViewController] ERROR: offline.html not found in bundle")
            let html = """
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Just Maple</title>
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        min-height: 100vh;
                        margin: 0;
                        background: #f5f7fa;
                    }
                    .container {
                        text-align: center;
                        padding: 40px;
                    }
                    h1 { color: #2c3e50; margin-bottom: 16px; }
                    p { color: #64748b; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Cannot Connect</h1>
                    <p>Please check your internet connection and try again.</p>
                </div>
            </body>
            </html>
            """
            webView.loadHTMLString(html, baseURL: nil)
        }
    }

    // MARK: - Public Methods

    func reloadFromServer() {
        hasInitialized = false
        loadWebApp()
    }

    func handleDeepLink(_ urlString: String) {
        print("[WebViewController] Handling deep link: \(urlString)")
        bridge?.sendDeepLink(url: urlString)
    }

    func handleNotificationTap(userInfo: [AnyHashable: Any]) {
        print("[WebViewController] 🔔 Handling notification tap")
        print("[WebViewController] 🔔 UserInfo received: \(userInfo)")

        // Extract notification data
        guard let notificationId = userInfo["notificationId"] as? String,
              let type = userInfo["type"] as? String else {
            print("[WebViewController] ❌ Missing notificationId or type in userInfo")
            return
        }

        print("[WebViewController] 🔔 Notification ID: \(notificationId), Type: \(type)")

        // Get API URL - use active server since that's where the user is logged in
        let activeServer = ServerConfigService.shared.getActiveServer()
        let apiUrl = activeServer.getAPIUrl()
        print("[WebViewController] 🌐 Using active server API URL: \(apiUrl)")

        // Try to get serverKey if available (for multi-server support)
        if let serverKey = userInfo["serverKey"] as? String {
            print("[WebViewController] 🔑 ServerKey found in payload: \(serverKey)")

            // Look up serverId from serverKey
            if let serverId = PushNotificationService.shared.getServerId(for: serverKey) {
                print("[WebViewController] 🔍 Found serverId: \(serverId)")

                // Get server configuration
                let servers = ServerConfigService.shared.getServers()
                if let server = servers.first(where: { $0.id == serverId }) {
                    let serverApiUrl = server.getAPIUrl()
                    print("[WebViewController] 🌐 Using server-specific API URL: \(serverApiUrl)")

                    // Send to web app via bridge
                    bridge?.handleNotificationTap(notificationId: notificationId, type: type, apiUrl: serverApiUrl)
                    print("[WebViewController] ✅ Sent notification tap to web app")
                    return
                } else {
                    print("[WebViewController] ⚠️ Server not found for serverId: \(serverId), using active server")
                }
            } else {
                print("[WebViewController] ⚠️ No serverId found for serverKey: \(serverKey), using active server")
            }
        } else {
            print("[WebViewController] ℹ️ No serverKey in payload, using active server")
        }

        // Fallback to active server API URL
        print("[WebViewController] 🔔 Sending notification to web app with active server API")
        bridge?.handleNotificationTap(notificationId: notificationId, type: type, apiUrl: apiUrl)
        print("[WebViewController] ✅ Sent notification tap to web app (apiUrl: \(apiUrl))")
    }

    // MARK: - WKNavigationDelegate


    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        print("WebView finished loading")

        // Only initialize once to prevent repeated initialization on HMR reloads
        if !hasInitialized, let bridge = bridge {
            bridge.sendInitialize()
            hasInitialized = true
            print("[WebViewController] Bridge initialized")
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        print("[WebViewController] Failed to load: \(error.localizedDescription)")
        loadOfflinePage()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        print("[WebViewController] Provisional navigation failed: \(error.localizedDescription)")
        loadOfflinePage()
    }

    func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        // Allow self-signed certificates for localhost
        if challenge.protectionSpace.host.contains("localhost") {
            if let serverTrust = challenge.protectionSpace.serverTrust {
                print("[WebViewController] Accepting localhost self-signed certificate")
                completionHandler(.useCredential, URLCredential(trust: serverTrust))
                return
            }
        }
        completionHandler(.performDefaultHandling, nil)
    }

}
