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

import Foundation
#if os(macOS)
import AppKit
#else
import UIKit
#endif

nonisolated enum ComposeLinks {
    /// Messages and Mail compose links. Nothing else leaves the web view this way.
    static let schemes: Set<String> = ["sms", "mailto", "imessage"]

    static func isCompose(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        return schemes.contains(scheme)
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
