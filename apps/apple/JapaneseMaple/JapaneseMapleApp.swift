//
//  JapaneseMapleApp.swift
//  JapaneseMaple
//
//  Created by Zubair Lawrence on 11/30/25.
//

import SwiftUI
import SwiftData

@main
struct JapaneseMapleApp: App {
    var sharedModelContainer: ModelContainer = {
        let schema = Schema([
            Item.self,
        ])
        let modelConfiguration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: false)

        do {
            return try ModelContainer(for: schema, configurations: [modelConfiguration])
        } catch {
            fatalError("Could not create ModelContainer: \(error)")
        }
    }()

    var body: some Scene {
        #if os(iOS)
        WindowGroup {
            ContentView()
        }
        .modelContainer(sharedModelContainer)
        .onOpenURL { url in
            handleDeepLink(url: url)
        }
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { userActivity in
            if let url = userActivity.webpageURL {
                handleDeepLink(url: url)
            }
        }
        #else
        WindowGroup {
            ContentView()
        }
        .modelContainer(sharedModelContainer)
        #endif
    }

    private func handleDeepLink(url: URL) {
        print("[JapaneseMapleApp] Received deep link: \(url)")

        // Send notification to WebViewController to handle the deep link
        NotificationCenter.default.post(
            name: NSNotification.Name("DeepLinkReceived"),
            object: nil,
            userInfo: ["url": url.absoluteString]
        )
    }
}
