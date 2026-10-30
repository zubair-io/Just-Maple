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

class WebViewController: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate {
    let webView: WKWebView
    private var bridge: NativeBridge?
    private var hasInitialized = false
    private var loadingOrigin: String?

    override init() {
        // Configure WKWebView
        let config = WKWebViewConfiguration()

        let prefs = WKWebpagePreferences()
        prefs.allowsContentJavaScript = true
        config.defaultWebpagePreferences = prefs
        config.websiteDataStore = WKWebsiteDataStore.default()


        config.preferences.setValue(true, forKey: "developerExtrasEnabled")

        #if os(iOS)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        #endif

        // Setup user content controller for bridge
        let contentController = WKUserContentController()
        config.userContentController = contentController

        // Enable App-Bound Domains for service worker support in WKWebView (iOS 14+)
        // Requires WKAppBoundDomains in Info.plist
        #if os(iOS)
        // A user-selected self-hosted server cannot be listed in a static domain allowlist.
        config.limitsNavigationsToAppBoundDomains = false
        #endif

        print("[WebViewController] Initializing WebView (service worker will handle offline)")

        webView = WKWebView(frame: .zero, configuration: config)

        #if os(iOS)
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        #endif

        #if DEBUG
        // Enable Web Inspector immediately in debug mode
        if #available(iOS 16.4, macOS 13.3, *) {
            webView.isInspectable = true
        }
        #endif

        super.init()

        // Setup bridge after initialization
        bridge = NativeBridge(webView: webView)
        contentController.add(bridge!, name: "nativeBridge")

        #if os(macOS)
        // iMessage, Mail and Calendar data that stays on this Mac.
        MacDataHost.shared.attach(to: webView)
        #else
        // Location and Health collectors, switched on from the Devices page.
        CollectorsHost.shared.attach(to: webView)
        #endif

        webView.navigationDelegate = self
        webView.uiDelegate = self

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

        // Listen for foreground notification events
        NotificationCenter.default.addObserver(
            forName: NSNotification.Name("ForegroundNotificationReceived"),
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let userInfo = notification.userInfo else { return }
            self?.handleForegroundNotification(userInfo: userInfo)
        }

        // Load the web app
        loadWebApp()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    private var refreshingConnection = false

    func refreshConnection(force: Bool = false) {
        guard ServerConfigService.shared.hasConfiguredServer, !refreshingConnection else { return }
        refreshingConnection = true
        Task { @MainActor [weak self] in
            guard let self else { return }
            defer { self.refreshingConnection = false }
            await ServerConfigService.shared.resolveEndpoint(force: force)
            let config = ServerConfigService.shared
            self.installServerIdentity()
            let endpoints = [config.getActiveServer().url, config.localURL, self.loadingOrigin].compactMap { $0 }
            if let current = self.webView.url, endpoints.contains(where: { origin in
                guard let url = URL(string: origin) else { return false }
                return url.scheme == current.scheme && url.host == current.host && url.port == current.port
            }) {
                // Keep the current page, editor state and offline database while changing transport.
                _ = try? await self.webView.callAsyncJavaScript(
                    "if (window.__mapleServerIdentity) { const changed = window.__mapleServerIdentity.apiUrl !== apiUrl; window.__mapleServerIdentity.apiUrl = apiUrl; window.__mapleServerIdentity.localUrl = localUrl; if (changed) window.dispatchEvent(new Event('maple:server-endpoint')); }",
                    arguments: ["apiUrl": config.getAPIUrl(), "localUrl": config.localURL ?? ""], in: nil, contentWorld: .page)
            } else { self.reloadFromServer() }
        }
    }

    private func loadWebApp() {
        // First launch stays in native setup until a server is saved.
        guard ServerConfigService.shared.hasConfiguredServer else { return }
        Task { @MainActor [weak self] in
            await ServerConfigService.shared.resolveEndpoint()
            self?.loadResolvedWebApp()
        }
    }

    private func installServerIdentity() {
        // Install identity before Angular starts, including when loading the LAN origin.
        let identityData = try! JSONSerialization.data(withJSONObject: ["serverUrl": ServerConfigService.shared.getActiveServer().url,
            "publicApiUrl": ServerConfigService.shared.getActiveServer().getAPIUrl(), "apiUrl": ServerConfigService.shared.getAPIUrl(),
            "localUrl": ServerConfigService.shared.localURL ?? ""])
        let identityJSON = String(decoding: identityData, as: UTF8.self)
        webView.configuration.userContentController.removeAllUserScripts()
        webView.configuration.userContentController.addUserScript(WKUserScript(
            source: "window.__mapleServerIdentity = \(identityJSON);",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    private func loadResolvedWebApp(preservingRoute route: URL? = nil) {
        // Get active server URL from ServerConfigService
        let activeServer = ServerConfigService.shared.getActiveServer()
        let origin = ServerConfigService.shared.getEffectiveWebURL()
        loadingOrigin = origin
        var destination = URLComponents(string: origin)!
        if let route {
            let previous = URLComponents(url: route, resolvingAgainstBaseURL: false)
            destination.percentEncodedPath = previous?.percentEncodedPath ?? ""
            destination.percentEncodedQuery = previous?.percentEncodedQuery
            destination.percentEncodedFragment = previous?.percentEncodedFragment
        }
        let serverURLString = destination.string ?? origin
        installServerIdentity()

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
                <title>JapaneseMaple</title>
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

        // Check if this is an OAuth callback during an active auth session
        if let url = URL(string: urlString),
           bridge?.handleOAuthDeepLink(url: url) == true {
            print("[WebViewController] Deep link handled as OAuth callback")
            return
        }

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

        let apiUrl: String
        if let serverUrl = userInfo["serverUrl"] as? String {
            apiUrl = serverUrl
        } else {
            let activeServer = ServerConfigService.shared.getActiveServer()
            apiUrl = activeServer.getAPIUrl()
        }

        // Extract tagId and messageId if present
        let tagId = userInfo["tagId"] as? String
        let messageId = userInfo["messageId"] as? String

        // Send to web app via bridge
        bridge?.handleNotificationTap(notificationId: notificationId, type: type, apiUrl: apiUrl, tagId: tagId, messageId: messageId)
        print("[WebViewController] ✅ Sent notification tap to web app")
    }

    private func handleForegroundNotification(userInfo: [AnyHashable: Any]) {
        print("[WebViewController] 🔔 Handling foreground notification")

        guard let notificationId = userInfo["notificationId"] as? String,
              let type = userInfo["type"] as? String else {
            print("[WebViewController] ⚠️ Missing notificationId or type in foreground notification")
            return
        }

        let apiUrl: String
        if let serverUrl = userInfo["serverUrl"] as? String {
            apiUrl = serverUrl
        } else {
            let activeServer = ServerConfigService.shared.getActiveServer()
            apiUrl = activeServer.getAPIUrl()
        }

        print("[WebViewController] 🌐 Using API URL: \(apiUrl)")

        // Extract tagId and messageId if present
        let tagId = userInfo["tagId"] as? String
        let messageId = userInfo["messageId"] as? String

        // Send to web app via bridge
        bridge?.handleForegroundNotification(notificationId: notificationId, type: type, apiUrl: apiUrl, tagId: tagId, messageId: messageId)
        print("[WebViewController] ✅ Sent foreground notification to web app")
    }

    // MARK: - WKUIDelegate

    #if os(iOS)
    @available(iOS 15.0, *)
    func webView(_ webView: WKWebView,
                 requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.grant)
    }
    #endif

    // MARK: - WKNavigationDelegate

    /// "Open in Messages / Mail" on a drafted reply: the system opens the compose.
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url, ComposeLinks.isCompose(url) {
            // Never loaded in the web view (it would fail into the offline page); opened
            // only when the person tapped it in the app's own page.
            decisionHandler(.cancel)
            let source = navigationAction.sourceFrame
            let appURL = URL(string: ServerConfigService.shared.getActiveServer().url)
            if ComposeLinks.shouldOpenExternally(
                url,
                navigationType: navigationAction.navigationType,
                isMainFrame: source.isMainFrame,
                sourceOrigin: ComposeLinks.Origin(source.securityOrigin),
                appOrigin: appURL.flatMap { ComposeLinks.Origin($0) }
            ) {
                ComposeLinks.open(url)
            }
            return
        }
        decisionHandler(.allow)
    }

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
        handleNavigationFailure(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        handleNavigationFailure(error)
    }

    private func handleNavigationFailure(_ error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        if let local = ServerConfigService.shared.localURL, loadingOrigin == local {
            let failedURL = (error as NSError).userInfo[NSURLErrorFailingURLErrorKey] as? URL ?? webView.url
            let route = failedURL.flatMap { url -> URL? in
                guard let origin = URL(string: local), url.scheme == origin.scheme,
                      url.host == origin.host, url.port == origin.port else { return nil }
                return url
            }
            ServerConfigService.shared.reportEndpointFailure(local)
            hasInitialized = false
            // Rebuild the bootstrap too, so the public page does not keep calling LAN.
            loadResolvedWebApp(preservingRoute: route)
            return
        }
        print("[WebViewController] Provisional navigation failed: \(error.localizedDescription)")
        loadOfflinePage()
    }

    func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        #if DEBUG
        // Development exception is restricted to loopback hosts.
        if ["localhost", "127.0.0.1", "::1"].contains(challenge.protectionSpace.host) {
            if let serverTrust = challenge.protectionSpace.serverTrust {
                print("[WebViewController] Accepting localhost self-signed certificate")
                completionHandler(.useCredential, URLCredential(trust: serverTrust))
                return
            }
        }
        #endif
        completionHandler(.performDefaultHandling, nil)
    }

}
