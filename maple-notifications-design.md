# Maple Push Notifications: Privacy-Preserving Design

**Status:** Draft  
**Author:** Zubair  
**Last Updated:** 2024-12-16

## Overview

This document describes the push notification architecture for Maple, a voice memo app that supports multiple server backends (justmaple.app hosted or self-hosted). The design prioritizes user privacy by ensuring the central relay service (Paperbark) never sees notification content or even server identities.

## Goals

- **Privacy-first:** Paperbark relay sees only routing metadata, never notification content or server names
- **Multi-server support:** Users can switch between justmaple.app or their own servers
- **Multi-device support:** Users can have multiple devices (iPhone, iPad) each receiving notifications
- **Graceful degradation:** Notifications work even when user's server is unreachable
- **Cross-platform:** Consistent behavior on iOS and Android
- **Server isolation:** Servers only see their own device registrations

## Non-Goals

- End-to-end encryption of the fallback content (acceptable tradeoff for UX)
- Supporting servers without HTTPS (security requirement)
- Offline-first notification queue (notifications require server connectivity)

---

## Architecture

```
┌──────────────────┐                    ┌─────────────────────────┐
│   Maple Server   │───── trigger ─────▶│ paperbark.justmaple.app │
│  (user-owned or  │   (serverKey +     │     (push relay)        │
│   justmaple.app) │    userId only)    └───────────┬─────────────┘
└────────┬─────────┘                                │
         │                                          │ APNs / FCM
         │                                          ▼
         │                                   ┌─────────────┐
         │                                   │  User Phone │
         │                                   └──────┬──────┘
         │                                          │
         │◀──────────── fetch full content ─────────┘
         │
    (notification content stays here)
```

### Trust Model

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Paperbark                                  │
│                                                                         │
│  (deviceId: D1, serverKey: SK1) → userId: zubair, token: T1, ios        │
│  (deviceId: D1, serverKey: SK2) → userId: zubair, token: T1, ios        │
│  (deviceId: D1, serverKey: SK3) → userId: zubair, token: T1, ios        │
│  (deviceId: D2, serverKey: SK4) → userId: zubair, token: T2, ios (iPad) │
│                                                                         │
│  Paperbark doesn't know: SK1=justmaple, SK2=homelab, SK3=worklab        │
│  Only the app knows the serverKey ↔ server mapping                      │
└─────────────────────────────────────────────────────────────────────────┘
```

The `serverKey` is the identity. Paperbark never knows server names/URLs — it only validates that the serverKey matches what the device registered.

---

## Component Specifications

### 1. Paperbark Relay Service

**Base URL:** `https://paperbark.justmaple.app`

#### 1.1 Device Registration

Devices register their push token with Paperbark, associating it with one or more serverKeys. Each serverKey creates a separate record internally. in the setting there is a notifcations button on native 

```
POST /api/v1/devices/register
Content-Type: application/json

{
  "deviceId": "device_iphone_xyz",
  "userId": "user_zubair",
  "platform": "ios" | "android",
  "pushToken": "apns_or_fcm_token",
  "serverKeys": ["sk_abc123", "sk_def456", "sk_ghi789"]
}

Response 200:
{
  "success": true,
  "registered": 3
}

Response 400:
{
  "success": false,
  "error": "invalid_payload" | "missing_required_field"
}
```

**Behavior:**
- Creates/updates one record per `(deviceId, serverKey)` pair
- All records share the same `userId`, `platform`, `pushToken`
- Idempotent — calling again with same data updates `updated_at`
- Can be called with a single serverKey or multiple

**Internal storage (3 separate records):**

| deviceId | userId | serverKeyHash | platform | pushToken |
|----------|--------|---------------|----------|-----------|
| device_iphone_xyz | user_zubair | hash(sk_abc123) | ios | T1 |
| device_iphone_xyz | user_zubair | hash(sk_def456) | ios | T1 |
| device_iphone_xyz | user_zubair | hash(sk_ghi789) | ios | T1 |

#### 1.2 Device Unregistration

Remove device registrations for specific serverKeys or all serverKeys.

```
DELETE /api/v1/devices/unregister
Content-Type: application/json

{
  "deviceId": "device_iphone_xyz",
  "serverKeys": ["sk_abc123"]  // Optional
}

Response 200:
{
  "success": true,
  "removed": 1
}
```

**Behavior:**
- If `serverKeys` provided: removes only those specific registrations
- If `serverKeys` omitted: removes ALL registrations for that deviceId (full logout)

#### 1.3 List Registrations

List all device registrations for a specific serverKey. Servers can only see their own registrations.

```
GET /api/v1/devices/list?serverKey=sk_abc123

Response 200:
{
  "registrations": [
    {
      "deviceId": "device_iphone_xyz",
      "userId": "user_zubair",
      "platform": "ios",
      "createdAt": "2024-12-16T10:30:00Z"
    },
    {
      "deviceId": "device_ipad_abc",
      "userId": "user_zubair",
      "platform": "ios",
      "createdAt": "2024-12-16T09:15:00Z"
    }
  ]
}
```

**Note:** Push tokens are NOT returned in list responses for security.

#### 1.4 Send Push Notification

Maple servers call this to trigger a push notification.

```
POST /api/v1/push/send
Content-Type: application/json

{
  "serverKey": "sk_abc123",
  "userId": "user_zubair",
  "notificationId": "notif_abc123",
  "fallback": {
    "title": "New voice memo",
    "body": "Open Maple to view"
  },
  "priority": "high" | "normal",
  "ttl": 3600
}

Response 200:
{
  "success": true,
  "delivered": 2,
  "messageIds": ["msg_xyz1", "msg_xyz2"]
}

Response 400:
{
  "success": false,
  "error": "invalid_server_key" | "invalid_payload" | "no_devices_found"
}
```

**Behavior:**
- Finds all records matching `(serverKey, userId)`
- Sends push to each device's pushToken
- Returns count of successful deliveries

#### 1.5 APNs Payload (iOS)

Paperbark constructs and sends:

```json
{
  "aps": {
    "mutable-content": 1,
    "alert": {
      "title": "{{fallback.title}}",
      "body": "{{fallback.body}}"
    },
    "sound": "default"
  },
  "maple": {
    "serverKey": "sk_abc123",
    "notificationId": "notif_abc123"
  }
}
```

#### 1.6 FCM Payload (Android)

```json
{
  "data": {
    "serverKey": "sk_abc123",
    "notificationId": "notif_abc123",
    "fallbackTitle": "New voice memo",
    "fallbackBody": "Open Maple to view"
  },
  "android": {
    "priority": "high"
  }
}
```

**Note:** Android uses data-only messages so the app always handles rendering.

---

### 2. Paperbark Database Schema

```sql
CREATE TABLE registrations (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(64) NOT NULL,
    server_key_hash VARCHAR(64) NOT NULL,
    platform VARCHAR(16) NOT NULL,
    push_token VARCHAR(256) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE (device_id, server_key_hash),
    INDEX idx_server_key_user (server_key_hash, user_id),  -- For push lookup
    INDEX idx_device_id (device_id)  -- For unregister all
);
```

**Notes:**
- `server_key_hash`: Store hashed, not plaintext (SHA-256)
- Composite unique constraint prevents duplicate registrations
- Index on `(server_key_hash, user_id)` for fast push lookups

---

### 3. Maple Server API

Each Maple server (hosted or self-hosted) must implement these endpoints.

#### 3.1 Register for Notifications

When the app connects to a server, it tells the server its deviceId and serverKey.

```
POST /api/v1/notifications/register
Authorization: Bearer {user_auth_token}

{
  "deviceId": "device_iphone_xyz",
  "serverKey": "sk_abc123"
}

Response 200:
{
  "success": true
}
```

The server stores this to know how to reach Paperbark for this user/device.

#### 3.2 Store Notification for Delivery

When a notification event occurs, the server stores the full content and calls Paperbark.

**Internal flow:**

```
1. Event occurs (e.g., transcription complete)
2. Server stores notification in database with full content
3. Server calls Paperbark POST /api/v1/push/send with:
   - serverKey (from device registration)
   - userId
   - notificationId
   - fallback (generic text)
4. Device receives push, fetches full content from server
5. Server optionally marks notification as delivered
```

#### 3.3 Fetch Notification Content

```
GET /api/v1/notifications/{notificationId}
Authorization: Bearer {device_auth_token}

Response 200:
{
  "id": "notif_abc123",
  "type": "transcription_complete" | "share_received" | "reminder" | ...,
  "title": "Transcription complete",
  "body": "Your voice memo 'Weekly standup notes' is ready to view",
  "data": {
    "memoId": "memo_xyz",
    "action": "open_memo"
  },
  "createdAt": "2024-12-16T10:30:00Z",
  "expiresAt": "2024-12-17T10:30:00Z"
}

Response 404:
{
  "error": "notification_not_found",
  "message": "Notification has expired or does not exist"
}

Response 401:
{
  "error": "unauthorized",
  "message": "Invalid or expired device token"
}
```

#### 3.4 Notification Types

| Type | Description | Data Fields |
|------|-------------|-------------|
| `transcription_complete` | Voice memo transcribed | `memoId` |
| `share_received` | Someone shared a memo | `memoId`, `sharedBy` |
| `reminder` | Scheduled reminder | `memoId`, `reminderTime` |
| `processing_failed` | Transcription failed | `memoId`, `errorCode` |
| `export_ready` | Export file ready | `exportId`, `format` |

#### 3.5 Notification Storage Schema (Maple Server)

```sql
CREATE TABLE notifications (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    type VARCHAR(32) NOT NULL,
    title VARCHAR(256) NOT NULL,
    body TEXT NOT NULL,
    data JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    fetched_at TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    INDEX idx_notifications_user_expires (user_id, expires_at)
);

CREATE TABLE device_registrations (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    device_id VARCHAR(64) NOT NULL,
    server_key VARCHAR(128) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE (user_id, device_id)
);
```

#### 3.6 Cleanup Job

Run periodically to purge expired notifications:

```sql
DELETE FROM notifications 
WHERE expires_at < NOW() 
   OR (fetched_at IS NOT NULL AND fetched_at < NOW() - INTERVAL '1 hour');
```

---

### 4. iOS Client Implementation

#### 4.1 App-Side Storage

```swift
struct ServerConnection: Codable {
    let serverUrl: String        // "https://homelab.zubair.dev"
    let serverKey: String        // "sk_abc123..."
    let userId: String           // "user_zubair"
    let authToken: String        // For API calls to this server
}

// Stored in Keychain via App Group (shared with extension)
// App knows: serverKey SK1 → homelab
// Paperbark doesn't know this mapping
```

#### 4.2 App-Side Flows

```swift
// MARK: - Push Token Refresh

func application(_ application: UIApplication,
                 didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    let token = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
    
    // Update Paperbark with all connected servers in one call
    let allServerKeys = ConnectedServers.all.map { $0.serverKey }
    
    Task {
        await PaperbarkClient.register(
            deviceId: DeviceIdentifier.current,
            userId: CurrentUser.id,
            platform: "ios",
            pushToken: token,
            serverKeys: allServerKeys
        )
    }
}

// MARK: - Connect New Server

func onConnectServer(_ server: MapleServer) async {
    let serverKey = generateSecureRandomKey()  // 32-byte random
    
    // 1. Register with Paperbark (just this new serverKey)
    await PaperbarkClient.register(
        deviceId: DeviceIdentifier.current,
        userId: CurrentUser.id,
        platform: "ios",
        pushToken: CurrentPushToken.value,
        serverKeys: [serverKey]
    )
    
    // 2. Tell the Maple server its key
    await server.api.registerForNotifications(
        deviceId: DeviceIdentifier.current,
        serverKey: serverKey
    )
    
    // 3. Store locally
    let connection = ServerConnection(
        serverUrl: server.url,
        serverKey: serverKey,
        userId: CurrentUser.id,
        authToken: server.authToken
    )
    ConnectedServers.save(connection)
}

// MARK: - Disconnect Server

func onDisconnectServer(_ server: ServerConnection) async {
    await PaperbarkClient.unregister(
        deviceId: DeviceIdentifier.current,
        serverKeys: [server.serverKey]
    )
    
    ConnectedServers.remove(server)
}

// MARK: - Full Logout

func onLogout() async {
    // Remove all registrations for this device
    await PaperbarkClient.unregister(
        deviceId: DeviceIdentifier.current
        // No serverKeys = remove all
    )
    
    ConnectedServers.removeAll()
}
```

#### 4.3 Notification Service Extension

Create a new target: `MapleNotificationService`

**App Groups:** Both main app and extension must share an App Group for Keychain access.

```
group.app.justmaple.maple
```

**NotificationService.swift:**

```swift
import UserNotifications

class NotificationService: UNNotificationServiceExtension {
    
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var bestAttemptContent: UNMutableNotificationContent?
    private var fetchTask: URLSessionDataTask?
    
    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        self.contentHandler = contentHandler
        bestAttemptContent = request.content.mutableCopy() as? UNMutableNotificationContent
        
        guard let content = bestAttemptContent,
              let mapleData = request.content.userInfo["maple"] as? [String: Any],
              let serverKey = mapleData["serverKey"] as? String,
              let notificationId = mapleData["notificationId"] as? String else {
            // No maple data, show fallback as-is
            contentHandler(request.content)
            return
        }
        
        // Look up server URL from serverKey
        guard let serverConnection = ConnectedServers.findByServerKey(serverKey) else {
            // Unknown serverKey, show fallback
            contentHandler(request.content)
            return
        }
        
        fetchNotificationContent(
            serverUrl: serverConnection.serverUrl,
            authToken: serverConnection.authToken,
            notificationId: notificationId,
            content: content,
            contentHandler: contentHandler
        )
    }
    
    private func fetchNotificationContent(
        serverUrl: String,
        authToken: String,
        notificationId: String,
        content: UNMutableNotificationContent,
        contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        guard let url = URL(string: "\(serverUrl)/api/v1/notifications/\(notificationId)") else {
            contentHandler(content)
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 25 // Leave buffer before iOS kills us at 30s
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        
        fetchTask = URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            defer { contentHandler(content) }
            
            guard let self = self,
                  error == nil,
                  let httpResponse = response as? HTTPURLResponse,
                  httpResponse.statusCode == 200,
                  let data = data else {
                // Fetch failed, fallback content already set
                return
            }
            
            do {
                let notification = try JSONDecoder().decode(MapleNotification.self, from: data)
                content.title = notification.title
                content.body = notification.body
                
                // Add deep link data
                content.userInfo["mapleAction"] = notification.data
                
                // Optional: group by memo
                if let memoId = notification.data?["memoId"] as? String {
                    content.threadIdentifier = memoId
                }
            } catch {
                // Decode failed, use fallback
            }
        }
        
        fetchTask?.resume()
    }
    
    override func serviceExtensionTimeWillExpire() {
        fetchTask?.cancel()
        if let contentHandler = contentHandler, let content = bestAttemptContent {
            contentHandler(content)
        }
    }
}
```

**MapleNotification.swift (Shared):**

```swift
struct MapleNotification: Codable {
    let id: String
    let type: String
    let title: String
    let body: String
    let data: [String: AnyCodable]?
    let createdAt: Date
    let expiresAt: Date
}
```

**KeychainHelper.swift (Shared):**

```swift
import Security

class KeychainHelper {
    
    private static let appGroup = "group.app.justmaple.maple"
    
    static func saveServerConnection(_ connection: ServerConnection) {
        let key = "server_\(connection.serverKey.hashValue)"
        let data = try! JSONEncoder().encode(connection)
        
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecAttrAccessGroup as String: appGroup,
            kSecValueData as String: data
        ]
        
        SecItemDelete(query as CFDictionary)
        SecItemAdd(query as CFDictionary, nil)
    }
    
    static func getServerConnection(forServerKey serverKey: String) -> ServerConnection? {
        let key = "server_\(serverKey.hashValue)"
        
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecAttrAccessGroup as String: appGroup,
            kSecReturnData as String: true
        ]
        
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        
        guard status == errSecSuccess,
              let data = result as? Data,
              let connection = try? JSONDecoder().decode(ServerConnection.self, from: data) else {
            return nil
        }
        
        return connection
    }
    
    static func getAllServerConnections() -> [ServerConnection] {
        // Implementation to list all server connections
        // Used for push token refresh
    }
    
    static func deleteServerConnection(forServerKey serverKey: String) {
        let key = "server_\(serverKey.hashValue)"
        
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecAttrAccessGroup as String: appGroup
        ]
        
        SecItemDelete(query as CFDictionary)
    }
}
```

---

### 5. Android Client Implementation

#### 5.1 FCM Service

**MapleFirebaseMessagingService.kt:**

```kotlin
class MapleFirebaseMessagingService : FirebaseMessagingService() {
    
    private val notificationManager by lazy {
        getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    }
    
    private val coroutineScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    
    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        val data = remoteMessage.data
        
        val serverKey = data["serverKey"] ?: return
        val notificationId = data["notificationId"] ?: return
        val fallbackTitle = data["fallbackTitle"] ?: "Maple"
        val fallbackBody = data["fallbackBody"] ?: "You have a new notification"
        
        // Look up server from serverKey
        val serverConnection = ServerConnectionStore.findByServerKey(this, serverKey)
        
        coroutineScope.launch {
            val notification = serverConnection?.let {
                fetchNotificationContent(it.serverUrl, it.authToken, notificationId)
            }
            
            val title = notification?.title ?: fallbackTitle
            val body = notification?.body ?: fallbackBody
            val notifData = notification?.data
            
            showNotification(
                id = notificationId.hashCode(),
                title = title,
                body = body,
                data = notifData
            )
        }
    }
    
    private suspend fun fetchNotificationContent(
        serverUrl: String,
        authToken: String,
        notificationId: String
    ): MapleNotification? {
        return try {
            withTimeout(25_000) {
                MapleApiClient.getNotification(serverUrl, notificationId, authToken)
            }
        } catch (e: Exception) {
            Log.w("MapleNotifications", "Failed to fetch notification content", e)
            null
        }
    }
    
    private fun showNotification(
        id: Int,
        title: String,
        body: String,
        data: Map<String, Any>?
    ) {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            data?.let { putExtra("mapleAction", JSONObject(it).toString()) }
        }
        
        val pendingIntent = PendingIntent.getActivity(
            this, id, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()
        
        notificationManager.notify(id, notification)
    }
    
    override fun onNewToken(token: String) {
        coroutineScope.launch {
            val connections = ServerConnectionStore.getAll(this@MapleFirebaseMessagingService)
            val serverKeys = connections.map { it.serverKey }
            
            if (serverKeys.isNotEmpty()) {
                PaperbarkClient.register(
                    deviceId = DeviceIdentifier.get(this@MapleFirebaseMessagingService),
                    userId = CurrentUser.id,
                    platform = "android",
                    pushToken = token,
                    serverKeys = serverKeys
                )
            }
        }
    }
    
    companion object {
        const val CHANNEL_ID = "maple_notifications"
    }
}
```

#### 5.2 Server Connection Storage

**ServerConnectionStore.kt:**

```kotlin
object ServerConnectionStore {
    
    private const val PREFS_NAME = "maple_server_connections"
    
    fun save(context: Context, connection: ServerConnection) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val json = Gson().toJson(connection)
        prefs.edit().putString(connection.serverKey, json).apply()
    }
    
    fun findByServerKey(context: Context, serverKey: String): ServerConnection? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val json = prefs.getString(serverKey, null) ?: return null
        return Gson().fromJson(json, ServerConnection::class.java)
    }
    
    fun getAll(context: Context): List<ServerConnection> {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.all.values.mapNotNull { value ->
            (value as? String)?.let { 
                Gson().fromJson(it, ServerConnection::class.java) 
            }
        }
    }
    
    fun delete(context: Context, serverKey: String) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().remove(serverKey).apply()
    }
    
    fun deleteAll(context: Context) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().clear().apply()
    }
}

data class ServerConnection(
    val serverUrl: String,
    val serverKey: String,
    val userId: String,
    val authToken: String
)
```

---

### 6. Security Considerations

#### 6.1 What Paperbark Knows vs Doesn't Know

| Data | Visible to Paperbark |
|------|---------------------|
| Device push tokens | ✅ Yes (required for APNs/FCM) |
| Device IDs | ✅ Yes (routing) |
| User IDs | ✅ Yes (routing) |
| Server Keys (hashed) | ✅ Yes (routing) |
| Notification timing | ✅ Yes (when pushes are sent) |
| Server names/URLs | ❌ No |
| Notification content | ❌ No (only generic fallback) |
| Which server is which | ❌ No (only app knows serverKey mapping) |

#### 6.2 Server Isolation

| Actor | Can see |
|-------|---------|
| homelab (sk_abc) | Only devices registered with sk_abc |
| worklab (sk_def) | Only devices registered with sk_def |
| justmaple.app (sk_ghi) | Only devices registered with sk_ghi |
| App | Knows all serverKeys (stored locally) |
| Paperbark | Sees all registrations, but doesn't know server identities |

#### 6.3 Threat Model

| Threat | Mitigation |
|--------|-----------|
| Paperbark compromised | Attacker sees only fallback text, device IDs, and opaque serverKeys |
| Forked app tries to send pushes | Doesn't have valid `serverKey` for any real device |
| Rogue server spams random deviceIds | `serverKey` won't match any registration |
| Server A impersonates Server B | Each server only knows its own serverKey |
| Man-in-the-middle | All connections require HTTPS |
| Replay attacks | Notification IDs are single-use, expire after fetch |
| User removes server | Registration deleted, pushes rejected |

#### 6.4 Server Key Generation

```swift
func generateSecureRandomKey() -> String {
    var bytes = [UInt8](repeating: 0, count: 32)
    _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    return "sk_" + bytes.map { String(format: "%02x", $0) }.joined()
}
```

---

### 7. Error Handling Matrix

| Scenario | Behavior |
|----------|----------|
| Paperbark unreachable | Server retries with exponential backoff (3 attempts) |
| Invalid serverKey | Paperbark returns 400, server logs error |
| No devices found for serverKey+userId | Paperbark returns success with `delivered: 0` |
| User's Maple server unreachable | Show fallback notification |
| Notification fetch timeout | Show fallback notification |
| Notification not found (404) | Show fallback notification |
| Unknown serverKey in push payload | Show fallback notification |
| Auth token expired | Show fallback, main app refreshes token on next open |
| Malformed notification response | Show fallback notification |

---

### 8. Testing Plan

#### 8.1 Unit Tests

- [ ] Paperbark registration with single serverKey
- [ ] Paperbark registration with multiple serverKeys
- [ ] Paperbark unregister specific serverKeys
- [ ] Paperbark unregister all (logout)
- [ ] List registrations by serverKey (isolation)
- [ ] Push to multiple devices
- [ ] Keychain read/write operations
- [ ] ServerKey ↔ Server URL mapping

#### 8.2 Integration Tests

- [ ] End-to-end push delivery (Paperbark → APNs → device)
- [ ] Notification content fetch success path
- [ ] Fallback behavior when server unreachable
- [ ] Token refresh updates all serverKeys
- [ ] Multi-device delivery (iPhone + iPad)
- [ ] Server isolation (Server A can't see Server B's devices)

#### 8.3 Manual Testing Scenarios

- [ ] Push while app is foregrounded
- [ ] Push while app is backgrounded
- [ ] Push while app is killed
- [ ] Push with airplane mode (fallback)
- [ ] Push to device with 3 servers connected
- [ ] Add new server, verify push works
- [ ] Remove server, verify pushes stop
- [ ] Full logout, verify all pushes stop
- [ ] Push token refresh mid-session

---

### 9. Implementation Phases

#### Phase 1: Paperbark Service
- [ ] Database schema setup
- [ ] POST /api/v1/devices/register (with array support)
- [ ] DELETE /api/v1/devices/unregister
- [ ] GET /api/v1/devices/list (by serverKey)
- [ ] POST /api/v1/push/send
- [ ] APNs integration
- [ ] FCM integration

#### Phase 2: iOS Client
- [ ] ServerConnection model and Keychain storage
- [ ] PaperbarkClient (register, unregister)
- [ ] ConnectedServers manager
- [ ] Notification Service Extension setup
- [ ] App Group keychain sharing
- [ ] Notification fetch logic with serverKey lookup
- [ ] Fallback handling
- [ ] Push token refresh flow

#### Phase 3: Android Client
- [ ] ServerConnection model and storage
- [ ] PaperbarkClient (register, unregister)
- [ ] Firebase Messaging Service
- [ ] Notification fetch logic with serverKey lookup
- [ ] Fallback handling
- [ ] Token refresh flow

#### Phase 4: Maple Server Updates
- [ ] Device registration table (deviceId, serverKey)
- [ ] Notification storage table
- [ ] POST /api/v1/notifications/register
- [ ] GET /api/v1/notifications/{id}
- [ ] Paperbark integration (call on notification events)
- [ ] Cleanup job for expired notifications

---

### 10. Open Questions

1. **Rate limiting:** Should Paperbark rate-limit per-serverKey to prevent abuse?

2. **Notification grouping:** Should we use thread identifiers to group notifications by memo?

3. **Rich notifications:** Do we want to support images/attachments in notifications? (Adds complexity to fetch flow)

4. **Analytics:** Should Paperbark track delivery success rates per serverKey for debugging?

5. **Expiry:** Should serverKey registrations expire if unused for N days?

---

### Appendix A: Fallback Message Guidelines

Keep fallbacks generic but useful:

| Notification Type | Fallback Title | Fallback Body |
|-------------------|----------------|---------------|
| `transcription_complete` | New voice memo | Your transcription is ready |
| `share_received` | Shared with you | Someone shared a memo with you |
| `reminder` | Maple Reminder | You have a reminder |
| `processing_failed` | Processing update | Open Maple for details |
| `export_ready` | Export ready | Your export is ready to download |

---

### Appendix B: API Summary

| Endpoint | Method | Called By | Purpose |
|----------|--------|-----------|---------|
| `/api/v1/devices/register` | POST | App | Register device with serverKey(s) |
| `/api/v1/devices/unregister` | DELETE | App | Remove registrations |
| `/api/v1/devices/list` | GET | Server | List devices for a serverKey |
| `/api/v1/push/send` | POST | Server | Trigger push notification |
