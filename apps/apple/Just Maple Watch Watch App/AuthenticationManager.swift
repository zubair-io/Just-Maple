//
//  AuthenticationManager.swift
//  Just Maple Watch App
//
//  Manages authentication state and syncs with iPhone
//

import Foundation
import Combine
import WatchConnectivity

@MainActor
class AuthenticationManager: NSObject, ObservableObject {
    static let shared = AuthenticationManager()

    @Published var isAuthenticated = false
    @Published var apiUrl: String?
    @Published var lastSyncDate: Date?
    @Published var isPhoneReachable = false
    @Published var debugInfo: [String] = []

    private override init() {
        super.init()
        setupWatchConnectivity()
        checkAuthenticationStatus()
    }

    // MARK: - Watch Connectivity Setup

    private func setupWatchConnectivity() {
        guard WCSession.isSupported() else {
            print("[AuthManager] Watch Connectivity not supported")
            return
        }

        let session = WCSession.default
        session.delegate = self
        session.activate()

        print("[AuthManager] Watch Connectivity session activated")
    }

    // MARK: - Authentication Status

    func checkAuthenticationStatus() {
        debugInfo.removeAll()
        debugInfo.append("🔍 Checking keychain...")

        // Try to read token directly from shared keychain
        let (token, keychainDebug) = KeychainHelper.shared.getTokenWithDebug()

        // Add keychain debug info to our debug array
        debugInfo.append(contentsOf: keychainDebug)

        if let token = token {
            isAuthenticated = true
            debugInfo.append("✅ Token found!")
            debugInfo.append("Length: \(token.count) chars")
            debugInfo.append("Preview: \(token.prefix(20))...")
            print("[AuthManager] ✅ Authentication token found in shared keychain")

            // Token exists, we're authenticated
            // Using paperbark.justmaple.app as the API base URL
            apiUrl = "https://paperbark.justmaple.app"
            lastSyncDate = Date()
        } else {
            isAuthenticated = false
            debugInfo.append("❌ No token found")
            print("[AuthManager] ⚠️ No authentication token found in shared keychain")
        }
    }

    // MARK: - Sync Methods

    /// Request authentication sync from iPhone
    func requestAuthSync() {
        guard WCSession.default.isReachable else {
            print("[AuthManager] iPhone not reachable, cannot sync")
            return
        }

        let message = ["request": "syncAuth"]

        WCSession.default.sendMessage(message, replyHandler: { [weak self] reply in
            guard let self = self else { return }

            Task { @MainActor in
                if let success = reply["success"] as? Bool, success,
                   let token = reply["token"] as? String,
                   let apiUrl = reply["apiUrl"] as? String
                {
                    // Save token to keychain
                    if KeychainHelper.shared.saveToken(token) {
                        self.apiUrl = apiUrl
                        self.lastSyncDate = Date()
                        self.isAuthenticated = true
                        print("[AuthManager] ✅ Authentication synced from iPhone")
                    }
                } else if let error = reply["error"] as? String {
                    print("[AuthManager] ❌ Sync failed: \(error)")
                }
            }
        }, errorHandler: { error in
            print("[AuthManager] ❌ Failed to send sync request: \(error)")
        })
    }

    /// Request a fresh token from iPhone and save it to keychain
    /// Returns the new token if successful, nil otherwise
    func requestFreshToken() async -> String? {
        guard WCSession.default.isReachable else {
            print("[AuthManager] iPhone not reachable for token refresh")
            return nil
        }

        return await withCheckedContinuation { continuation in
            let message = ["request": "syncAuth"]

            WCSession.default.sendMessage(message, replyHandler: { [weak self] reply in
                guard let self = self else {
                    continuation.resume(returning: nil)
                    return
                }

                if let success = reply["success"] as? Bool, success,
                   let token = reply["token"] as? String,
                   let apiUrl = reply["apiUrl"] as? String
                {
                    if KeychainHelper.shared.saveToken(token) {
                        Task { @MainActor in
                            self.apiUrl = apiUrl
                            self.lastSyncDate = Date()
                            self.isAuthenticated = true
                        }
                        print("[AuthManager] ✅ Fresh token received from iPhone")
                        continuation.resume(returning: token)
                    } else {
                        continuation.resume(returning: nil)
                    }
                } else {
                    continuation.resume(returning: nil)
                }
            }, errorHandler: { error in
                print("[AuthManager] ❌ Token refresh failed: \(error)")
                continuation.resume(returning: nil)
            })
        }
    }

    /// Sign out (clear local token)
    func signOut() {
        _ = KeychainHelper.shared.clearToken()
        isAuthenticated = false
        apiUrl = nil
        lastSyncDate = nil
        print("[AuthManager] ✅ Signed out")
    }
}

// MARK: - WCSessionDelegate

extension AuthenticationManager: WCSessionDelegate {
    nonisolated func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        Task { @MainActor in
            if let error = error {
                print("[AuthManager] Activation failed: \(error)")
                return
            }

            switch activationState {
            case .activated:
                print("[AuthManager] Session activated")
                self.isPhoneReachable = session.isReachable

                // Check keychain for existing token
                self.checkAuthenticationStatus()

            case .inactive:
                print("[AuthManager] Session inactive")
            case .notActivated:
                print("[AuthManager] Session not activated")
            @unknown default:
                print("[AuthManager] Unknown activation state")
            }
        }
    }

    #if os(iOS)
        nonisolated func sessionDidBecomeInactive(_ session: WCSession) {
            print("[AuthManager] Session became inactive")
        }

        nonisolated func sessionDidDeactivate(_ session: WCSession) {
            print("[AuthManager] Session deactivated")
            // Reactivate session
            WCSession.default.activate()
        }
    #endif

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        Task { @MainActor in
            self.isPhoneReachable = session.isReachable
            print(
                "[AuthManager] Reachability changed: \(session.isReachable ? "reachable" : "not reachable")"
            )

            // Re-check authentication status when phone becomes reachable
            if session.isReachable && !self.isAuthenticated {
                self.checkAuthenticationStatus()
            }
        }
    }

    nonisolated func session(
        _ session: WCSession,
        didReceiveApplicationContext applicationContext: [String: Any]
    ) {
        Task { @MainActor in
            print("[AuthManager] Received application context: \(applicationContext)")

            // Check if this is a clear auth message
            if let cleared = applicationContext["cleared"] as? Bool, cleared {
                self.signOut()
                return
            }

            // Extract token and API URL
            guard
                let token = applicationContext["token"] as? String,
                !token.isEmpty,
                let apiUrl = applicationContext["apiUrl"] as? String
            else {
                print("[AuthManager] ⚠️ Invalid or empty context data")
                return
            }

            // Save token to keychain
            if KeychainHelper.shared.saveToken(token) {
                self.apiUrl = apiUrl
                self.lastSyncDate = Date()
                self.isAuthenticated = true
                print("[AuthManager] ✅ Authentication received from iPhone via context")
            } else {
                print("[AuthManager] ❌ Failed to save token to keychain")
            }
        }
    }
}
