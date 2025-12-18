//
//  AppInitialization+NotificationExtension.swift
//  JapaneseMaple
//
//  Extension-related initialization code
//  Add this to your main app initialization
//

import Foundation
import SwiftUI

// MARK: - App Launch Initialization
// Add this code to your main app's initialization (e.g., in JapaneseMapleApp.swift)

/*
 Example integration in your app:
 
 @main
 struct JapaneseMapleApp: App {
     
     init() {
         // Initialize services for notification extension support
         initializeNotificationExtensionSupport()
     }
     
     var body: some Scene {
         WindowGroup {
             ContentView()
         }
     }
 }
*/

/// Initialize shared data for notification extension access
func initializeNotificationExtensionSupport() {
    print("[AppInit] Initializing notification extension support")
    
    // 1. Sync server configurations to shared storage
    ServerConfigService.shared.syncServersToSharedStorage()
    print("[AppInit] ✅ Synced server configurations")
    
    // 2. Ensure tokens are accessible via shared keychain
    // This is automatic if using ServerConfigService.saveToken()
    // which already includes the shared access group
    
    // 3. Sync server key mapping to shared storage
    // This happens automatically in PushNotificationService.saveServerKeyMap()
    
    print("[AppInit] ✅ Notification extension support initialized")
}

// MARK: - Login Flow Integration
// Add this after successful login

extension ServerConfigService {
    /// Call this after successful login to ensure extension can access data
    func syncAfterLogin(token: String, serverId: String) {
        // Save token with shared keychain access
        let success = saveToken(token, serverId: serverId)
        if success {
            print("[Login] ✅ Token saved to shared keychain")
        } else {
            print("[Login] ❌ Failed to save token to shared keychain")
        }
        
        // Sync server configuration
        syncServersToSharedStorage()
        print("[Login] ✅ Server config synced to shared storage")
    }
}

// MARK: - Push Notification Registration Integration
// Add this after push notification registration

extension PushNotificationService {
    /// Verify shared data is accessible after registration
    func verifyExtensionAccess() -> Bool {
        // Check if server key map is in shared storage
        guard let sharedDefaults = UserDefaults(suiteName: "group.com.just.maple.JapaneseMaple"),
              let serverKeyMapData = sharedDefaults.data(forKey: "push_server_key_map"),
              let serverKeyMap = try? JSONDecoder().decode([String: String].self, from: serverKeyMapData) else {
            print("[PushService] ⚠️ Server key map not accessible in shared storage")
            return false
        }
        
        print("[PushService] ✅ Server key map accessible: \(serverKeyMap.count) entries")
        
        // Check if server configurations are in shared storage
        guard let savedServersData = sharedDefaults.data(forKey: "saved_servers_shared"),
              let servers = try? JSONDecoder().decode([ServerConfigService.ServerConfig].self, from: savedServersData) else {
            print("[PushService] ⚠️ Server configurations not accessible in shared storage")
            return false
        }
        
        print("[PushService] ✅ Server configurations accessible: \(servers.count) servers")
        
        // Check if auth token is in shared keychain
        let activeServer = ServerConfigService.shared.getActiveServer()
        guard let token = ServerConfigService.shared.getToken(serverId: activeServer.id) else {
            print("[PushService] ⚠️ Auth token not accessible in shared keychain")
            return false
        }
        
        print("[PushService] ✅ Auth token accessible for server: \(activeServer.name)")
        
        return true
    }
}

// MARK: - Example Usage in SwiftUI View

#if DEBUG
struct NotificationExtensionDebugView: View {
    @State private var isDataAccessible = false
    @State private var debugInfo: [String] = []
    
    var body: some View {
        List {
            Section("Extension Data Access") {
                HStack {
                    Text("Status")
                    Spacer()
                    Image(systemName: isDataAccessible ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .foregroundColor(isDataAccessible ? .green : .red)
                }
                
                Button("Verify Extension Access") {
                    verifyAccess()
                }
            }
            
            Section("Debug Info") {
                ForEach(debugInfo, id: \.self) { info in
                    Text(info)
                        .font(.system(.caption, design: .monospaced))
                }
            }
            
            Section("Actions") {
                Button("Re-sync All Data") {
                    resyncData()
                }
                
                Button("Clear Shared Data") {
                    clearSharedData()
                }
            }
        }
        .navigationTitle("Extension Debug")
        .onAppear {
            verifyAccess()
        }
    }
    
    private func verifyAccess() {
        debugInfo.removeAll()
        
        // Check shared UserDefaults
        if let sharedDefaults = UserDefaults(suiteName: "group.com.just.maple.JapaneseMaple") {
            debugInfo.append("✅ Shared UserDefaults accessible")
            
            // Check server key map
            if let serverKeyMapData = sharedDefaults.data(forKey: "push_server_key_map"),
               let serverKeyMap = try? JSONDecoder().decode([String: String].self, from: serverKeyMapData) {
                debugInfo.append("✅ Server key map: \(serverKeyMap.count) entries")
            } else {
                debugInfo.append("❌ Server key map not found")
            }
            
            // Check server configurations
            if let savedServersData = sharedDefaults.data(forKey: "saved_servers_shared"),
               let servers = try? JSONDecoder().decode([ServerConfigService.ServerConfig].self, from: savedServersData) {
                debugInfo.append("✅ Server configs: \(servers.count) servers")
            } else {
                debugInfo.append("❌ Server configs not found")
            }
        } else {
            debugInfo.append("❌ Shared UserDefaults not accessible")
        }
        
        // Check shared keychain
        let activeServer = ServerConfigService.shared.getActiveServer()
        if let token = ServerConfigService.shared.getToken(serverId: activeServer.id) {
            debugInfo.append("✅ Auth token accessible (\(token.prefix(10))...)")
        } else {
            debugInfo.append("❌ Auth token not found")
        }
        
        // Overall status
        isDataAccessible = PushNotificationService.shared.verifyExtensionAccess()
    }
    
    private func resyncData() {
        ServerConfigService.shared.syncServersToSharedStorage()
        
        // Re-save server key map
        if let serverKey = PushNotificationService.shared.getServerKey(),
           let serverId = PushNotificationService.shared.getServerId(for: serverKey) {
            var map: [String: String] = [serverKey: serverId]
            if let data = try? JSONEncoder().encode(map) {
                UserDefaults(suiteName: "group.com.just.maple.JapaneseMaple")?.set(data, forKey: "push_server_key_map")
            }
        }
        
        debugInfo.append("🔄 Re-synced all data")
        verifyAccess()
    }
    
    private func clearSharedData() {
        if let sharedDefaults = UserDefaults(suiteName: "group.com.just.maple.JapaneseMaple") {
            sharedDefaults.removeObject(forKey: "push_server_key_map")
            sharedDefaults.removeObject(forKey: "saved_servers_shared")
            debugInfo.append("🗑️ Cleared shared data")
        }
        verifyAccess()
    }
}
#endif

// MARK: - Testing Helpers

#if DEBUG
extension NotificationService {
    /// Test function to verify extension can access shared data
    static func testSharedDataAccess() -> [String: Any] {
        var results: [String: Any] = [:]
        
        // Test shared UserDefaults
        if let sharedDefaults = UserDefaults(suiteName: "group.com.just.maple.JapaneseMaple") {
            results["sharedUserDefaults"] = true
            
            // Test server key map
            if let serverKeyMapData = sharedDefaults.data(forKey: "push_server_key_map"),
               let serverKeyMap = try? JSONDecoder().decode([String: String].self, from: serverKeyMapData) {
                results["serverKeyMap"] = serverKeyMap
            }
            
            // Test server configurations
            if let savedServersData = sharedDefaults.data(forKey: "saved_servers_shared"),
               let servers = try? JSONDecoder().decode([ServerConfigService.ServerConfig].self, from: savedServersData) {
                results["serverConfigs"] = servers.count
            }
        } else {
            results["sharedUserDefaults"] = false
        }
        
        return results
    }
}
#endif

// MARK: - Documentation

/*
 USAGE INSTRUCTIONS:
 
 1. In your main app's @main struct, call initializeNotificationExtensionSupport():
 
    @main
    struct JapaneseMapleApp: App {
        init() {
            initializeNotificationExtensionSupport()
        }
        
        var body: some Scene {
            WindowGroup {
                ContentView()
            }
        }
    }
 
 2. After successful login, sync the token:
 
    ServerConfigService.shared.syncAfterLogin(token: authToken, serverId: currentServerId)
 
 3. After push notification registration, verify extension access:
 
    if PushNotificationService.shared.verifyExtensionAccess() {
        print("✅ Extension can access shared data")
    } else {
        print("❌ Extension cannot access shared data - check configuration")
    }
 
 4. In DEBUG builds, add the NotificationExtensionDebugView to your settings:
 
    NavigationLink("Extension Debug") {
        NotificationExtensionDebugView()
    }
 
 This will help you verify that the extension can access all necessary data.
*/
