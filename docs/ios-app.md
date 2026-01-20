# iOS/macOS App Documentation (RedSunsetMaple)

This guide covers the native Apple app, including architecture, native bridge, push notifications, and development setup.

## Overview

**RedSunsetMaple** is the native iOS/macOS app built with:

- **Language:** Swift 5.9+
- **UI:** WKWebView hosting the Angular web app
- **Minimum:** iOS 17.0+ / macOS 14.0+
- **Features:** Push notifications, Keychain storage, WhisperKit transcription

---

## Project Structure

```
apps/apple/
├── JapaneseMaple/                    # Main iOS app
│   ├── JapaneseMapleApp.swift        # App entry point
│   ├── WebViewController.swift        # WKWebView host
│   ├── NativeBridge.swift            # Bridge to web app
│   ├── ServerConfigService.swift     # Server management
│   ├── PushNotificationService.swift # APNs registration
│   ├── TranscriptionService.swift    # WhisperKit speech-to-text
│   ├── AudioRecorderService.swift    # Audio recording
│   ├── MultiTrackRecorder.swift      # Multi-track recording
│   ├── CustomSchemeHandler.swift     # Custom URL schemes
│   ├── WebApp/
│   │   └── offline.html              # Offline fallback
│   └── Assets.xcassets/              # App icons & assets
│
├── JapaneseMaple Watch/              # WatchOS app
│   └── WatchConnectivityService.swift
│
├── Shared/                           # Shared Swift code
│
├── JapaneseMaple.xcodeproj           # Xcode project
│
└── Documentation/                    # iOS-specific docs
    ├── ARCHITECTURE.md
    ├── BRIDGE_README.md
    ├── TYPESCRIPT_SDK.md
    ├── APNS_SETUP.md
    └── WHISPERKIT_SETUP.md
```

---

## Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         iOS Device                               │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                  JapaneseMaple App                          │ │
│  │                                                              │ │
│  │  ┌────────────────────────────────────────────────────────┐ │ │
│  │  │               WKWebView (SugarMaple)                   │ │ │
│  │  │                                                        │ │ │
│  │  │  ┌──────────────────────────────────────────────────┐ │ │ │
│  │  │  │              Native Bridge                        │ │ │ │
│  │  │  │  window.webkit.messageHandlers.maple              │ │ │ │
│  │  │  └──────────────────────────────────────────────────┘ │ │ │
│  │  └────────────────────────────────────────────────────────┘ │ │
│  │                              │                               │ │
│  │                              ▼                               │ │
│  │  ┌────────────────────────────────────────────────────────┐ │ │
│  │  │                   Native Services                       │ │ │
│  │  │  • ServerConfigService (server management)             │ │ │
│  │  │  • PushNotificationService (APNs)                      │ │ │
│  │  │  • TranscriptionService (WhisperKit)                   │ │ │
│  │  │  • Keychain (secure token storage)                     │ │ │
│  │  └────────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Development Setup

### Prerequisites

- macOS 14.0+ (Sonoma)
- Xcode 15.0+
- Apple Developer account
- iOS device or simulator

### Getting Started

1. **Open Xcode Project**

    ```bash
    open apps/apple/JapaneseMaple.xcodeproj
    ```

2. **Configure Signing**
    - Select the JapaneseMaple target
    - Go to Signing & Capabilities
    - Select your team
    - Configure bundle identifier

3. **Configure Capabilities**
    - Push Notifications
    - App Groups: `group.com.just.maple.JapaneseMaple`
    - Keychain Sharing: `group.com.just.maple.JapaneseMaple`

4. **Build and Run**
    - Select your target device/simulator
    - Press Cmd+R

### Development Server

For development, the app loads from `localhost:4200`:

```swift
// WebViewController.swift
#if DEBUG
let devUrl = URL(string: "http://localhost:4200")!
webView.load(URLRequest(url: devUrl))
#else
let prodUrl = URL(string: "https://justmaple.app")!
webView.load(URLRequest(url: prodUrl))
#endif
```

---

## Native Bridge

### Overview

The native bridge enables communication between the web app and native Swift code.

### Web → Native Communication

```javascript
// JavaScript side
window.webkit.messageHandlers.maple.postMessage({
    action: 'getToken',
    callbackId: 'uuid-123',
    payload: { serverId: 'server-1' },
});
```

### Native → Web Communication

```swift
// Swift side
webView.evaluateJavaScript("""
    window.maple_callback_\(callbackId)('\(token)');
""")
```

### Available Bridge Actions

| Action                  | Description                     | Payload                   |
| ----------------------- | ------------------------------- | ------------------------- |
| `getToken`              | Get auth token from Keychain    | `{ serverId }`            |
| `saveToken`             | Save auth token to Keychain     | `{ serverId, token }`     |
| `deleteToken`           | Delete auth token               | `{ serverId }`            |
| `getServers`            | Get saved servers list          | -                         |
| `saveServer`            | Save server config              | `{ id, name, url }`       |
| `deleteServer`          | Delete server config            | `{ id }`                  |
| `setActiveServer`       | Set active server               | `{ id }`                  |
| `getPlatform`           | Get platform (ios/macos)        | -                         |
| `getAppVersion`         | Get app version                 | -                         |
| `getPushToken`          | Get push notification token     | -                         |
| `requestPushPermission` | Request notification permission | -                         |
| `startRecording`        | Start audio recording           | `{ widgetId }`            |
| `stopRecording`         | Stop audio recording            | `{ widgetId }`            |
| `transcribeAudio`       | Transcribe audio file           | `{ audioPath, language }` |
| `openExternal`          | Open URL in browser             | `{ url }`                 |
| `copyToClipboard`       | Copy text to clipboard          | `{ text }`                |

### Bridge Implementation

```swift
// NativeBridge.swift
class NativeBridge: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard let body = message.body as? [String: Any],
              let action = body["action"] as? String,
              let callbackId = body["callbackId"] as? String
        else { return }

        let payload = body["payload"] as? [String: Any] ?? [:]

        Task {
            let result = await handleAction(action, payload: payload)
            await sendCallback(callbackId: callbackId, result: result)
        }
    }

    private func handleAction(_ action: String, payload: [String: Any]) async -> Any? {
        switch action {
        case "getToken":
            let serverId = payload["serverId"] as? String ?? ""
            return KeychainService.shared.getToken(for: serverId)

        case "saveToken":
            let serverId = payload["serverId"] as? String ?? ""
            let token = payload["token"] as? String ?? ""
            KeychainService.shared.saveToken(token, for: serverId)
            return ["success": true]

        case "getPlatform":
            #if os(iOS)
            return "ios"
            #else
            return "macos"
            #endif

        case "startRecording":
            let widgetId = payload["widgetId"] as? String ?? ""
            return await AudioRecorderService.shared.startRecording(widgetId: widgetId)

        case "transcribeAudio":
            let audioPath = payload["audioPath"] as? String ?? ""
            let language = payload["language"] as? String ?? "en"
            return await TranscriptionService.shared.transcribe(
                audioPath: audioPath,
                language: language
            )

        default:
            return ["error": "Unknown action: \(action)"]
        }
    }

    private func sendCallback(callbackId: String, result: Any?) async {
        guard let webView = webView else { return }

        let jsonData = try? JSONSerialization.data(withJSONObject: result ?? NSNull())
        let jsonString = String(data: jsonData ?? Data(), encoding: .utf8) ?? "null"

        await MainActor.run {
            webView.evaluateJavaScript("""
                if (window.maple_callback_\(callbackId)) {
                    window.maple_callback_\(callbackId)(\(jsonString));
                    delete window.maple_callback_\(callbackId);
                }
            """)
        }
    }
}
```

---

## Server Management

### Multi-Server Support

The app supports connecting to multiple servers:

```swift
// ServerConfigService.swift
struct ServerConfig: Codable {
    let id: String
    let name: String
    let url: String
    let iconUrl: String?
}

class ServerConfigService {
    static let shared = ServerConfigService()

    private let defaults = UserDefaults(suiteName: "group.com.just.maple.JapaneseMaple")!
    private let serversKey = "saved_servers"
    private let activeServerKey = "active_server"

    var servers: [ServerConfig] {
        get {
            guard let data = defaults.data(forKey: serversKey),
                  let servers = try? JSONDecoder().decode([ServerConfig].self, from: data)
            else { return [] }
            return servers
        }
        set {
            let data = try? JSONEncoder().encode(newValue)
            defaults.set(data, forKey: serversKey)
        }
    }

    var activeServerId: String? {
        get { defaults.string(forKey: activeServerKey) }
        set { defaults.set(newValue, forKey: activeServerKey) }
    }

    func addServer(_ server: ServerConfig) {
        var current = servers
        current.removeAll { $0.id == server.id }
        current.append(server)
        servers = current
    }

    func removeServer(id: String) {
        servers = servers.filter { $0.id != id }
        if activeServerId == id {
            activeServerId = servers.first?.id
        }
    }
}
```

---

## Push Notifications

### APNs Setup

1. **Create APNs Key** in Apple Developer Portal
2. **Configure in Xcode** - Add Push Notifications capability
3. **Configure Server** - Set APNs credentials in API

### Registration Flow

```swift
// PushNotificationService.swift
import UserNotifications

class PushNotificationService: NSObject, UNUserNotificationCenterDelegate {
    static let shared = PushNotificationService()

    func requestPermission() async -> Bool {
        let center = UNUserNotificationCenter.current()
        center.delegate = self

        do {
            let granted = try await center.requestAuthorization(
                options: [.alert, .badge, .sound]
            )
            if granted {
                await MainActor.run {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }
            return granted
        } catch {
            print("Push permission error: \(error)")
            return false
        }
    }

    func registerToken(_ deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        print("Device token: \(token)")

        // Store and send to server
        UserDefaults.standard.set(token, forKey: "push_token")

        Task {
            await sendTokenToServer(token)
        }
    }

    private func sendTokenToServer(_ token: String) async {
        guard let server = ServerConfigService.shared.activeServer,
              let authToken = KeychainService.shared.getToken(for: server.id)
        else { return }

        let url = URL(string: "\(server.url)/api/push/register")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body = [
            "token": token,
            "platform": "ios"
        ]
        request.httpBody = try? JSONEncoder().encode(body)

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            if let httpResponse = response as? HTTPURLResponse {
                print("Token registered: \(httpResponse.statusCode)")
            }
        } catch {
            print("Failed to register token: \(error)")
        }
    }
}
```

### Notification Service Extension

For rich notifications with media:

```swift
// NotificationService/NotificationService.swift
import UserNotifications

class NotificationService: UNNotificationServiceExtension {
    var contentHandler: ((UNNotificationContent) -> Void)?
    var bestAttemptContent: UNMutableNotificationContent?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        self.contentHandler = contentHandler
        bestAttemptContent = request.content.mutableCopy() as? UNMutableNotificationContent

        guard let content = bestAttemptContent,
              let data = request.content.userInfo["data"] as? [String: Any]
        else {
            contentHandler(request.content)
            return
        }

        Task {
            // Fetch enriched content from server
            if let enriched = await fetchEnrichedContent(data: data) {
                content.title = enriched.title
                content.body = enriched.body

                // Download and attach media
                if let imageUrl = enriched.imageUrl,
                   let attachment = await downloadAttachment(url: imageUrl) {
                    content.attachments = [attachment]
                }
            }

            contentHandler(content)
        }
    }

    override func serviceExtensionTimeWillExpire() {
        if let contentHandler = contentHandler,
           let content = bestAttemptContent {
            contentHandler(content)
        }
    }
}
```

---

## WhisperKit Integration

### Setup

```swift
// TranscriptionService.swift
import WhisperKit

class TranscriptionService {
    static let shared = TranscriptionService()

    private var whisperKit: WhisperKit?
    private var isLoaded = false

    func loadModel() async throws {
        guard !isLoaded else { return }

        whisperKit = try await WhisperKit(
            model: "base.en",
            computeUnits: .cpuAndNeuralEngine
        )
        isLoaded = true
    }

    func transcribe(audioPath: String, language: String = "en") async -> String? {
        guard let whisperKit = whisperKit else {
            print("WhisperKit not loaded")
            return nil
        }

        do {
            let results = try await whisperKit.transcribe(
                audioPath: audioPath,
                decodeOptions: DecodingOptions(
                    language: language,
                    task: .transcribe,
                    usePrefillPrompt: true
                )
            )
            return results.map { $0.text }.joined(separator: " ")
        } catch {
            print("Transcription error: \(error)")
            return nil
        }
    }
}
```

### Model Options

| Model       | Size   | Speed   | Quality            |
| ----------- | ------ | ------- | ------------------ |
| `tiny.en`   | ~75MB  | Fastest | Decent             |
| `base.en`   | ~140MB | Fast    | Good (recommended) |
| `small.en`  | ~460MB | Medium  | Better             |
| `medium.en` | ~1.5GB | Slow    | Very good          |
| `large-v3`  | ~3GB   | Slowest | Best, multilingual |

---

## Keychain Storage

### Secure Token Storage

```swift
// KeychainService.swift
import Security

class KeychainService {
    static let shared = KeychainService()

    private let accessGroup = "group.com.just.maple.JapaneseMaple"

    func saveToken(_ token: String, for serverId: String) {
        let key = "bearer_token:\(serverId)"
        let data = token.data(using: .utf8)!

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecAttrAccessGroup as String: accessGroup,
            kSecValueData as String: data
        ]

        // Delete existing
        SecItemDelete(query as CFDictionary)

        // Add new
        let status = SecItemAdd(query as CFDictionary, nil)
        if status != errSecSuccess {
            print("Keychain save error: \(status)")
        }
    }

    func getToken(for serverId: String) -> String? {
        let key = "bearer_token:\(serverId)"

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecAttrAccessGroup as String: accessGroup,
            kSecReturnData as String: true
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess,
              let data = result as? Data,
              let token = String(data: data, encoding: .utf8)
        else { return nil }

        return token
    }

    func deleteToken(for serverId: String) {
        let key = "bearer_token:\(serverId)"

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecAttrAccessGroup as String: accessGroup
        ]

        SecItemDelete(query as CFDictionary)
    }
}
```

---

## App Groups

### Shared Data

App Groups enable data sharing between the main app and extensions:

```swift
// Shared UserDefaults
let sharedDefaults = UserDefaults(suiteName: "group.com.just.maple.JapaneseMaple")

// Save
sharedDefaults?.set(servers, forKey: "saved_servers_shared")

// Read (from extension)
let servers = sharedDefaults?.data(forKey: "saved_servers_shared")
```

### Configuration

1. Enable App Groups capability in Xcode
2. Add group identifier: `group.com.just.maple.JapaneseMaple`
3. Add to both main app and extensions

---

## Building for Release

### Archive and Submit

1. **Update Version/Build**
    - Increment version in Xcode
    - Update build number

2. **Archive**

    ```
    Product > Archive
    ```

3. **Distribute**
    - Validate app
    - Upload to App Store Connect

### Build Configurations

| Config  | Use Case               |
| ------- | ---------------------- |
| Debug   | Development, localhost |
| Release | TestFlight, App Store  |

---

## Best Practices

### Swift Guidelines

- Use `async/await` for asynchronous code
- Use `@MainActor` for UI updates
- Use `Task` for launching async work
- Prefer `struct` over `class` when possible

### Memory Management

- Use `weak` references in delegates
- Avoid retain cycles in closures
- Clean up observers in `deinit`

### Security

- Store tokens in Keychain, not UserDefaults
- Use App Groups for extension sharing
- Validate server certificates
- Never log sensitive data

### Performance

- Load WhisperKit models lazily
- Use background queues for heavy work
- Cache frequently accessed data
- Minimize bridge calls

---

## Troubleshooting

### Common Issues

**Push Notifications Not Working**

1. Check APNs configuration in Xcode
2. Verify App Groups are configured
3. Check Keychain Sharing is enabled
4. Verify server has correct APNs credentials

**Bridge Calls Failing**

1. Check WebView is loaded
2. Verify JavaScript callback is registered
3. Check for Swift errors in console

**WhisperKit Crashes**

1. Ensure model is downloaded
2. Check device has enough memory
3. Use appropriate model size for device

---

## Next Steps

- [Deployment Guide](./deployment.md) - App Store submission
- [Testing Guide](./testing.md) - iOS testing
- [Best Practices](./best-practices.md) - Swift patterns
