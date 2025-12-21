# Watch App Push Notifications

Documentation for implementing real-time message updates on Apple Watch using push notifications.

## Overview

The Watch app receives push notifications when new messages are sent and:

- **App Open on Tag**: Automatically refreshes the message list
- **App Closed**: Opens the app and navigates to the tag with messages loaded

## Server-Side Implementation

### Push Notification Payload

When a new message is sent, the server should send a push notification with the following payload:

```json
{
    "aps": {
        "alert": {
            "title": "John Doe",
            "body": "Hey, check this out..."
        },
        "sound": "default",
        "badge": 1,
        "category": "NEW_MESSAGE",
        "thread-id": "tag_abc123"
    },
    "tagId": "tag_abc123",
    "messageId": "msg_xyz789",
    "senderName": "John Doe",
    "senderEmail": "john@example.com"
}
```

### Payload Fields

| Field             | Type   | Required | Description                                 |
| ----------------- | ------ | -------- | ------------------------------------------- |
| `aps.alert.title` | string | Yes      | Sender's display name                       |
| `aps.alert.body`  | string | Yes      | Message preview (plain text)                |
| `aps.sound`       | string | No       | Notification sound (default: "default")     |
| `aps.badge`       | number | No       | App badge count                             |
| `aps.category`    | string | Yes      | Must be "NEW_MESSAGE"                       |
| `aps.thread-id`   | string | Yes      | Tag ID for grouping notifications           |
| `tagId`           | string | Yes      | Tag ID where message was sent               |
| `messageId`       | string | Yes      | Message ID for deduplication                |
| `senderName`      | string | No       | Sender's display name (fallback in payload) |
| `senderEmail`     | string | No       | Sender's email                              |

### Server-Side Code Example

```javascript
// Example using APNs (Node.js)
import apn from 'apn';

async function sendMessageNotification(message, tag, recipients) {
    const notification = new apn.Notification();

    // Alert configuration
    notification.alert = {
        title: message.senderDisplayName || message.senderEmail,
        body: extractPlainText(message.content), // First 100 chars
    };

    // Sound and badge
    notification.sound = 'default';
    notification.badge = await getUnreadCount(recipients);

    // Category for grouping
    notification.topic = 'com.just.maple.JapaneseMaple.watchkitapp';
    notification.category = 'NEW_MESSAGE';
    notification.threadId = tag._id;

    // Custom payload
    notification.payload = {
        tagId: tag._id,
        messageId: message._id,
        senderName: message.senderDisplayName,
        senderEmail: message.senderEmail,
    };

    // Send to all tag members
    for (const recipient of recipients) {
        const deviceTokens = await getDeviceTokens(recipient.userId);
        await apnProvider.send(notification, deviceTokens);
    }
}
```

## Watch App Behavior

### When App is Open on the Tag

1. **Notification arrives** → `NotificationManager.handleNotification()` called
2. **Posts local notification** → `NotificationCenter.default.post(name: "NewMessageReceived")`
3. **MessageListViewModel receives** → Checks if `tagId` matches current tag
4. **Auto-refresh** → Calls `refresh()` to load new messages
5. **User sees** → New message appears in list automatically

```
Server Push → Watch Receives → MessageList Refreshes → UI Updates
```

### When App is Closed

1. **Notification arrives** → Banner shown to user
2. **User taps banner** → `NotificationManager.handleNotificationTap()` called
3. **Sets navigation state** → `selectedTagId` and `shouldOpenMessage`
4. **App opens** → `TagListView` detects change
5. **Navigates to tag** → Finds tag and pushes to `navigationPath`
6. **MessageListView opens** → Loads messages for that tag

```
Server Push → User Taps → App Opens → Navigates to Tag → Loads Messages
```

## Device Token Management

### Watch App Registration

The Watch app registers for push notifications on launch:

```swift
// In Just_Maple_WatchApp.swift
.task {
    _ = await notificationManager.requestAuthorization()
}
```

When authorized, watchOS calls:

```swift
func didRegisterForRemoteNotifications(withDeviceToken deviceToken: Data) {
    let tokenString = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
    // Send tokenString to server
    await APIClient.shared.registerDeviceToken(tokenString, platform: "watchos")
}
```

### Server Storage

Store device tokens in your database:

```typescript
{
  userId: "user_123",
  deviceTokens: [
    {
      token: "abc123...",
      platform: "ios",
      createdAt: "2025-01-15T10:00:00Z"
    },
    {
      token: "def456...",
      platform: "watchos",
      createdAt: "2025-01-15T10:00:00Z"
    }
  ]
}
```

## Notification Categories (Future Enhancement)

For interactive notifications, you can add actions:

```json
{
    "aps": {
        "category": "NEW_MESSAGE"
        // ... other fields
    }
}
```

Define categories on Watch:

```swift
// In NotificationManager
let replyAction = UNTextInputNotificationAction(
    identifier: "REPLY_ACTION",
    title: "Reply",
    options: []
)

let category = UNNotificationCategory(
    identifier: "NEW_MESSAGE",
    actions: [replyAction],
    intentIdentifiers: []
)

UNUserNotificationCenter.current().setNotificationCategories([category])
```

Users can then reply directly from the notification banner.

## Testing

### Using Xcode Simulator

1. **Get device token**: Check Xcode console when app launches
2. **Send test notification** using a tool like Knuff or Pusher
3. **Test foreground**: Open app to tag → Send notification → Verify refresh
4. **Test background**: Close app → Send notification → Tap → Verify navigation

### Example Test Payload

```json
{
    "aps": {
        "alert": {
            "title": "Test User",
            "body": "This is a test message"
        },
        "sound": "default",
        "category": "NEW_MESSAGE",
        "thread-id": "tag_test123"
    },
    "tagId": "tag_test123",
    "messageId": "msg_test456"
}
```

## Troubleshooting

### Notifications Not Appearing

1. **Check permissions**: Settings → Just Maple → Notifications
2. **Verify device token**: Console should show token registration
3. **Check payload**: Ensure `thread-id` matches `tagId`
4. **Test with simulator**: Use Xcode's notification simulator

### Auto-Refresh Not Working

1. **Check logs**: Look for `[MessageList] 📬 Received notification`
2. **Verify tagId**: Must match exactly (case-sensitive)
3. **Ensure app is foreground**: Background refresh has different behavior

### Deep Link Not Opening Tag

1. **Check logs**: Look for `[TagListView] 📱 Deep link to tag`
2. **Verify tag exists**: Tag must be loaded in `viewModel.tags`
3. **Check navigation state**: `shouldOpenMessage` must be `true`

## Production Checklist

- [ ] Store device tokens securely in database
- [ ] Handle token refresh (tokens can change)
- [ ] Remove expired/invalid tokens
- [ ] Send notifications to all tag members
- [ ] Respect user notification preferences
- [ ] Handle notification errors (rate limits, invalid tokens)
- [ ] Test with real devices (simulators have limitations)
- [ ] Monitor APNs feedback service
- [ ] Implement badge count updates
- [ ] Add notification categories for quick actions

## Security Considerations

- Device tokens are sensitive - store securely
- Validate message access before sending notifications
- Don't include sensitive content in notification body
- Use APNs certificate with restricted permissions
- Implement server-side rate limiting
- Log notification sends for audit trail

## References

- [Apple Push Notification Service (APNs)](https://developer.apple.com/documentation/usernotifications)
- [watchOS Notifications](https://developer.apple.com/documentation/watchos-apps/keeping-your-watchos-content-up-to-date)
- [UNUserNotificationCenter](https://developer.apple.com/documentation/usernotifications/unusernotificationcenter)
