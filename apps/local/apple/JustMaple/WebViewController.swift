//
//  WebViewController.swift
//  JustMaple
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

    /// The local dev server URL (Angular dev server).
    /// Used only when the `LOAD_DEV_SERVER_BUNDLE` compilation condition is set.
    private let devServerURL = "http://localhost:4600"

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

        // Register the custom `app://` scheme handler so the bundled WebApp
        // folder (built by scripts/build-web.sh) is served as the app's origin.
        // Routing through a custom scheme avoids file:// restrictions that
        // would otherwise break Angular Router and module imports.
        //
        // The handler is always registered (with a best-effort baseURL) so the
        // scheme is claimed by WebKit and can never escape to LaunchServices.
        let webAppBaseURL = Self.bundledWebAppURL() ?? Bundle.main.bundleURL
        print("[WebViewController] app:// baseURL = \(webAppBaseURL.path)")
        let schemeHandler = CustomSchemeHandler(baseURL: webAppBaseURL)
        config.setURLSchemeHandler(schemeHandler, forURLScheme: "app")

        // Enable App-Bound Domains for service worker support in WKWebView
        // (iOS 14+). Disabled when loading from the dev server so localhost works.
        #if os(iOS) && !LOAD_DEV_SERVER_BUNDLE
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
        #if os(macOS)
        LocalAppDelegate.editors.add(self)
        #endif

        // Setup bridge after initialization
        bridge = NativeBridge(webView: webView)
        contentController.add(bridge!, name: "nativeBridge")

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

        #if os(macOS)
        // Listen for menu navigation (Settings)
        NotificationCenter.default.addObserver(
            forName: NSNotification.Name("MenuNavigate"),
            object: nil,
            queue: .main
        ) { [weak self] notification in
            if let route = notification.userInfo?["route"] as? String {
                self?.navigateToRoute(route)
            }
        }

        // Listen for menu Open Folder
        NotificationCenter.default.addObserver(
            forName: NSNotification.Name("MenuOpenFolder"),
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.openFolderPicker()
        }
        #endif

        // Load the web app
        loadWebApp()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    private func loadWebApp() {
        #if LOAD_DEV_SERVER_BUNDLE
        print("[WebViewController] Loading from dev server: \(devServerURL)")
        if let url = URL(string: devServerURL) {
            var request = URLRequest(url: url)
            request.timeoutInterval = 10.0
            webView.load(request)
            return
        }
        print("[WebViewController] Invalid dev server URL, loading offline page")
        loadOfflinePage()
        #else
        print("[WebViewController] Loading bundled web app via app://")
        if let url = URL(string: "app://localhost/index.html") {
            webView.load(URLRequest(url: url))
            return
        }
        print("[WebViewController] Failed to construct app:// URL, loading offline page")
        loadOfflinePage()
        #endif
    }

    /// Locates the bundled WebApp folder produced by `scripts/build-web.sh`.
    /// Tries the folder-preserved layout (synchronized group / folder reference)
    /// first, then a flattened layout (Copy Bundle Resources default), then a
    /// direct filesystem probe under the bundle's resourceURL.
    private static func bundledWebAppURL() -> URL? {
        // Folder preserved: WebApp/ exists as a real subdirectory of Resources.
        if let indexURL = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "WebApp") {
            return indexURL.deletingLastPathComponent()
        }
        if let offlineURL = Bundle.main.url(forResource: "offline", withExtension: "html", subdirectory: "WebApp") {
            return offlineURL.deletingLastPathComponent()
        }
        // Direct probe: the WebApp folder sits next to the executable's resources.
        if let resourceURL = Bundle.main.resourceURL {
            let candidate = resourceURL.appendingPathComponent("WebApp", isDirectory: true)
            if FileManager.default.fileExists(atPath: candidate.appendingPathComponent("index.html").path) {
                return candidate
            }
        }
        // Flattened: every WebApp file was copied to the resources root.
        if let indexURL = Bundle.main.url(forResource: "index", withExtension: "html") {
            return indexURL.deletingLastPathComponent()
        }
        return nil
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

    func hasDurableRecoveryDrafts() async -> Bool {
        let value = try? await webView.callAsyncJavaScript(
            "return window.__mapleLocalRecoverySafe?.() ?? true;", arguments: [:], in: nil, contentWorld: .page)
        return value as? Bool ?? false
    }

    func flushPendingSaves() async throws {
        _ = try await webView.callAsyncJavaScript(
            "await window.__mapleLocalFlush?.(); return true;", arguments: [:], in: nil, contentWorld: .page)
    }

    func reloadFromServer() {
        hasInitialized = false
        loadWebApp()
    }

    func handleDeepLink(_ urlString: String) {
        print("[WebViewController] Handling deep link: \(urlString)")
        bridge?.sendDeepLink(url: urlString)
    }

    #if os(macOS)
    func navigateToRoute(_ route: String) {
        print("[WebViewController] Navigating to: \(route)")
        let js = "window.location.hash = ''; window.history.pushState({}, '', '\(route)'); window.dispatchEvent(new PopStateEvent('popstate'));"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    func openFolderPicker() {
        // Trigger the web app's folder opening flow via JavaScript
        let js = "document.dispatchEvent(new CustomEvent('native-open-folder'));"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }
    #endif

    // MARK: - WKUIDelegate

    #if os(iOS)
    @available(iOS 15.0, *)
    func webView(_ webView: WKWebView,
                 requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.prompt)
    }
    #endif

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "app", url.host == "localhost" {
            decisionHandler(.allow)
            return
        }
        if navigationAction.navigationType == .linkActivated,
           ["https", "http"].contains(url.scheme ?? "") {
            #if os(macOS)
            NSWorkspace.shared.open(url)
            #else
            UIApplication.shared.open(url)
            #endif
        }
        decisionHandler(.cancel)
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
        print("[WebViewController] Failed to load: \(error.localizedDescription)")
        loadOfflinePage()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        print("[WebViewController] Provisional navigation failed: \(error.localizedDescription)")
        loadOfflinePage()
    }

    func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        completionHandler(.performDefaultHandling, nil)
    }

}
