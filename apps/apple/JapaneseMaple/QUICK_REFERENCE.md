# Notification Service Extension - Quick Reference

## 🎯 Purpose
Modify push notifications before they're displayed to users. Supports media attachments, content enrichment, and server-side updates.

## ⚡ Quick Setup

### 1. Xcode (5 steps)
```
1. File → New → Target → Notification Service Extension
2. Add files to extension target
3. Enable App Groups: group.com.just.maple.JapaneseMaple
4. Enable Keychain Sharing: group.com.just.maple.JapaneseMaple
5. Build and test
```

### 2. Main App Init
```swift
@main
struct JapaneseMapleApp: App {
    init() {
        initializeNotificationExtensionSupport()
    }
}
```

### 3. Server Payload
```json
{
  "aps": {
    "alert": {"title": "Title", "body": "Body"},
    "mutable-content": 1,  // ← REQUIRED!
    "sound": "default"
  },
  "notificationId": "123",
  "serverKey": "abc",
  "type": "message",
  "imageUrl": "https://example.com/image.jpg"  // Optional
}
```

## 📋 Required Capabilities

### Main App Target
- ✅ Push Notifications
- ✅ App Groups: `group.com.just.maple.JapaneseMaple`
- ✅ Keychain Sharing: `group.com.just.maple.JapaneseMaple`

### Extension Target
- ✅ App Groups: `group.com.just.maple.JapaneseMaple`
- ✅ Keychain Sharing: `group.com.just.maple.JapaneseMaple`

## 🔑 Key Points

### Must Have
- `"mutable-content": 1` in push payload
- Physical iOS device (not simulator)
- HTTPS URLs for media
- Proper app group configuration

### Good to Know
- Extension has ~30 seconds to process
- Media should be <10MB
- Extension bypassed if app in foreground
- Use Console.app for debugging

## 📱 Media Attachments

### Image
```json
"imageUrl": "https://example.com/image.jpg"
```

### Video
```json
"videoUrl": "https://example.com/video.mp4"
```

### Audio
```json
"audioUrl": "https://example.com/audio.mp3"
```

## 🐛 Debug

### View Logs
```bash
# On Mac, open Console.app
# Filter: "NotificationService"
# Connect iOS device
# Send notification
```

### In-App Debug
```swift
#if DEBUG
NavigationLink("Extension Debug") {
    NotificationExtensionDebugView()
}
#endif
```

### Verify Setup
```swift
if PushNotificationService.shared.verifyExtensionAccess() {
    print("✅ Ready")
} else {
    print("❌ Check configuration")
}
```

## 🧪 Testing

### Script
```bash
# Configure test_push_notifications.sh
TEAM_ID="YOUR_TEAM_ID"
KEY_ID="YOUR_KEY_ID"
DEVICE_TOKEN="YOUR_DEVICE_TOKEN"

# Run
chmod +x test_push_notifications.sh
./test_push_notifications.sh
```

### Manual Test
```bash
curl --http2 \
  --header "authorization: bearer $JWT" \
  --header "apns-topic: com.just.maple.JapaneseMaple" \
  --data '{
    "aps": {
      "alert": {"title": "Test", "body": "Hello"},
      "mutable-content": 1
    }
  }' \
  "https://api.sandbox.push.apple.com:443/3/device/$TOKEN"
```

## ⚠️ Common Issues

| Problem | Fix |
|---------|-----|
| Extension not triggered | Add `"mutable-content": 1` |
| Can't access data | Check App Groups setup |
| Media not shown | Use HTTPS URLs |
| Crashes | Check Console.app logs |
| Token not found | Verify Keychain Sharing |

## 📊 Verification Checklist

```
□ Extension target created
□ Files added to target
□ App Groups enabled (both targets)
□ Keychain Sharing enabled (both targets)
□ Builds without errors
□ Server sends mutable-content: 1
□ Extension logs in Console.app
□ Media attachments display
□ Tapping notification works
□ Debug view shows green checkmarks
```

## 🔗 Full Documentation

- **Setup**: `NOTIFICATION_SERVICE_EXTENSION_SETUP.md`
- **Server**: `SERVER_PUSH_NOTIFICATION_GUIDE.md`
- **Checklist**: `NOTIFICATION_EXTENSION_CHECKLIST.md`
- **Summary**: `NOTIFICATION_EXTENSION_SUMMARY.md`
- **Helpers**: `AppInitialization+NotificationExtension.swift`

## 💾 Files Created

```
NotificationService.swift                    ← Main extension code
NotificationServiceExtension-Info.plist      ← Extension config
NotificationServiceExtension.entitlements    ← Capabilities
AppInitialization+NotificationExtension.swift ← Helper code
test_push_notifications.sh                   ← Test script
NOTIFICATION_SERVICE_EXTENSION_SETUP.md      ← Setup guide
SERVER_PUSH_NOTIFICATION_GUIDE.md            ← Server guide
NOTIFICATION_EXTENSION_CHECKLIST.md          ← Checklist
NOTIFICATION_EXTENSION_SUMMARY.md            ← Summary
QUICK_REFERENCE.md                           ← This file
```

## 🎓 Example Flow

```
1. Server sends notification with mutable-content: 1
   ↓
2. iOS delivers to device
   ↓
3. Extension wakes up (if app not in foreground)
   ↓
4. Extension processes notification:
   - Downloads media (if imageUrl/videoUrl/audioUrl present)
   - Fetches additional data (if notificationId present)
   - Enriches content
   ↓
5. iOS displays enriched notification
   ↓
6. User taps notification
   ↓
7. App opens with notification data
```

## 🚀 Production Checklist

```
□ Tested on physical device
□ Tested with TestFlight
□ Extension included in archive
□ Provisioning profiles updated
□ Server configured correctly
□ APNs production endpoint used
□ Monitoring enabled
□ Error handling tested
```

## 📞 When You Need Help

1. Check Console.app logs (search: "NotificationService")
2. Use debug view to verify data access
3. Review checklist for missed steps
4. Check payload format in server guide
5. Verify capabilities are enabled
6. Test with provided script

---

**🎉 You're all set!** Start with the setup guide and follow the checklist.
