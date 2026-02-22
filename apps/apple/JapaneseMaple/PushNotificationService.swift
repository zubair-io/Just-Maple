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

    private let registeredServersKey = "push_registered_servers"  // Set of registered server IDs
    private let deviceTokenKey = "push_device_token"

    // Completion handler for registration flow
    private var registrationCompletion: ((Bool, Error?) -> Void)?

    // Temporary serverId for current registration flow
    private var currentServerId: String?
    
    // Timeout task for registration
    private var registrationTimeoutTask: Task<Void, Never>?

    private override init() {
        super.init()
    }

    // MARK: - Public API

    /// Request notification permissions and register for push
    func requestPermissionsAndRegister(serverId: String, completion: @escaping (Bool, Error?) -> Void) async throws {
        // Cancel any existing timeout
        registrationTimeoutTask?.cancel()
        
        // Store serverId and completion for later when device token arrives
        self.currentServerId = serverId
        self.registrationCompletion = completion

        // Request authorization
        let center = UNUserNotificationCenter.current()
        
        do {
            let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
            
            guard granted else {
                // Call completion immediately if permission denied
                let error = PushError.permissionDenied
                completion(false, error)
                self.registrationCompletion = nil
                self.currentServerId = nil
                throw error
            }
            
            print("[PushNotificationService] ✅ User granted notification permissions")
            
            // Register for remote notifications (must be on main thread)
            await MainActor.run {
                #if os(iOS)
                UIApplication.shared.registerForRemoteNotifications()
                #elseif os(macOS)
                NSApplication.shared.registerForRemoteNotifications()
                #endif
            }
            
            print("[PushNotificationService] 📱 Called registerForRemoteNotifications, waiting for device token...")
            
            // Set up timeout (30 seconds) in case device token never arrives
            registrationTimeoutTask = Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 30_000_000_000) // 30 seconds
                
                guard !Task.isCancelled else { return }
                
                print("[PushNotificationService] ⏰ Device token timeout - registration took too long")
                
                if let completion = self?.registrationCompletion {
                    let error = PushError.registrationTimeout
                    completion(false, error)
                    self?.registrationCompletion = nil
                    self?.currentServerId = nil
                }
            }
            
            // Completion will be called when device token arrives and API registration completes
            // Note: This function returns here, but completion is stored and will be called later
        } catch {
            print("[PushNotificationService] ❌ Authorization request failed: \(error)")
            registrationTimeoutTask?.cancel()
            completion(false, error)
            self.registrationCompletion = nil
            self.currentServerId = nil
            throw error
        }
    }

    /// Handle device token receipt from APNs
    func didReceiveDeviceToken(_ deviceToken: Data) {
        // Cancel timeout since we got the token
        registrationTimeoutTask?.cancel()
        
        let tokenString = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        print("[PushNotificationService] Received device token: \(tokenString)")

        // Save device token
        UserDefaults.standard.set(tokenString, forKey: deviceTokenKey)

        // Get the serverId for this registration
        guard let serverId = self.currentServerId else {
            print("[PushNotificationService] No serverId for registration, ignoring")
            return
        }

        // Register with API (which handles APNs directly)
        Task {
            do {
                try await registerWithMapleAPI(serverId: serverId, deviceToken: tokenString)
                print("[PushNotificationService] Successfully registered with Maple API for server: \(serverId)")

                // Mark server as registered
                markServerAsRegistered(serverId: serverId)

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
        // Cancel timeout
        registrationTimeoutTask?.cancel()
        
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
        guard isServerRegistered(serverId: serverId) else {
            print("[PushNotificationService] Server not registered: \(serverId)")
            return
        }

        // Unregister from Maple API
        try await unregisterFromMapleAPI(serverId: serverId)

        // Remove from local set
        markServerAsUnregistered(serverId: serverId)

        print("[PushNotificationService] Successfully unregistered from server: \(serverId)")
    }

    /// Unregister device from push notifications
    func unregister() async throws {
        let server = ServerConfigService.shared.getActiveServer()
        do {
            try await unregisterFromMapleAPI(serverId: server.id)
            print("[PushNotificationService] Unregistered from server: \(server.id)")
        } catch PushError.notAuthenticated {
            print("[PushNotificationService] No auth token, skipping unregister")
        } catch {
            print("[PushNotificationService] Failed to unregister: \(error)")
        }

        // Clear local registration data
        UserDefaults.standard.removeObject(forKey: registeredServersKey)
    }

    /// Check if a server is registered for push notifications
    func isServerRegistered(serverId: String) -> Bool {
        let servers = getRegisteredServers()
        return servers.contains(serverId)
    }

    // MARK: - Private Helpers

    /// Get the set of registered server IDs from UserDefaults
    private func getRegisteredServers() -> Set<String> {
        guard let data = UserDefaults.standard.data(forKey: registeredServersKey),
              let servers = try? JSONDecoder().decode(Set<String>.self, from: data) else {
            return []
        }
        return servers
    }

    /// Mark a server as registered
    private func markServerAsRegistered(serverId: String) {
        var servers = getRegisteredServers()
        servers.insert(serverId)
        if let data = try? JSONEncoder().encode(servers) {
            UserDefaults.standard.set(data, forKey: registeredServersKey)
            print("[PushNotificationService] Marked server as registered: \(serverId)")
        }
    }

    /// Mark a server as unregistered
    private func markServerAsUnregistered(serverId: String) {
        var servers = getRegisteredServers()
        servers.remove(serverId)
        if let data = try? JSONEncoder().encode(servers) {
            UserDefaults.standard.set(data, forKey: registeredServersKey)
            print("[PushNotificationService] Marked server as unregistered: \(serverId)")
        }
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
        if Bundle.main.path(forResource: "embedded", ofType: "mobileprovision") != nil {
            // Has provisioning profile = development or ad-hoc = sandbox
            // Note: TestFlight builds don't have embedded.mobileprovision
            return false
        }
        
        // No provisioning profile = App Store build = production
        return true
        #endif
    }

    private func registerWithMapleAPI(serverId: String, deviceToken: String) async throws {
        let server = ServerConfigService.shared.getActiveServer()
        let apiUrl = server.getAPIUrl()
        guard let url = URL(string: "\(apiUrl)/api/notifications/register") else {
            throw PushError.invalidURL
        }

        print("[PushNotificationService] 📍 Registering with API: \(apiUrl)")

        // server.id == server.url, so we can use either for token lookup
        guard let token = ServerConfigService.shared.getToken(serverId: server.id) else {
            print("[PushNotificationService] ❌ No auth token found for server: \(server.id)")
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
            "serverUrl": apiUrl,
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

    private func unregisterFromMapleAPI(serverId: String) async throws {
        let server = ServerConfigService.shared.getActiveServer()
        let apiUrl = server.getAPIUrl()
        guard let url = URL(string: "\(apiUrl)/api/notifications/unregister") else {
            throw PushError.invalidURL
        }

        // server.id == server.url, so we can use either for token lookup
        guard let token = ServerConfigService.shared.getToken(serverId: server.id) else {
            throw PushError.notAuthenticated
        }

        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let body = ["serverUrl": apiUrl]
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
        case registrationTimeout

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
            case .registrationTimeout:
                return "Device registration timed out. Please check your network connection and try again."
            }
        }
    }
}
