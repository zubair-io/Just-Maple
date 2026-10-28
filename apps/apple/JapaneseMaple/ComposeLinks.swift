//
//  ComposeLinks.swift
//  JapaneseMaple
//
//  Drafted replies open as a prefilled compose in Messages or Mail (`sms:` and
//  `mailto:` links built by the web app). A web view can't open those itself: the load
//  fails and the app would show its offline page. So the web view hands them to the
//  system, which opens Messages or Mail with the draft. The person presses send there;
//  the app never sends anything, and needs no entitlement to open a link.
//
//  Only a person's tap on a link in the app's own page does this. A script, a redirect,
//  a frame, or a page from anywhere else can't open Messages or Mail.
//

import Foundation
import WebKit
#if os(macOS)
import AppKit
#else
import UIKit
#endif

nonisolated enum ComposeLinks {
    /// Messages and Mail compose links. Nothing else leaves the web view this way.
    static let schemes: Set<String> = ["sms", "mailto"]

    /// Where a page came from: scheme, host and port (default ports left out).
    struct Origin: Equatable, Sendable {
        let scheme: String
        let host: String
        let port: Int?

        init(scheme: String, host: String, port: Int?) {
            let scheme = scheme.lowercased()
            self.scheme = scheme
            self.host = host.lowercased()
            let isDefault = (scheme == "https" && port == 443) || (scheme == "http" && port == 80)
            self.port = isDefault ? nil : port
        }

        init?(_ url: URL) {
            guard let scheme = url.scheme, let host = url.host, !host.isEmpty else { return nil }
            self.init(scheme: scheme, host: host, port: url.port)
        }
    }

    static func isCompose(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        return schemes.contains(scheme)
    }

    /// Hand this navigation to the system: a compose link the person tapped
    /// (`linkActivated`) in the main frame of a page from the app's own server.
    static func shouldOpenExternally(
        _ url: URL,
        navigationType: WKNavigationType,
        isMainFrame: Bool,
        sourceOrigin: Origin?,
        appOrigin: Origin?
    ) -> Bool {
        guard isCompose(url), navigationType == .linkActivated, isMainFrame,
              let sourceOrigin, let appOrigin
        else { return false }
        return sourceOrigin == appOrigin
    }
}

extension ComposeLinks.Origin {
    @MainActor
    init?(_ origin: WKSecurityOrigin) {
        guard !origin.host.isEmpty else { return nil }
        self.init(scheme: origin.protocol, host: origin.host, port: origin.port == 0 ? nil : origin.port)
    }
}

extension ComposeLinks {
    /// Opens Messages or Mail with the link's recipient and text.
    @MainActor
    static func open(_ url: URL) {
        #if os(macOS)
        NSWorkspace.shared.open(url)
        #else
        UIApplication.shared.open(url)
        #endif
    }
}
