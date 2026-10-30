//
//  JapaneseMapleApp.swift
//  JapaneseMaple
//
//  Created by Zubair Lawrence on 11/30/25.
//

import SwiftUI
import UserNotifications

#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

@main
struct JapaneseMapleApp: App {
    #if os(iOS)
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    #elseif os(macOS)
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
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
            CommandGroup(after: .appSettings) {
                Button("Server Settings…") {
                    NotificationCenter.default.post(name: ServerConfigService.openSettings, object: nil)
                }
            }
        }
        #endif
    }

    private func handleDeepLink(url: URL) {
        print("[JapaneseMapleApp] Received deep link: \(url)")
        NotificationCenter.default.post(
            name: NSNotification.Name("DeepLinkReceived"),
            object: nil,
            userInfo: ["url": url.absoluteString]
        )
    }
}

// MARK: - AppDelegate for Push Notifications

#if os(iOS)
class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Set notification center delegate
        UNUserNotificationCenter.current().delegate = self
        print("[AppDelegate] ✅ Set UNUserNotificationCenter delegate to AppDelegate")

        // Resume the Location and Health collectors. iOS relaunches the app in the
        // background to deliver visits and new Health data, so this must run at launch.
        CollectorsHost.shared.resume()

        // Check if app was launched from notification tap
        if let notificationOption = launchOptions?[.remoteNotification] as? [AnyHashable: Any] {
            print("[AppDelegate] 🚀 App launched from notification tap!")
            print("[AppDelegate] 🚀 Notification payload: \(notificationOption)")
        }

        return true
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        print("[AppDelegate] 🔄 App became active")
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        print("[AppDelegate] 🔄 App will enter foreground")
    }

    // Handle successful device token registration
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        PushNotificationService.shared.didReceiveDeviceToken(deviceToken)
    }

    // Handle device token registration failure
    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        PushNotificationService.shared.didFailToRegisterForRemoteNotifications(error: error)
    }

    // Handle notification when app is in foreground
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        let userInfo = notification.request.content.userInfo
        print("[AppDelegate] 📬 Notification received (foreground)")
        print("[AppDelegate] 📬 Payload: \(userInfo)")

        if let notificationId = userInfo["notificationId"] as? String,
           let type = userInfo["type"] as? String {
            print("[AppDelegate] 📬 Notification ID: \(notificationId), Type: \(type)")

            // Post to NotificationCenter so Angular app can show in-app toast
            NotificationCenter.default.post(
                name: NSNotification.Name("ForegroundNotificationReceived"),
                object: nil,
                userInfo: userInfo
            )
            print("[AppDelegate] 📬 Posted foreground notification to NotificationCenter")
        }

        // Don't show native banner when app is in foreground - let Angular handle it
        completionHandler([])
    }

    // Handle notification tap
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        print("[AppDelegate] 👆 Notification tapped!")
        print("[AppDelegate] 👆 Full payload: \(userInfo)")

        // Extract notification data
        if let notificationId = userInfo["notificationId"] as? String,
           let type = userInfo["type"] as? String {
            print("[AppDelegate] 👆 Notification tapped - ID: \(notificationId), Type: \(type)")
            print("[AppDelegate] 👆 Posting notification to app for handling...")

            // Build notification data
            var notificationData: [String: Any] = [
                "notificationId": notificationId,
                "type": type
            ]

            // Include serverUrl if present (for multi-server support)
            if let serverUrl = userInfo["serverUrl"] as? String {
                notificationData["serverUrl"] = serverUrl
                print("[AppDelegate] 🔗 Including serverUrl: \(serverUrl)")
            }

            // Include additional data (tagId, messageId, etc.)
            if let tagId = userInfo["tagId"] as? String {
                notificationData["tagId"] = tagId
            }
            if let messageId = userInfo["messageId"] as? String {
                notificationData["messageId"] = messageId
            }

            // Post notification for app to handle
            NotificationCenter.default.post(
                name: NSNotification.Name("NotificationTapped"),
                object: nil,
                userInfo: notificationData
            )
            print("[AppDelegate] ✅ Posted notification to NotificationCenter")
        } else {
            print("[AppDelegate] ❌ Failed to extract notificationId or type from payload")
        }

        completionHandler()
    }
}

#elseif os(macOS)
class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Set notification center delegate
        UNUserNotificationCenter.current().delegate = self
    }

    // Handle successful device token registration
    func application(
        _ application: NSApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        PushNotificationService.shared.didReceiveDeviceToken(deviceToken)
    }

    // Handle device token registration failure
    func application(
        _ application: NSApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        PushNotificationService.shared.didFailToRegisterForRemoteNotifications(error: error)
    }

    // Handle notification when app is in foreground
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        let userInfo = notification.request.content.userInfo
        print("[AppDelegate] 📬 Notification received (foreground)")
        print("[AppDelegate] 📬 Payload: \(userInfo)")

        if let notificationId = userInfo["notificationId"] as? String,
           let type = userInfo["type"] as? String {
            print("[AppDelegate] 📬 Notification ID: \(notificationId), Type: \(type)")

            // Post to NotificationCenter so Angular app can show in-app toast
            NotificationCenter.default.post(
                name: NSNotification.Name("ForegroundNotificationReceived"),
                object: nil,
                userInfo: userInfo
            )
            print("[AppDelegate] 📬 Posted foreground notification to NotificationCenter")
        }

        // Don't show native banner when app is in foreground - let Angular handle it
        completionHandler([])
    }

    // Handle notification tap
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        print("[AppDelegate] 👆 Notification tapped!")
        print("[AppDelegate] 👆 Full payload: \(userInfo)")

        // Extract notification data
        if let notificationId = userInfo["notificationId"] as? String,
           let type = userInfo["type"] as? String {
            print("[AppDelegate] 👆 Notification tapped - ID: \(notificationId), Type: \(type)")
            print("[AppDelegate] 👆 Posting notification to app for handling...")

            // Build notification data
            var notificationData: [String: Any] = [
                "notificationId": notificationId,
                "type": type
            ]

            // Include serverUrl if present (for multi-server support)
            if let serverUrl = userInfo["serverUrl"] as? String {
                notificationData["serverUrl"] = serverUrl
                print("[AppDelegate] 🔗 Including serverUrl: \(serverUrl)")
            }

            // Include additional data (tagId, messageId, etc.)
            if let tagId = userInfo["tagId"] as? String {
                notificationData["tagId"] = tagId
            }
            if let messageId = userInfo["messageId"] as? String {
                notificationData["messageId"] = messageId
            }

            // Post notification for app to handle
            NotificationCenter.default.post(
                name: NSNotification.Name("NotificationTapped"),
                object: nil,
                userInfo: notificationData
            )
            print("[AppDelegate] ✅ Posted notification to NotificationCenter")
        } else {
            print("[AppDelegate] ❌ Failed to extract notificationId or type from payload")
        }

        completionHandler()
    }
}
#endif

