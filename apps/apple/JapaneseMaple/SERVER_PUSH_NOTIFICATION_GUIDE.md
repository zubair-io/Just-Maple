# Server-Side Configuration for Notification Service Extension

## Overview

To fully support the Notification Service Extension, your server needs to send properly formatted push notification payloads. This document explains the required payload structure and optional enhancements.

## Required Payload Structure

### Basic Structure with Mutable Content

For the extension to be triggered, you **must** include `"mutable-content": 1` in the `aps` dictionary:

```json
{
    "aps": {
        "alert": {
            "title": "Notification Title",
            "body": "Notification body text"
        },
        "mutable-content": 1,
        "sound": "default",
        "badge": 1
    },
    "notificationId": "unique-notification-id",
    "serverKey": "user-server-key",
    "type": "message"
}
```

### Key Fields Explained

#### Required APNs Fields

- **`aps.alert.title`** - The notification title
- **`aps.alert.body`** - The notification body text
- **`aps.mutable-content`** - **MUST be 1** to trigger the extension
- **`aps.sound`** - Sound to play (usually "default")
- **`aps.badge`** - Badge count to display on app icon

#### Custom Fields for Extension

- **`notificationId`** - Unique identifier for the notification (used for fetching details from API)
- **`serverKey`** - The server key associated with the user (for multi-server support)
- **`type`** - Type of notification (e.g., "message", "mention", "follow", etc.)

## Media Attachments

### Image Attachments

Add an `imageUrl` field with a publicly accessible image URL:

```json
{
    "aps": {
        "alert": {
            "title": "New Photo",
            "body": "Someone shared a photo with you"
        },
        "mutable-content": 1,
        "sound": "default"
    },
    "notificationId": "photo-123",
    "serverKey": "abc-def-ghi",
    "type": "photo",
    "imageUrl": "https://example.com/photos/photo123.jpg"
}
```

**Supported formats:** jpg, png, gif

### Video Attachments

Add a `videoUrl` field:

```json
{
    "aps": {
        "alert": {
            "title": "New Video",
            "body": "Someone shared a video with you"
        },
        "mutable-content": 1,
        "sound": "default"
    },
    "notificationId": "video-123",
    "serverKey": "abc-def-ghi",
    "type": "video",
    "videoUrl": "https://example.com/videos/video123.mp4"
}
```

**Supported formats:** mp4, mov

### Audio Attachments

Add an `audioUrl` field:

```json
{
    "aps": {
        "alert": {
            "title": "New Voice Message",
            "body": "Someone sent you a voice message"
        },
        "mutable-content": 1,
        "sound": "default"
    },
    "notificationId": "audio-123",
    "serverKey": "abc-def-ghi",
    "type": "audio",
    "audioUrl": "https://example.com/audio/audio123.mp3"
}
```

**Supported formats:** mp3, wav

## Server-Side Enrichment

If your server needs to provide additional data that's not in the initial payload, the extension can fetch it from your API.

### Notification Details Endpoint

The extension will call: `GET /api/notifications/{notificationId}`

**Request Headers:**

```
Authorization: Bearer {user-auth-token}
```

**Response Format:**

```json
{
    "notificationId": "123",
    "title": "Updated Title",
    "body": "Updated body text with more details",
    "badge": 5,
    "data": {
        "additionalField1": "value1",
        "additionalField2": "value2"
    }
}
```

The extension will use this data to enrich the notification before displaying it to the user.

## Push Notification Categories and Actions

You can add custom actions to notifications using categories:

```json
{
    "aps": {
        "alert": {
            "title": "New Message",
            "body": "You have a new message from John"
        },
        "mutable-content": 1,
        "category": "MESSAGE_CATEGORY",
        "sound": "default"
    },
    "notificationId": "msg-123",
    "serverKey": "abc-def-ghi",
    "type": "message",
    "conversationId": "conv-456"
}
```

The iOS app would need to register these categories in the app delegate.

## Important Considerations

### 1. File Size Limits

- **Images**: Recommended max 10MB
- **Videos**: Recommended max 50MB
- **Audio**: Recommended max 5MB

### 2. Time Limits

- The extension has approximately **30 seconds** to process the notification
- If processing takes longer, iOS will deliver the original notification
- Keep media files reasonably sized for quick downloads

### 3. Security

- **HTTPS Required**: All media URLs must use HTTPS
- **Authentication**: For private content, use signed URLs with expiration
- **Validation**: Validate notification data on the server before sending

### 4. URL Accessibility

- Media URLs must be publicly accessible (or use signed URLs)
- The extension cannot access cookies or app-specific authentication
- Consider using temporary signed URLs for private content

## Example Payloads for Different Notification Types

### 1. Direct Message

```json
{
    "aps": {
        "alert": {
            "title": "John Doe",
            "body": "Hey, how are you?"
        },
        "mutable-content": 1,
        "sound": "default",
        "badge": 3
    },
    "notificationId": "dm-789",
    "serverKey": "user-server-key",
    "type": "direct_message",
    "conversationId": "conv-123",
    "senderId": "user-456",
    "imageUrl": "https://example.com/avatars/user456.jpg"
}
```

### 2. Mention in Post

```json
{
    "aps": {
        "alert": {
            "title": "Mentioned by Jane Smith",
            "body": "@you Check out this amazing photo!"
        },
        "mutable-content": 1,
        "sound": "default",
        "badge": 1
    },
    "notificationId": "mention-234",
    "serverKey": "user-server-key",
    "type": "mention",
    "postId": "post-567",
    "imageUrl": "https://example.com/posts/post567.jpg"
}
```

### 3. New Follower

```json
{
    "aps": {
        "alert": {
            "title": "New Follower",
            "body": "Alice started following you"
        },
        "mutable-content": 1,
        "sound": "default",
        "badge": 2
    },
    "notificationId": "follow-345",
    "serverKey": "user-server-key",
    "type": "follow",
    "followerId": "user-789",
    "imageUrl": "https://example.com/avatars/user789.jpg"
}
```

### 4. System Announcement

```json
{
    "aps": {
        "alert": {
            "title": "System Update",
            "body": "New features are now available!"
        },
        "mutable-content": 1,
        "sound": "default"
    },
    "notificationId": "sys-456",
    "serverKey": "user-server-key",
    "type": "announcement",
    "imageUrl": "https://example.com/announcements/banner.jpg"
}
```

## Testing Payloads

### Using curl with APNs HTTP/2 API

```bash
curl -v \
  --http2 \
  --header "authorization: bearer $JWT_TOKEN" \
  --header "apns-topic: com.just.maple.JapaneseMaple" \
  --header "apns-priority: 10" \
  --header "apns-push-type: alert" \
  --data '{
    "aps": {
      "alert": {
        "title": "Test Notification",
        "body": "This is a test"
      },
      "mutable-content": 1,
      "sound": "default"
    },
    "notificationId": "test-001",
    "serverKey": "test-key",
    "type": "test",
    "imageUrl": "https://picsum.photos/400/300"
  }' \
  "https://api.sandbox.push.apple.com:443/3/device/$DEVICE_TOKEN"
```

### Using the Provided Test Script

1. Get your APNs credentials:
    - Team ID from Apple Developer account
    - Key ID from APNs key
    - Download the .p8 auth key file

2. Get the device token from the app logs

3. Update and run the test script:
    ```bash
    chmod +x test_push_notifications.sh
    ./test_push_notifications.sh
    ```

## Server Implementation Example (Node.js)

```javascript
const apn = require('apn');

// Configure APNs provider
const provider = new apn.Provider({
    token: {
        key: fs.readFileSync('AuthKey_ABC123.p8'),
        keyId: 'ABC123',
        teamId: 'TEAM123',
    },
    production: false, // Set to true for production
});

// Send notification with image attachment
async function sendNotificationWithImage(deviceToken, serverKey, notificationData) {
    const notification = new apn.Notification();

    notification.topic = 'com.just.maple.JapaneseMaple';
    notification.alert = {
        title: notificationData.title,
        body: notificationData.body,
    };
    notification.sound = 'default';
    notification.badge = notificationData.badge;
    notification.mutableContent = 1; // Important!

    // Custom payload
    notification.payload = {
        notificationId: notificationData.id,
        serverKey: serverKey,
        type: notificationData.type,
        imageUrl: notificationData.imageUrl, // Optional
    };

    try {
        const result = await provider.send(notification, deviceToken);
        console.log('Notification sent:', result);
    } catch (error) {
        console.error('Error sending notification:', error);
    }
}
```

## Troubleshooting Server-Side Issues

### Extension Not Triggered

- ✅ Check that `"mutable-content": 1` is present
- ✅ Verify the payload is valid JSON
- ✅ Ensure you're using the correct topic (bundle ID)

### Media Not Displaying

- ✅ Verify URLs are accessible via HTTPS
- ✅ Check file sizes are within limits
- ✅ Ensure URLs don't require authentication
- ✅ Use signed URLs for private content

### Notification Details Not Fetched

- ✅ Verify the API endpoint is accessible
- ✅ Check that the auth token is valid
- ✅ Ensure the response format matches expectations

## Best Practices

1. **Always include `mutable-content: 1`** when you want the extension to process the notification
2. **Use HTTPS** for all media URLs
3. **Keep media files small** for fast downloads
4. **Include fallback content** in case extension fails
5. **Test with different payload types** before deploying
6. **Monitor extension execution time** to ensure it stays under 30 seconds
7. **Use signed URLs** for private content that expires after download
8. **Log all notification payloads** for debugging

## Next Steps

1. Update your server code to include `mutable-content: 1`
2. Test different payload types using the provided test script
3. Monitor Console.app logs to verify extension execution
4. Implement server-side enrichment endpoint if needed
5. Add support for custom notification categories and actions
