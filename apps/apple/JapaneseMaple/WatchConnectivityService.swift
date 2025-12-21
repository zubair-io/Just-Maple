//
//  WatchConnectivityService.swift
//  JapaneseMaple
//
//  Service to sync authentication and data with Apple Watch
//

import Foundation
import Combine
import WatchConnectivity

class WatchConnectivityService: NSObject, ObservableObject {
    static let shared = WatchConnectivityService()

    @Published var isWatchAppInstalled = false
    @Published var isWatchReachable = false

    private override init() {
        super.init()
        setupSession()
    }

    private func setupSession() {
        guard WCSession.isSupported() else {
            print("[WatchConnectivity] Watch Connectivity not supported")
            return
        }

        let session = WCSession.default
        session.delegate = self
        session.activate()

        print("[WatchConnectivity] Session activated")
    }

    // MARK: - Sync Methods

    /// Sync authentication token to Watch
    func syncAuthToken() {
        guard WCSession.default.activationState == .activated else {
            print("[WatchConnectivity] Session not activated yet")
            return
        }

        guard let token = ServerConfigService.shared.getToken() else {
            print("[WatchConnectivity] No token to sync")
            return
        }

        let apiUrl = ServerConfigService.shared.getAPIUrl()

        // Use application context for persistent data
        let context: [String: Any] = [
            "token": token,
            "apiUrl": apiUrl,
            "syncedAt": Date().timeIntervalSince1970,
        ]

        do {
            try WCSession.default.updateApplicationContext(context)
            print("[WatchConnectivity] ✅ Synced auth token to Watch")
        } catch {
            print("[WatchConnectivity] ❌ Failed to sync token: \(error)")
        }
    }

    /// Clear authentication from Watch
    func clearAuthToken() {
        guard WCSession.default.activationState == .activated else {
            return
        }

        let context: [String: Any] = [
            "token": "",
            "apiUrl": "",
            "cleared": true,
        ]

        do {
            try WCSession.default.updateApplicationContext(context)
            print("[WatchConnectivity] ✅ Cleared auth token from Watch")
        } catch {
            print("[WatchConnectivity] ❌ Failed to clear token: \(error)")
        }
    }

    /// Send a message to the Watch (requires reachability)
    func sendMessage(_ message: [String: Any], replyHandler: (([String: Any]) -> Void)? = nil) {
        guard WCSession.default.isReachable else {
            print("[WatchConnectivity] Watch not reachable")
            return
        }

        WCSession.default.sendMessage(
            message,
            replyHandler: replyHandler,
            errorHandler: { error in
                print("[WatchConnectivity] Failed to send message: \(error)")
            }
        )
    }
}

// MARK: - WCSessionDelegate

extension WatchConnectivityService: WCSessionDelegate {
    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        DispatchQueue.main.async {
            if let error = error {
                print("[WatchConnectivity] Activation failed: \(error)")
                return
            }

            switch activationState {
            case .activated:
                print("[WatchConnectivity] Session activated")
                self.isWatchAppInstalled = session.isWatchAppInstalled
                self.isWatchReachable = session.isReachable

                // Sync token when session activates
                self.syncAuthToken()

            case .inactive:
                print("[WatchConnectivity] Session inactive")
            case .notActivated:
                print("[WatchConnectivity] Session not activated")
            @unknown default:
                print("[WatchConnectivity] Unknown activation state")
            }
        }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {
        print("[WatchConnectivity] Session became inactive")
    }

    func sessionDidDeactivate(_ session: WCSession) {
        print("[WatchConnectivity] Session deactivated")
        // Reactivate session
        WCSession.default.activate()
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async {
            self.isWatchReachable = session.isReachable
            print(
                "[WatchConnectivity] Reachability changed: \(session.isReachable ? "reachable" : "not reachable")"
            )
        }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        print("[WatchConnectivity] Received message from Watch: \(message)")

        // Handle requests from Watch
        if message["request"] as? String == "syncAuth" {
            syncAuthToken()
        }
    }

    func session(
        _ session: WCSession,
        didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        print("[WatchConnectivity] Received message with reply handler: \(message)")

        // Handle sync request
        if message["request"] as? String == "syncAuth" {
            if let token = ServerConfigService.shared.getToken() {
                let apiUrl = ServerConfigService.shared.getAPIUrl()
                replyHandler([
                    "token": token,
                    "apiUrl": apiUrl,
                    "success": true,
                ])
            } else {
                replyHandler([
                    "success": false,
                    "error": "No token available",
                ])
            }
        }
    }
}
