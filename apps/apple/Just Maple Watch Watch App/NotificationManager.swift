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

    private override init() {
        super.init()
    }

    // MARK: - Registration

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
