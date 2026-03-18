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
    @WKExtensionDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var notificationManager = NotificationManager.shared
    @StateObject private var webSocketManager = WebSocketManager.shared
    @Environment(\.scenePhase) private var scenePhase

    init() {
        // Set notification delegate
        UNUserNotificationCenter.current().delegate = NotificationManager.shared

        // Wire up token refresh so APIClient can request fresh tokens from iPhone on 401
        APIClient.shared.tokenRefreshHandler = {
            await AuthenticationManager.shared.requestFreshToken()
        }

        print("[WatchApp] 🚀 Watch app initialized")
    }

    var body: some Scene {
        WindowGroup {
            TagListView()
                .environmentObject(notificationManager)
                .task {
                    // Request notification permissions on first launch
                    _ = await notificationManager.requestAuthorization()

                    // Ensure device is registered with server
                    await notificationManager.ensureDeviceRegistration()
                }
                .onChange(of: scenePhase) { oldPhase, newPhase in
                    handleScenePhaseChange(newPhase)
                }
        }
    }

    private func handleScenePhaseChange(_ phase: ScenePhase) {
        switch phase {
        case .active:
            // App is active - connect to WebSocket for real-time updates
            print("[WatchApp] ▶️ App became active - connecting to WebSocket")
            Task { @MainActor in
                await webSocketManager.connect()
            }

        case .inactive:
            // App is transitioning - keep connection
            print("[WatchApp] ⏸️ App became inactive")

        case .background:
            // App is in background - disconnect WebSocket to save battery
            // Push notifications will handle updates
            print("[WatchApp] ⏹️ App moved to background - disconnecting WebSocket")
            Task { @MainActor in
                webSocketManager.disconnect()
            }

        @unknown default:
            break
        }
    }
}

// MARK: - App Delegate

class AppDelegate: NSObject, WKExtensionDelegate {
    func didRegisterForRemoteNotifications(withDeviceToken deviceToken: Data) {
        Task { @MainActor in
            NotificationManager.shared.didRegisterForRemoteNotifications(deviceToken: deviceToken)
        }
    }

    func didFailToRegisterForRemoteNotificationsWithError(_ error: Error) {
        Task { @MainActor in
            NotificationManager.shared.didFailToRegisterForRemoteNotifications(error: error)
        }
    }
}
