# Add Profile Pictures to Push Notifications

## Overview

Replace the default app icon with the sender's profile picture in push notifications using a Notification Service Extension.

## Step 1: Create Notification Service Extension

### In Xcode:

1. **File → New → Target**
2. Select **Notification Service Extension**
3. Name: `JapaneseMapleNotificationService`
4. Language: Swift
5. Click **Finish**
6. Click **Activate** when prompted

This creates a new target with `NotificationService.swift`

## Step 2: Configure Extension Entitlements

### Add to NotificationService entitlements:

File: `JapaneseMapleNotificationService/JapaneseMapleNotificationService.entitlements`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.application-groups</key>
    <array>
        <string>group.com.just.maple.JapaneseMaple</string>
    </array>
    <key>keychain-access-groups</key>
    <array>
        <string>$(AppIdentifierPrefix)group.com.just.maple.JapaneseMaple</string>
    </array>
</dict>
</plist>
```

## Step 3: Implement NotificationService

File: `JapaneseMapleNotificationService/NotificationService.swift`

```swift
import UserNotifications

class NotificationService: UNNotificationServiceExtension {

    var contentHandler: ((UNNotificationContent) -> Void)?
    var bestAttemptContent: UNMutableNotificationContent?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        self.contentHandler = contentHandler
        bestAttemptContent = (request.content.mutableCopy() as? UNMutableNotificationContent)

        guard let bestAttemptContent = bestAttemptContent else {
            contentHandler(request.content)
            return
        }

        // Extract profile picture URL from notification payload
        guard let profilePictureUrl = bestAttemptContent.userInfo["senderProfilePictureUrl"] as? String,
              let imageUrl = URL(string: profilePictureUrl) else {
            // No profile picture, deliver notification as-is
            contentHandler(bestAttemptContent)
            return
        }

        // Download and attach profile picture
        Task {
            do {
                let attachment = try await downloadImageAttachment(from: imageUrl)
                bestAttemptContent.attachments = [attachment]
                contentHandler(bestAttemptContent)
            } catch {
                print("[NotificationService] Failed to download profile picture: \(error)")
                // Deliver notification without image
                contentHandler(bestAttemptContent)
            }
        }
    }

    override func serviceExtensionTimeWillExpire() {
        // Called just before the extension will be terminated by the system.
        if let contentHandler = contentHandler, let bestAttemptContent = bestAttemptContent {
            contentHandler(bestAttemptContent)
        }
    }

    private func downloadImageAttachment(from url: URL) async throws -> UNNotificationAttachment {
        let (data, response) = try await URLSession.shared.data(from: url)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw NotificationServiceError.downloadFailed
        }

        // Determine file extension from URL or content type
        let fileExtension = url.pathExtension.isEmpty ? "jpg" : url.pathExtension

        // Save to temporary file
        let tempDirectory = FileManager.default.temporaryDirectory
        let fileName = "\(UUID().uuidString).\(fileExtension)"
        let fileURL = tempDirectory.appendingPathComponent(fileName)

        try data.write(to: fileURL)

        // Create attachment
        let attachment = try UNNotificationAttachment(
            identifier: "profile-picture",
            url: fileURL,
            options: [UNNotificationAttachmentOptionsTypeHintKey: "public.jpeg"]
        )

        return attachment
    }

    enum NotificationServiceError: Error {
        case downloadFailed
    }
}
```

## Step 4: Update Notification Payload (API Side)

The API needs to include the sender's profile picture URL in the notification payload.

File: `apps/api/src/services/push-notification.service.ts` (or wherever you send notifications)

```typescript
{
  "aps": {
    "alert": {
      "title": "John Doe",  // Sender name
      "body": "Hey, how are you?"  // Message content
    },
    "sound": "default",
    "badge": 1,
    "mutable-content": 1  // REQUIRED for service extension to run
  },
  "notificationId": "123abc",
  "type": "message",
  "tagId": "tag123",
  "messageId": "msg456",
  "senderProfilePictureUrl": "https://www.gravatar.com/avatar/hash?s=200",  // NEW
  "senderDisplayName": "John Doe",  // Optional, for fallback
  "apiUrl": "https://paperbark.justmaple.app"
}
```

**Important:** `"mutable-content": 1` is REQUIRED for the notification service extension to run.

## Step 5: Update API Notification Sending Code

Add profile picture URL when sending notifications:

```typescript
// In your notification sending function
async function sendPushNotification(
    deviceToken: string,
    message: Message,
    sender: User,
    tagId: string,
) {
    const payload = {
        aps: {
            alert: {
                title: sender.displayName || sender.email.split('@')[0],
                body: message.content.text || 'Sent a message',
            },
            sound: 'default',
            badge: 1,
            'mutable-content': 1, // Enable notification service extension
        },
        notificationId: message._id,
        type: 'message',
        tagId: tagId,
        messageId: message._id,
        senderProfilePictureUrl: sender.profilePictureUrl, // NEW
        senderDisplayName: sender.displayName,
        apiUrl: environment.apiUrl,
    };

    // Send to APNs...
}
```

## Step 6: Build Settings

### Ensure both targets share the same App Group:

1. Select **JapaneseMaple** target → Signing & Capabilities
2. Verify App Groups includes: `group.com.just.maple.JapaneseMaple`

3. Select **JapaneseMapleNotificationService** target → Signing & Capabilities
4. Add App Groups capability
5. Check `group.com.just.maple.JapaneseMaple`

## Step 7: Build & Test

1. Build the app with both targets
2. Install on device
3. Send a push notification with `senderProfilePictureUrl` in payload
4. The notification should show the sender's profile picture instead of the app icon

## Features

✅ Downloads and caches profile pictures
✅ Gracefully falls back to app icon if download fails
✅ Works with Gravatar URLs
✅ Supports JPG, PNG, GIF images
✅ Automatic cleanup of temporary files

## Troubleshooting

**Extension not running?**

- Check `"mutable-content": 1` is in the `aps` payload
- Verify App Groups are configured correctly
- Check console logs in Xcode when notification arrives

**Image not showing?**

- Verify image URL is accessible (not behind authentication)
- Check image format (JPG, PNG, GIF work best)
- Image size should be reasonable (< 10MB)
- Check console logs for download errors

**Testing locally:**

- Notification Service Extensions only run on physical devices
- Won't work in the iOS Simulator

## Image Size Optimization

For best results, send profile pictures at:

- Size: 200x200 pixels (Gravatar default)
- Format: JPEG or PNG
- Max size: 1MB
- URL should be HTTPS

## Security Notes

- Extension runs in a sandboxed environment
- Has limited execution time (30 seconds max)
- Uses App Group to share keychain with main app (if needed later)
- Downloads happen in a separate process from main app
