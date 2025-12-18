# Notification Service Extension Architecture

## 📐 System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Your Server                              │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  • User authentication                                      │ │
│  │  • Push notification sending (APNs)                        │ │
│  │  • API endpoints (/api/notifications/*)                    │ │
│  │  • Media hosting (images, videos, audio)                   │ │
│  └────────────────────────────────────────────────────────────┘ │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ↓ (Push via APNs)
┌─────────────────────────────────────────────────────────────────┐
│                     Apple Push Notification Service (APNs)       │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ↓ (Delivers notification)
┌─────────────────────────────────────────────────────────────────┐
│                         iOS Device                               │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              Notification Service Extension                 │ │
│  │  ┌──────────────────────────────────────────────────────┐  │ │
│  │  │  NotificationService.swift                            │  │ │
│  │  │  • Intercepts notification (if mutable-content: 1)   │  │ │
│  │  │  • Downloads media attachments                       │  │ │
│  │  │  • Fetches enriched data from server                 │  │ │
│  │  │  • Modifies notification content                     │  │ │
│  │  │  • ~30 second time limit                             │  │ │
│  │  └──────────────────────────────────────────────────────┘  │ │
│  │                                                               │ │
│  │  Access to:                                                  │ │
│  │  • Shared UserDefaults (App Groups)                         │ │
│  │  • Shared Keychain (Keychain Sharing)                       │ │
│  │  • Network requests                                          │ │
│  └────────────────────┬──────────────────────────────────────┘ │
│                       │                                          │
│                       ↓ (Delivers enriched notification)         │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    Notification Center                      │ │
│  │  • Displays notification with media                        │ │
│  │  • Handles user tap                                        │ │
│  └────────────────────┬──────────────────────────────────────┘ │
│                       │                                          │
│                       ↓ (User taps)                              │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                  JapaneseMaple App                          │ │
│  │  ┌──────────────────────────────────────────────────────┐  │ │
│  │  │  WebViewController                                    │  │ │
│  │  │  • Receives notification tap event                   │  │ │
│  │  │  • Extracts notificationId, type, serverKey          │  │ │
│  │  │  • Sends to web app via bridge                       │  │ │
│  │  └──────────────────────────────────────────────────────┘  │ │
│  │                                                               │ │
│  │  Services:                                                   │ │
│  │  • ServerConfigService (manages servers & tokens)           │ │
│  │  • PushNotificationService (device registration)            │ │
│  │  • NativeBridge (communication with web app)                │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## 🔄 Data Flow: Sending a Notification

```
1. Server → APNs
   POST https://api.push.apple.com/3/device/{token}
   {
     "aps": {
       "alert": {"title": "New Message", "body": "Hello!"},
       "mutable-content": 1,
       "sound": "default"
     },
     "notificationId": "msg-123",
     "serverKey": "abc-def",
     "imageUrl": "https://example.com/avatar.jpg"
   }

2. APNs → iOS Device
   Notification delivered to device

3. iOS → Notification Service Extension (if mutable-content: 1)
   Extension wakes up, receives notification

4. Extension → Server (optional)
   GET /api/notifications/msg-123
   Authorization: Bearer {token}

   Response: {
     "title": "John Doe",
     "body": "Hello! How are you?",
     "data": {...}
   }

5. Extension → Internet
   Downloads image from https://example.com/avatar.jpg

6. Extension → iOS
   Returns modified notification with:
   • Updated title/body (from server)
   • Attached media (downloaded image)

7. iOS → Notification Center
   Displays enriched notification

8. User taps → App launches
   App receives notification data via AppDelegate/SceneDelegate

9. App → WebViewController
   handleNotificationTap(notificationId: "msg-123", type: "message")

10. WebViewController → Web App (via bridge)
    Sends notification data to web app for handling
```

## 🗄️ Shared Data Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Shared Storage Layer                         │
│  (Accessible by both App and Extension)                         │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  App Groups: group.com.just.maple.JapaneseMaple            │ │
│  │  ┌──────────────────────────────────────────────────────┐  │ │
│  │  │  Shared UserDefaults                                  │  │ │
│  │  │  • push_server_key_map: [serverKey: serverId]        │  │ │
│  │  │  • saved_servers_shared: [ServerConfig]              │  │ │
│  │  │  • active_server: String                             │  │ │
│  │  └──────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Keychain Sharing: group.com.just.maple.JapaneseMaple      │ │
│  │  ┌──────────────────────────────────────────────────────┐  │ │
│  │  │  Shared Keychain                                      │  │ │
│  │  │  • bearer_token:{serverId}: String (auth tokens)     │  │ │
│  │  └──────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
         ↑                                      ↑
         │                                      │
    ┌────┴─────┐                          ┌────┴─────┐
    │   App    │                          │Extension │
    │  Writes  │                          │  Reads   │
    └──────────┘                          └──────────┘
```

## 🔐 Security & Privacy

```
┌─────────────────────────────────────────────────────────────────┐
│                    Security Boundaries                           │
│                                                                   │
│  Main App Process                                                │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  • Full access to keychain                               │   │
│  │  • Full access to user data                              │   │
│  │  • Full access to server APIs                            │   │
│  │  • Can write to shared storage                           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  Extension Process (Sandboxed)                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  • Read-only access to shared keychain                   │   │
│  │  • Read-only access to shared UserDefaults               │   │
│  │  • Limited network access (no cookies)                   │   │
│  │  • Time-limited execution (~30 seconds)                  │   │
│  │  • Cannot modify app data                                │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 📊 Process Lifecycle

```
Extension Lifecycle:
─────────────────────

1. Dormant
   └─ Extension not loaded in memory

2. Wake Up (when notification received with mutable-content: 1)
   └─ iOS loads extension into memory
   └─ Calls didReceive(_:withContentHandler:)

3. Processing (up to ~30 seconds)
   └─ Extension modifies notification
   └─ Downloads media
   └─ Fetches server data

4. Complete
   └─ Calls contentHandler with modified content
   └─ OR serviceExtensionTimeWillExpire() if timeout

5. Terminate
   └─ iOS unloads extension from memory
   └─ Returns to Dormant state
```

## 🌐 Multi-Server Architecture

```
Server Resolution Flow:
──────────────────────

Notification Payload:
{
  "serverKey": "abc-def-ghi-123"
}
         ↓
Extension reads from Shared UserDefaults:
push_server_key_map = {
  "abc-def-ghi-123": "server-id-456"
}
         ↓
Extension reads from Shared UserDefaults:
saved_servers_shared = [
  { id: "server-id-456", url: "https://server1.com", ... },
  { id: "server-id-789", url: "https://server2.com", ... }
]
         ↓
Extension finds matching server:
server = { id: "server-id-456", url: "https://server1.com" }
         ↓
Extension reads from Shared Keychain:
token = keychain["bearer_token:server-id-456"]
         ↓
Extension makes API request:
GET https://server1.com/api/notifications/123
Authorization: Bearer {token}
```

## 🎬 Complete Example Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                  User sends message in web app                   │
└───────────────────────────┬─────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│  Server creates notification and sends via APNs                 │
│  • Payload includes mutable-content: 1                          │
│  • Includes serverKey for multi-server support                  │
│  • Includes imageUrl for sender's avatar                        │
└───────────────────────────┬─────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│  APNs delivers to recipient's device                            │
└───────────────────────────┬─────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│  Extension wakes up (if app not in foreground)                  │
│  1. Reads serverKey from payload                                │
│  2. Looks up serverId from shared UserDefaults                  │
│  3. Gets server config from shared UserDefaults                 │
│  4. Gets auth token from shared keychain                        │
│  5. Downloads avatar image                                      │
│  6. Fetches full message details from server API                │
│  7. Creates notification attachment with avatar                 │
│  8. Updates notification title/body with enriched data          │
└───────────────────────────┬─────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│  iOS displays enriched notification                             │
│  • Shows sender's avatar as attachment                          │
│  • Shows full message content                                   │
│  • User sees rich notification                                  │
└───────────────────────────┬─────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│  User taps notification                                         │
└───────────────────────────┬─────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│  App launches and handles notification tap                      │
│  1. AppDelegate/SceneDelegate receives notification data        │
│  2. Posts notification to NotificationCenter                    │
│  3. WebViewController receives notification                     │
│  4. Extracts notificationId, type, serverKey, apiUrl            │
│  5. Sends to web app via NativeBridge                          │
│  6. Web app navigates to appropriate view                       │
└─────────────────────────────────────────────────────────────────┘
```

## 🔧 Configuration Matrix

```
What needs to be configured where:

┌────────────────────┬──────────┬───────────┬──────────┐
│      Feature       │ Main App │ Extension │  Server  │
├────────────────────┼──────────┼───────────┼──────────┤
│ Push Notifications │    ✓     │     -     │    ✓     │
│ App Groups         │    ✓     │     ✓     │    -     │
│ Keychain Sharing   │    ✓     │     ✓     │    -     │
│ Bundle ID          │    ✓     │     ✓     │    ✓     │
│ Provisioning       │    ✓     │     ✓     │    -     │
│ mutable-content: 1 │    -     │     -     │    ✓     │
│ Auth Token         │    ✓     │   (read)  │    ✓     │
│ Server Config      │    ✓     │   (read)  │    -     │
│ Device Token       │    ✓     │     -     │    ✓     │
└────────────────────┴──────────┴───────────┴──────────┘
```

---

This architecture ensures secure, efficient notification processing while maintaining proper separation of concerns and data access controls.
