# Notification Service Extension Setup Guide

## Overview
The Notification Service Extension allows your app to modify push notifications before they are displayed to the user. This enables features like:
- Downloading and attaching media (images, videos, audio)
- Enriching notification content from your server
- Decrypting notification payloads
- Updating badge counts and notification content dynamically

## Files Created
- **NotificationService.swift** - Main extension code
- **NotificationServiceExtension-Info.plist** - Extension configuration
- **NotificationServiceExtension.entitlements** - Shared access configuration

## Xcode Integration Steps

### 1. Add the Notification Service Extension Target
1. In Xcode, go to **File → New → Target**
2. Select **Notification Service Extension** (under iOS)
3. Click **Next**
4. Enter the following details:
   - **Product Name**: `NotificationServiceExtension`
   - **Team**: Select your development team
   - **Bundle Identifier**: `com.just.maple.JapaneseMaple.NotificationServiceExtension`
5. Click **Finish**
6. When prompted "Activate NotificationServiceExtension scheme?", click **Activate**

### 2. Replace the Generated Files
1. Delete the auto-generated `NotificationService.swift` in the new extension folder
2. Add the `NotificationService.swift` file from this repository to the extension target
3. Replace the auto-generated `Info.plist` with `NotificationServiceExtension-Info.plist`
4. Add the `NotificationServiceExtension.entitlements` file to the extension target

### 3. Configure the Extension Target
1. Select your project in the Navigator
2. Select the **NotificationServiceExtension** target
3. Go to **Signing & Capabilities**
4. Enable **App Groups**:
   - Click **+ Capability** → **App Groups**
   - Add group: `group.com.just.maple.JapaneseMaple`
5. Enable **Keychain Sharing**:
   - Click **+ Capability** → **Keychain Sharing**
   - Add keychain group: `group.com.just.maple.JapaneseMaple`
6. Set the entitlements file to `NotificationServiceExtension.entitlements`

### 4. Update Main App Configuration
You also need to enable shared access in your main app target:

1. Select the **JapaneseMaple** target
2. Go to **Signing & Capabilities**
3. Enable **App Groups** (if not already enabled):
   - Click **+ Capability** → **App Groups**
   - Add group: `group.com.just.maple.JapaneseMaple`
4. Enable **Keychain Sharing** (if not already enabled):
   - Click **+ Capability** → **Keychain Sharing**
   - Add keychain group: `group.com.just.maple.JapaneseMaple`

### 5. Update ServerConfigService to Use Shared Storage
Update `ServerConfigService.swift` to save server configurations to shared UserDefaults:

```swift
// In ServerConfigService.swift, update the userDefaults initialization:
private let userDefaults = UserDefaults(suiteName: "group.com.just.maple.JapaneseMaple") ?? UserDefaults.standard
```

And add this method to sync server configs to shared storage:

```swift
// Add this method to ServerConfigService
func syncServersToSharedStorage() {
    let servers = getServers()
    if let data = try? JSONEncoder().encode(servers) {
        UserDefaults(suiteName: "group.com.just.maple.JapaneseMaple")?.set(data, forKey: "saved_servers_shared")
    }
}
```

Call `syncServersToSharedStorage()` whenever servers are added, removed, or updated.

### 6. Update Keychain Access for Shared Access
Update `ServerConfigService.swift` to enable shared keychain access:

```swift
// In the saveToken method, add the access group:
let addQuery: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: keychainService,
    kSecAttrAccount as String: account,
    kSecValueData as String: data,
    kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
    kSecAttrAccessGroup as String: "group.com.just.maple.JapaneseMaple" // Add this line
]

// Also update the getToken and clearToken queries similarly
```

### 7. Configure Push Notification Payload
For the extension to be triggered, your server must send push notifications with the `mutable-content` flag:

```json
{
  "aps": {
    "alert": {
      "title": "New Message",
      "body": "You have a new message"
    },
    "mutable-content": 1,  // This triggers the extension
    "sound": "default",
    "badge": 1
  },
  "notificationId": "123",
  "serverKey": "abc-def-ghi",
  "type": "message",
  "imageUrl": "https://example.com/image.jpg"  // Optional: will be downloaded and attached
}
```

## Features

### 1. Media Attachments
The extension automatically downloads and attaches media if these fields are present:
- `imageUrl` - Downloads and attaches images (jpg, png, gif)
- `videoUrl` - Downloads and attaches videos (mp4, mov)
- `audioUrl` - Downloads and attaches audio (mp3, wav)

### 2. Server-Side Enrichment
If `notificationId` and `serverKey` are present, the extension will:
1. Look up the server configuration
2. Fetch full notification details from your API
3. Update title, body, badge, and additional data
4. Deliver the enriched notification

### 3. Time Limit
The extension has approximately 30 seconds to process the notification. After that, iOS will deliver the original notification content. The extension handles this gracefully with the `serviceExtensionTimeWillExpire()` method.

## Testing

### 1. Test in Simulator or Device
1. Build and run the main app
2. Enable push notifications
3. Send a test notification with `mutable-content: 1`
4. The extension should process the notification

### 2. Debug the Extension
1. Run the main app first
2. In Xcode, select the **NotificationServiceExtension** scheme
3. Click **Run**
4. Select "JapaneseMaple" as the host app
5. Send a notification
6. Xcode will attach the debugger to the extension process

### 3. View Logs
Use Console.app to view extension logs:
1. Open **Console.app** on Mac
2. Connect your iOS device
3. Filter for "NotificationService"
4. Send a notification and observe the logs

## Important Notes

1. **Bundle Identifier**: The extension's bundle identifier must be a child of the main app:
   - Main app: `com.just.maple.JapaneseMaple`
   - Extension: `com.just.maple.JapaneseMaple.NotificationServiceExtension`

2. **Provisioning**: You'll need to create a new provisioning profile for the extension target in your Apple Developer account.

3. **App Groups**: Both targets must use the same app group identifier.

4. **Keychain Sharing**: Both targets must share the same keychain access group.

5. **Server Payload**: Your server MUST include `"mutable-content": 1` in the `aps` dictionary for the extension to be triggered.

## Troubleshooting

### Extension Not Triggered
- Verify `mutable-content: 1` is in the push payload
- Check that the extension target is included in your build
- Verify app groups and keychain sharing are configured correctly

### Cannot Access Shared Data
- Ensure both targets have the same app group configured
- Verify the entitlements file is correctly set
- Check that data is being saved to the shared container

### Media Not Attached
- Verify the URL is accessible
- Check Console.app logs for download errors
- Ensure file extensions are correct

### Token Not Found
- Verify keychain access group is configured in both targets
- Check that tokens are being saved with the shared access group
- Ensure the entitlements file includes keychain-access-groups

## Next Steps

Consider enhancing the extension with:
- End-to-end encryption support
- Notification grouping and threading
- Custom notification categories and actions
- Analytics tracking
- Notification history persistence
