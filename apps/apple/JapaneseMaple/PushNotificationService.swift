//
//  PushNotificationService.swift
//  JapaneseMaple
//
//  Push notification management and device registration
//

import Foundation
import UserNotifications

#if os(iOS)
import UIKit
#elseif os(macOS)
import AppKit
#endif

class PushNotificationService: NSObject {
    static let shared = PushNotificationService()

    private let serverKeyKey = "push_server_key"
    private let deviceTokenKey = "push_device_token"

    private override init() {
        super.init()
    }

    // MARK: - Public API

    /// Request notification permissions and register for push
    func requestPermissionsAndRegister() async throws {
        // Request authorization
        let center = UNUserNotificationCenter.current()
        let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])

        guard granted else {
            throw PushError.permissionDenied
        }

        // Register for remote notifications (must be on main thread)
        await MainActor.run {
            #if os(iOS)
            UIApplication.shared.registerForRemoteNotifications()
            #elseif os(macOS)
            NSApplication.shared.registerForRemoteNotifications()
            #endif
        }

        print("[PushNotificationService] Requested permissions and registered for push")
    }

    /// Handle device token receipt from APNs
    func didReceiveDeviceToken(_ deviceToken: Data) {
        let tokenString = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        print("[PushNotificationService] Received device token: \(tokenString)")

        // Save device token
        UserDefaults.standard.set(tokenString, forKey: deviceTokenKey)

        // Generate or retrieve serverKey
        let serverKey = getOrCreateServerKey()

        // Register with API (which handles APNs directly)
        Task {
            do {
                try await registerWithMapleAPI(serverKey: serverKey, deviceToken: tokenString)
                print("[PushNotificationService] Successfully registered with Maple API")
            } catch {
                print("[PushNotificationService] Failed to register with Maple API: \(error)")
            }
        }
    }

    /// Handle device token registration failure
    func didFailToRegisterForRemoteNotifications(error: Error) {
        print("[PushNotificationService] Failed to register for remote notifications: \(error)")
    }

    /// Unregister device from push notifications
    func unregister() async throws {
        guard let serverKey = UserDefaults.standard.string(forKey: serverKeyKey) else {
            print("[PushNotificationService] No serverKey found, nothing to unregister")
            return
        }

        // Unregister from Maple API
        try await unregisterFromMapleAPI(serverKey: serverKey)

        // Clear local data
        UserDefaults.standard.removeObject(forKey: serverKeyKey)
        UserDefaults.standard.removeObject(forKey: deviceTokenKey)

        print("[PushNotificationService] Successfully unregistered")
    }

    /// Get current server key (if registered)
    func getServerKey() -> String? {
        return UserDefaults.standard.string(forKey: serverKeyKey)
    }

    // MARK: - Private Helpers

    private func getOrCreateServerKey() -> String {
        if let existing = UserDefaults.standard.string(forKey: serverKeyKey) {
            return existing
        }

        // Generate new opaque server key (cryptographically random)
        let serverKey = UUID().uuidString + "-" + UUID().uuidString
        UserDefaults.standard.set(serverKey, forKey: serverKeyKey)

        print("[PushNotificationService] Generated new serverKey")
        return serverKey
    }

    private func registerWithMapleAPI(serverKey: String, deviceToken: String) async throws {
        let activeServer = ServerConfigService.shared.getActiveServer()
        guard let url = URL(string: "\(activeServer.url)/api/notifications/register") else {
            throw PushError.invalidURL
        }

        guard let token = ServerConfigService.shared.getToken() else {
            throw PushError.notAuthenticated
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        #if os(iOS)
        let platform = "ios"
        #elseif os(macOS)
        let platform = "macos"
        #endif

        let body: [String: String] = [
            "serverKey": serverKey,
            "deviceToken": deviceToken,
            "platform": platform
        ]
        request.httpBody = try JSONEncoder().encode(body)

        let (_, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw PushError.registrationFailed
        }
    }

    private func unregisterFromMapleAPI(serverKey: String) async throws {
        let activeServer = ServerConfigService.shared.getActiveServer()
        guard let url = URL(string: "\(activeServer.url)/api/notifications/unregister") else {
            throw PushError.invalidURL
        }

        guard let token = ServerConfigService.shared.getToken() else {
            throw PushError.notAuthenticated
        }

        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let body = ["serverKey": serverKey]
        request.httpBody = try JSONEncoder().encode(body)

        let (_, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw PushError.unregistrationFailed
        }
    }

    enum PushError: LocalizedError {
        case permissionDenied
        case invalidURL
        case notAuthenticated
        case registrationFailed
        case unregistrationFailed

        var errorDescription: String? {
            switch self {
            case .permissionDenied:
                return "Push notification permission denied"
            case .invalidURL:
                return "Invalid API URL"
            case .notAuthenticated:
                return "User not authenticated"
            case .registrationFailed:
                return "Failed to register device with server"
            case .unregistrationFailed:
                return "Failed to unregister device from server"
            }
        }
    }
}
