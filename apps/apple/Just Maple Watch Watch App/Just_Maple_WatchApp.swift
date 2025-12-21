//
//  Just_Maple_WatchApp.swift
//  Just Maple Watch Watch App
//
//  Created by Zubair Lawrence on 12/20/25.
//

import SwiftUI
import UserNotifications

@main
struct Just_Maple_Watch_Watch_AppApp: App {
    @StateObject private var notificationManager = NotificationManager.shared

    init() {
        // Set notification delegate
        UNUserNotificationCenter.current().delegate = NotificationManager.shared
        print("[WatchApp] 🚀 Watch app initialized")
    }

    var body: some Scene {
        WindowGroup {
            TagListView()
                .environmentObject(notificationManager)
                .task {
                    // Request notification permissions on first launch
                    _ = await notificationManager.requestAuthorization()
                }
        }
    }
}
