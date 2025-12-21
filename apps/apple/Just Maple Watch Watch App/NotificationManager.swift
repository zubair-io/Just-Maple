//
//  NotificationManager.swift
//  Just Maple Watch App
//
//  Handles push notifications for real-time message updates
//

import Foundation
import UserNotifications
import SwiftUI
import Combine

@MainActor
class NotificationManager: NSObject, ObservableObject {
    static let shared = NotificationManager()

    @Published var selectedTagId: String?
    @Published var shouldOpenMessage = false

    private var pendingDeviceToken: String?
    private let userDefaults = UserDefaults.standard
    private let deviceTokenKey = "com.justmaple.deviceToken"
    private let lastRegistrationKey = "com.justmaple.lastRegistration"

    private override init() {
        super.init()
    }

    // MARK: - Registration

    /// Ensure device is registered - check on boot and register if needed
    func ensureDeviceRegistration() async {
        print("[NotificationManager] 🔍 Checking device registration status...")

        // Check if we have a stored device token
        guard let storedToken = userDefaults.string(forKey: deviceTokenKey) else {
            print("[NotificationManager] ⚠️ No stored device token - waiting for APNs")
            return
        }

        print("[NotificationManager] ✅ Found stored device token")

        // Check last registration time
        if let lastRegistration = userDefaults.object(forKey: lastRegistrationKey) as? Date {
            let hoursSinceRegistration = Date().timeIntervalSince(lastRegistration) / 3600
            print("[NotificationManager] 📅 Last registration: \(Int(hoursSinceRegistration)) hours ago")

            // Re-register if it's been more than 24 hours
            if hoursSinceRegistration < 24 {
                print("[NotificationManager] ✅ Registration is fresh, skipping")
                return
            }
        }

        // Register with server
        print("[NotificationManager] 🔄 Re-registering device with server...")
        await registerDeviceWithServer(deviceToken: storedToken)
    }

    /// Request notification permissions and register for remote notifications
    func requestAuthorization() async -> Bool {
        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(
                options: [.alert, .sound, .badge]
            )

            if granted {
                print("[NotificationManager] ✅ Notification permission granted")
                // Register for remote notifications on main thread
                await MainActor.run {
                    WKExtension.shared().registerForRemoteNotifications()
                }
            } else {
                print("[NotificationManager] ❌ Notification permission denied")
            }

            return granted
        } catch {
            print("[NotificationManager] ❌ Failed to request authorization: \(error)")
            return false
        }
    }

    /// Called when device token is received from APNs
    func didRegisterForRemoteNotifications(deviceToken: Data) {
        let tokenString = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        print("[NotificationManager] 📱 Device token received: \(tokenString)")

        // Save token to UserDefaults
        userDefaults.set(tokenString, forKey: deviceTokenKey)
        pendingDeviceToken = tokenString
        print("[NotificationManager] 💾 Saved device token to storage")

        // Register with server
        Task {
            await registerDeviceWithServer(deviceToken: tokenString)
        }
    }

    /// Called when device token registration fails
    func didFailToRegisterForRemoteNotifications(error: Error) {
        print("[NotificationManager] ❌ Failed to register for remote notifications: \(error)")
    }

    /// Register device token with server
    private func registerDeviceWithServer(deviceToken: String) async {
        do {
            print("[NotificationManager] 📤 Registering device with server...")

            #if DEBUG
            let isProduction = false
            #else
            let isProduction = true
            #endif

            try await APIClient.shared.registerDevice(
                deviceToken: deviceToken,
                platform: "ios",
                production: isProduction
            )

            // Save registration timestamp
            userDefaults.set(Date(), forKey: lastRegistrationKey)
            print("[NotificationManager] ✅ Device registered with server successfully")
            print("[NotificationManager] 💾 Saved registration timestamp")
        } catch {
            print("[NotificationManager] ❌ Failed to register device with server: \(error)")
        }
    }

    // MARK: - Handle Notification

    /// Handle incoming notification when app is in foreground
    func handleNotification(_ userInfo: [AnyHashable: Any]) {
        print("[NotificationManager] 📬 Received notification: \(userInfo)")

        guard let tagId = userInfo["tagId"] as? String else {
            print("[NotificationManager] ⚠️ No tagId in notification payload")
            return
        }

        // Post notification for MessageListViewModel to refresh
        NotificationCenter.default.post(
            name: NSNotification.Name("NewMessageReceived"),
            object: nil,
            userInfo: ["tagId": tagId]
        )

        print("[NotificationManager] ✅ Posted refresh notification for tag: \(tagId)")
    }

    /// Handle notification tap - navigate to tag
    func handleNotificationTap(_ userInfo: [AnyHashable: Any]) {
        print("[NotificationManager] 👆 Notification tapped: \(userInfo)")

        guard let tagId = userInfo["tagId"] as? String else {
            print("[NotificationManager] ⚠️ No tagId in notification payload")
            return
        }

        // Set the tag to open
        selectedTagId = tagId
        shouldOpenMessage = true

        print("[NotificationManager] ✅ Set to open tag: \(tagId)")
    }
}

// MARK: - UNUserNotificationCenterDelegate

extension NotificationManager: UNUserNotificationCenterDelegate {
    /// Called when notification arrives while app is in foreground
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        Task { @MainActor in
            let userInfo = notification.request.content.userInfo
            print("[NotificationManager] 📱 Notification received in foreground")

            // Handle the notification
            self.handleNotification(userInfo)

            // Show banner even when app is open
            completionHandler([.banner, .sound])
        }
    }

    /// Called when user taps on notification
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        Task { @MainActor in
            let userInfo = response.notification.request.content.userInfo
            print("[NotificationManager] 👆 User tapped notification")

            // Handle the tap - navigate to tag
            self.handleNotificationTap(userInfo)

            completionHandler()
        }
    }
}
