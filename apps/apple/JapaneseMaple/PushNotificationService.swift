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

    private let serverKeyMapKey = "push_server_key_map"  // serverKey → serverId mapping
    private let deviceTokenKey = "push_device_token"

    // Completion handler for registration flow
    private var registrationCompletion: ((Bool, Error?) -> Void)?

    // Temporary serverId for current registration flow
    private var currentServerId: String?

    private override init() {
        super.init()
    }

    // MARK: - Public API

    /// Request notification permissions and register for push
    func requestPermissionsAndRegister(serverId: String, completion: @escaping (Bool, Error?) -> Void) async throws {
        // Store serverId and completion for later when device token arrives
        self.currentServerId = serverId
        self.registrationCompletion = completion

        // Request authorization
        let center = UNUserNotificationCenter.current()
        let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])

        guard granted else {
            // Call completion immediately if permission denied
            completion(false, PushError.permissionDenied)
            self.registrationCompletion = nil
            self.currentServerId = nil
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

        print("[PushNotificationService] Requested permissions and registered for push on server: \(serverId)")
        // Completion will be called when device token arrives and API registration completes
    }

    /// Handle device token receipt from APNs
    func didReceiveDeviceToken(_ deviceToken: Data) {
        let tokenString = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        print("[PushNotificationService] Received device token: \(tokenString)")

        // Save device token
        UserDefaults.standard.set(tokenString, forKey: deviceTokenKey)

        // Get the serverId for this registration
        guard let serverId = self.currentServerId else {
            print("[PushNotificationService] No serverId for registration, ignoring")
            return
        }

        // Generate or retrieve serverKey for this serverId
        let serverKey = getOrCreateServerKey(for: serverId)

        // Register with API (which handles APNs directly)
        Task {
            do {
                try await registerWithMapleAPI(serverKey: serverKey, deviceToken: tokenString)
                print("[PushNotificationService] Successfully registered with Maple API for server: \(serverId)")

                // Call completion handler if present
                if let completion = self.registrationCompletion {
                    completion(true, nil)
                    self.registrationCompletion = nil
                    self.currentServerId = nil
                }
            } catch {
                print("[PushNotificationService] Failed to register with Maple API: \(error)")

                // Call completion handler with error if present
                if let completion = self.registrationCompletion {
                    completion(false, error)
                    self.registrationCompletion = nil
                    self.currentServerId = nil
                }
            }
        }
    }

    /// Handle device token registration failure
    func didFailToRegisterForRemoteNotifications(error: Error) {
        print("[PushNotificationService] Failed to register for remote notifications: \(error)")

        // Call completion handler with error if present
        if let completion = self.registrationCompletion {
            completion(false, error)
            self.registrationCompletion = nil
            self.currentServerId = nil
        }
    }

    /// Unregister device from push notifications for a specific server
    func unregister(serverId: String) async throws {
        guard let serverKey = getServerKey(for: serverId) else {
            print("[PushNotificationService] No serverKey found for server: \(serverId)")
            return
        }

        // Unregister from Maple API
        try await unregisterFromMapleAPI(serverKey: serverKey)

        // Remove from local map
        var map = getServerKeyMap()
        map.removeValue(forKey: serverKey)
        saveServerKeyMap(map)

        print("[PushNotificationService] Successfully unregistered from server: \(serverId)")
    }

    /// Unregister device from push notifications (all servers)
    func unregister() async throws {
        let map = getServerKeyMap()
        guard !map.isEmpty else {
            print("[PushNotificationService] No registrations found")
            return
        }

        // Unregister from all servers
        for (serverKey, serverId) in map {
            do {
                try await unregisterFromMapleAPI(serverKey: serverKey)
                print("[PushNotificationService] Unregistered from server: \(serverId)")
            } catch {
                print("[PushNotificationService] Failed to unregister from server \(serverId): \(error)")
            }
        }

        // Clear all local data
        UserDefaults.standard.removeObject(forKey: serverKeyMapKey)

        print("[PushNotificationService] Successfully unregistered from all servers")
    }

    /// Get current server key (if registered)
    func getServerKey() -> String? {
        // Return first serverKey (for backwards compatibility)
        let map = getServerKeyMap()
        return map.keys.first
    }

    /// Get serverId for a given serverKey
    func getServerId(for serverKey: String) -> String? {
        let map = getServerKeyMap()
        return map[serverKey]
    }

    /// Get serverKey for a given serverId
    func getServerKey(for serverId: String) -> String? {
        let map = getServerKeyMap()
        return map.first(where: { $0.value == serverId })?.key
    }

    // MARK: - Private Helpers

    /// Get the serverKey → serverId mapping from UserDefaults
    private func getServerKeyMap() -> [String: String] {
        guard let data = UserDefaults.standard.data(forKey: serverKeyMapKey),
              let map = try? JSONDecoder().decode([String: String].self, from: data) else {
            return [:]
        }
        return map
    }

    /// Save the serverKey → serverId mapping to UserDefaults
    private func saveServerKeyMap(_ map: [String: String]) {
        if let data = try? JSONEncoder().encode(map) {
            UserDefaults.standard.set(data, forKey: serverKeyMapKey)
            
            // Also save to shared container for extension access
            if let sharedDefaults = UserDefaults(suiteName: "group.com.just.maple.JapaneseMaple") {
                sharedDefaults.set(data, forKey: serverKeyMapKey)
                print("[PushNotificationService] Synced server key map to shared storage")
            }
        }
    }

    /// Get or create serverKey for a specific serverId
    private func getOrCreateServerKey(for serverId: String) -> String {
        // Check if we already have a serverKey for this serverId
        if let existingServerKey = getServerKey(for: serverId) {
            return existingServerKey
        }

        // Generate new opaque server key (cryptographically random)
        let serverKey = UUID().uuidString + "-" + UUID().uuidString

        // Store the mapping
        var map = getServerKeyMap()
        map[serverKey] = serverId
        saveServerKeyMap(map)

        print("[PushNotificationService] Generated new serverKey for server: \(serverId)")
        return serverKey
    }

    /// Detect if the app is using production or sandbox APNs environment
    private func isProductionEnvironment() -> Bool {
        // Check the aps-environment entitlement
        // Production builds (TestFlight/App Store) will have "production"
        // Development builds will have "development"
        #if targetEnvironment(simulator)
        // Simulator always uses sandbox
        return false
        #else
        // Check the entitlement
        guard let path = Bundle.main.path(forResource: "embedded", ofType: "mobileprovision") else {
            // No provisioning profile = App Store build = production
            return true
        }

        // Has provisioning profile = development or ad-hoc = sandbox
        // Note: TestFlight builds don't have embedded.mobileprovision
        return false
        #endif
    }

    private func registerWithMapleAPI(serverKey: String, deviceToken: String) async throws {
        let apiUrl = ServerConfigService.shared.getAPIUrl()
        guard let url = URL(string: "\(apiUrl)/api/notifications/register") else {
            throw PushError.invalidURL
        }

        print("[PushNotificationService] 📍 Registering with API: \(apiUrl)")

        guard let token = ServerConfigService.shared.getToken() else {
            print("[PushNotificationService] ❌ No auth token found")
            throw PushError.notAuthenticated
        }

        print("[PushNotificationService] 🔑 Auth token: \(token.prefix(20))...")

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        #if os(iOS)
        let platform = "ios"
        #elseif os(macOS)
        let platform = "macos"
        #endif

        let isProduction = isProductionEnvironment()
        print("[PushNotificationService] 🏷️ APNs Environment: \(isProduction ? "production" : "sandbox")")

        let body: [String: Any] = [
            "serverKey": serverKey,
            "deviceToken": deviceToken,
            "platform": platform,
            "production": isProduction
        ]

        let jsonData = try JSONSerialization.data(withJSONObject: body)
        request.httpBody = jsonData

        if let jsonString = String(data: jsonData, encoding: .utf8) {
            print("[PushNotificationService] 📤 Request URL: \(url)")
            print("[PushNotificationService] 📤 Request Body: \(jsonString)")
        }

        let (responseData, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            print("[PushNotificationService] ❌ Invalid response type")
            throw PushError.registrationFailed
        }

        print("[PushNotificationService] 📥 Response Status: \(httpResponse.statusCode)")

        if let responseString = String(data: responseData, encoding: .utf8) {
            print("[PushNotificationService] 📥 Response Body: \(responseString)")
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            print("[PushNotificationService] ❌ Registration failed with status \(httpResponse.statusCode)")
            throw PushError.registrationFailed
        }

        print("[PushNotificationService] ✅ Registration successful")
    }

    private func unregisterFromMapleAPI(serverKey: String) async throws {
        let apiUrl = ServerConfigService.shared.getAPIUrl()
        guard let url = URL(string: "\(apiUrl)/api/notifications/unregister") else {
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
