//
//  JustMapleApp.swift
//  JustMaple
//
//  Created by Zubair Lawrence on 11/30/25.
//

import SwiftUI

#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

@main
struct JustMapleApp: App {
    #if os(macOS)
    @NSApplicationDelegateAdaptor(LocalAppDelegate.self) var delegate
    #endif
    var body: some Scene {
        WindowGroup {
            ContentView()
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { userActivity in
                    if let url = userActivity.webpageURL {
                        handleDeepLink(url: url)
                    }
                }
        }
        #if os(macOS)
        .commands {
            // Replace the default "Settings" menu item under the app menu
            CommandGroup(replacing: .appSettings) {
                Button("Settings...") {
                    NotificationCenter.default.post(
                        name: NSNotification.Name("MenuNavigate"),
                        object: nil,
                        userInfo: ["route": "/settings"]
                    )
                }
                .keyboardShortcut(",", modifiers: .command)
            }

            // Add "Open Folder" under the File menu
            CommandGroup(after: .newItem) {
                Button("Open Folder...") {
                    NotificationCenter.default.post(
                        name: NSNotification.Name("MenuOpenFolder"),
                        object: nil
                    )
                }
                .keyboardShortcut("o", modifiers: .command)
            }
        }
        #endif
    }

    private func handleDeepLink(url: URL) {
        print("[JustMapleApp] Received deep link: \(url)")
        NotificationCenter.default.post(
            name: NSNotification.Name("DeepLinkReceived"),
            object: nil,
            userInfo: ["url": url.absoluteString]
        )
    }
}
