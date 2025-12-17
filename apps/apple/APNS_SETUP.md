# Apple Push Notifications (APNs) Setup Guide

This guide explains how to set up push notifications for the Just Maple iOS app using the Paperbark relay service.

## Architecture Overview

Just Maple uses a privacy-preserving push notification architecture:

1. **Maple API** - Your self-hosted server (e.g., `https://justmaple.app`)
2. **Paperbark Relay** - Push notification relay service (`https://paperbark.justmaple.app`)
3. **iOS App** - Native iOS application with WKWebView

### Privacy Design

- Paperbark never sees sensitive notification content
- Only generic fallback messages are sent through Paperbark
- iOS app fetches full content directly from user's Maple server
- Each server generates an opaque `serverKey` identifier

## Prerequisites

- Apple Developer Account (Team ID: `QREP66JW5U`)
- Xcode with iOS app configured
- Access to Paperbark server deployment

## Part 1: Apple Developer Portal Setup

### Step 1: Create APNs Authentication Key

1. Go to [Apple Developer Portal](https://developer.apple.com/account/)
2. Navigate to **Certificates, Identifiers & Profiles**
3. Select **Keys** from the sidebar
4. Click the **+** button to create a new key
5. Name it "Just Maple APNs Key"
6. Check **Apple Push Notifications service (APNs)**
7. Click **Continue** and then **Register**
8. Download the `.p8` key file (you can only download once!)
9. Note the **Key ID** (10-character string)

### Step 2: Configure App Identifier

1. In **Certificates, Identifiers & Profiles**, select **Identifiers**
2. Select your app ID: `com.just.maple.JapaneseMaple`
3. Ensure **Push Notifications** capability is enabled
4. If not enabled, check the box and click **Save**

## Part 2: Xcode Configuration

### Step 1: Add Push Notification Capability

1. Open `JapaneseMaple.xcodeproj` in Xcode
2. Select the **JapaneseMaple** target
3. Go to **Signing & Capabilities** tab
4. Click **+ Capability**
5. Add **Push Notifications**

### Step 2: Verify Entitlements

The `JapaneseMaple.entitlements` file should already include:

```xml
<key>com.apple.developer.associated-domains</key>
<array>
    <string>applinks:justmaple.app</string>
    <string>webcredentials:justmaple.app</string>
</array>
```

The `webcredentials` entry enables seamless push notification registration.

## Part 3: Paperbark Configuration

### Step 1: Set Environment Variables

On your Paperbark server deployment, configure these environment variables:

```bash
# APNs Configuration
APNS_KEY_ID=ABC123DEFG               # Your 10-character Key ID
APNS_TEAM_ID=QREP66JW5U             # Your Apple Team ID
APNS_BUNDLE_ID=com.just.maple.JapaneseMaple
APNS_KEY_PATH=/path/to/AuthKey_ABC123DEFG.p8
APNS_PRODUCTION=true                # Use production APNs (false for sandbox)

# API Security
PAPERBARK_API_KEY=your-secure-random-key-here  # Generate a strong random key

# Database
MONGODB_URI=mongodb://localhost:27017/paperbark
```

### Step 2: Upload APNs Key

Upload the `.p8` key file to your server at the path specified in `APNS_KEY_PATH`.

```bash
# Example: Copy key to server
scp AuthKey_ABC123DEFG.p8 user@paperbark.justmaple.app:/etc/paperbark/
```

Ensure the key file has restricted permissions:

```bash
chmod 600 /etc/paperbark/AuthKey_ABC123DEFG.p8
```

## Part 4: Maple API Configuration

### Set Environment Variables

On each Maple API instance that needs push notifications:

```bash
# Paperbark Configuration
PAPERBARK_URL=https://paperbark.justmaple.app
PAPERBARK_API_KEY=your-secure-random-key-here  # Same key as Paperbark server
```

The API will use these settings from `apps/api/src/config.ts`.

## Part 5: Testing Push Notifications

### Test Flow

1. **Launch the iOS app**
2. **Sign in with your account**
3. **Grant push notification permission** (the app should request this after login)
4. **Trigger a notification event** (e.g., share a tag with another user)

### Check Device Registration

Use the Maple API to check if the device is registered:

```bash
curl -X GET "https://justmaple.app/api/notifications/devices" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

Response:

```json
{
    "devices": [
        {
            "_id": "...",
            "userId": "...",
            "serverKey": "...",
            "platform": "ios",
            "registeredAt": "2025-12-17T...",
            "lastUsed": "2025-12-17T..."
        }
    ]
}
```

### Manually Send a Test Notification

```bash
curl -X POST "https://justmaple.app/api/notifications" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "share_received",
    "data": {
      "tagId": "test-tag-id",
      "sharedBy": "test-user-id",
      "tagLabel": "Test Folder"
    }
  }'
```

### Debug Logs

Check logs on each service:

**Paperbark:**

```bash
# Should see device registration
[Paperbark] Device registered: serverKey=...

# Should see push sent
[Paperbark] Push sent successfully: deviceToken=...
```

**Maple API:**

```bash
# Should see notification created
[Notification] Push sent successfully: notificationId=...
```

**iOS App:**

```bash
# In Xcode console
[PushNotificationService] Received device token: ...
[PushNotificationService] Successfully registered with Maple API
[AppDelegate] Notification tapped: share_received, id: ...
```

## Part 6: Production Checklist

- [ ] APNs key created and downloaded
- [ ] APNs key uploaded to Paperbark server with secure permissions
- [ ] Paperbark environment variables configured
- [ ] Maple API environment variables configured
- [ ] Push Notifications capability enabled in Xcode
- [ ] App built with production provisioning profile
- [ ] `APNS_PRODUCTION=true` on Paperbark server
- [ ] Test notification successfully delivered
- [ ] Notification tap navigation works correctly

## Troubleshooting

### No Device Token Received

**Symptom:** iOS app doesn't receive a device token.

**Solutions:**

1. Ensure Push Notifications capability is enabled in Xcode
2. Verify app is signed with a valid provisioning profile
3. Check that the bundle ID matches: `com.just.maple.JapaneseMaple`
4. Ensure running on physical device (push doesn't work in simulator)
5. Check Xcode console for error messages

### Device Token Received But Registration Fails

**Symptom:** Device token received but API registration fails.

**Solutions:**

1. Check that user is authenticated (JWT token exists)
2. Verify `PAPERBARK_URL` is correct in Maple API config
3. Check network connectivity to Maple API
4. Look for error logs in Xcode console

### Notification Not Delivered

**Symptom:** Notification created but not received on device.

**Solutions:**

1. Verify `PAPERBARK_API_KEY` matches between Maple API and Paperbark
2. Check Paperbark logs for errors
3. Verify APNs key is valid and uploaded correctly
4. Ensure `APNS_PRODUCTION` matches your app build (production vs sandbox)
5. Check device is not in Do Not Disturb mode
6. Verify app has notification permissions granted

### Notification Delivered But Content Missing

**Symptom:** Generic notification received but no detailed content.

**Solutions:**

1. Check that device can reach Maple API
2. Verify JWT token is still valid
3. Look for network errors in app logs
4. Check Maple API logs for notification fetch requests

## Architecture Diagram

```
┌─────────────────┐
│   iOS Device    │
│                 │
│  1. Registers   │
│     with APNs   │
└────────┬────────┘
         │
         │ Device Token
         ▼
┌─────────────────┐      ServerKey      ┌──────────────┐
│   Maple API     │◄──────────────────┤  iOS App     │
│ (Your Server)   │                     └──────────────┘
│                 │
│ 2. Saves        │
│    serverKey    │
└────────┬────────┘
         │
         │ 3. Event occurs
         │    (e.g., share)
         │
         │ 4. Sends generic
         │    push via Paperbark
         ▼
┌─────────────────┐
│    Paperbark    │
│  Relay Service  │
│                 │
│ 5. Forwards to  │
│    APNs         │
└────────┬────────┘
         │
         │ 6. Delivers
         │    notification
         ▼
┌─────────────────┐
│   iOS Device    │
│                 │
│ 7. Fetches full │
│    content from │
│    Maple API    │
└─────────────────┘
```

## Security Considerations

1. **API Key Security**: Keep `PAPERBARK_API_KEY` secret and rotate regularly
2. **APNs Key Security**: Restrict file permissions on `.p8` key file
3. **Server Keys**: Opaque identifiers prevent server identification
4. **End-to-End Content**: Sensitive data never passes through Paperbark
5. **Token Management**: JWT tokens stored securely in iOS Keychain

## Additional Resources

- [Apple Push Notification Service Documentation](https://developer.apple.com/documentation/usernotifications)
- [APNs Provider API](https://developer.apple.com/documentation/usernotifications/setting_up_a_remote_notification_server)
- [Just Maple Notification Design](../../maple-notifications-design.md)
