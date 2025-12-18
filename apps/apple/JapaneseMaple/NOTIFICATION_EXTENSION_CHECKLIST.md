# Notification Service Extension Setup Checklist

Use this checklist to ensure your Notification Service Extension is properly configured.

## ✅ Xcode Configuration

### Extension Target

- [ ] Created Notification Service Extension target in Xcode
- [ ] Bundle identifier is `com.just.maple.JapaneseMaple.NotificationServiceExtension`
- [ ] Extension target includes `NotificationService.swift`
- [ ] Extension target includes `NotificationServiceExtension-Info.plist`
- [ ] Extension target includes `NotificationServiceExtension.entitlements`
- [ ] Extension deployment target matches main app (iOS 15.0+)

### Main App Target

- [ ] Main app has Push Notifications capability enabled
- [ ] Main app has App Groups capability with `group.com.just.maple.JapaneseMaple`
- [ ] Main app has Keychain Sharing with `group.com.just.maple.JapaneseMaple`
- [ ] Main app entitlements file configured correctly

### Extension Target Capabilities

- [ ] App Groups enabled with `group.com.just.maple.JapaneseMaple`
- [ ] Keychain Sharing enabled with `group.com.just.maple.JapaneseMaple`
- [ ] Entitlements file is properly linked

## ✅ Code Updates

### ServerConfigService.swift

- [ ] Updated to use shared UserDefaults suite
- [ ] Added `syncServersToSharedStorage()` method
- [ ] Updated `saveToken()` to include shared access group
- [ ] Updated `getToken()` to include shared access group
- [ ] Updated `clearToken()` to include shared access group
- [ ] Calls `syncServersToSharedStorage()` when servers are added/removed

### PushNotificationService.swift

- [ ] Updated `saveServerKeyMap()` to sync to shared storage
- [ ] Properly maps serverKey to serverId

### App Initialization

- [ ] Main app calls `ServerConfigService.shared.syncServersToSharedStorage()` on launch
- [ ] Server configurations are properly stored in shared container

## ✅ Apple Developer Account

### App IDs

- [ ] Main app ID exists: `com.just.maple.JapaneseMaple`
- [ ] Extension app ID exists: `com.just.maple.JapaneseMaple.NotificationServiceExtension`

### Capabilities

- [ ] Push Notifications enabled for main app ID
- [ ] App Groups configured for both app IDs with same group ID
- [ ] Keychain Sharing configured for both app IDs

### Provisioning Profiles

- [ ] Development profile created for main app
- [ ] Development profile created for extension
- [ ] Both profiles include Push Notifications capability
- [ ] Both profiles include App Groups
- [ ] Both profiles include Keychain Sharing

### APNs Keys

- [ ] APNs key created (or certificate if using legacy)
- [ ] Key ID saved
- [ ] Team ID noted
- [ ] .p8 key file downloaded and secured

## ✅ Server Configuration

### Push Notification Payload

- [ ] Server includes `"mutable-content": 1` in aps dictionary
- [ ] Server includes `notificationId` in payload
- [ ] Server includes `serverKey` in payload
- [ ] Server includes `type` field in payload
- [ ] Media URLs (if any) are HTTPS
- [ ] Payload is valid JSON

### API Endpoints

- [ ] `/api/notifications/register` endpoint exists (for device registration)
- [ ] `/api/notifications/unregister` endpoint exists (for unregistration)
- [ ] `/api/notifications/{id}` endpoint exists (optional, for enrichment)
- [ ] Endpoints require Bearer token authentication
- [ ] Endpoints return proper HTTP status codes

### APNs Integration

- [ ] Server can connect to APNs (sandbox or production)
- [ ] Server uses correct topic (bundle identifier)
- [ ] Server properly formats JWT tokens (if using token auth)
- [ ] Server handles APNs responses and errors

## ✅ Testing

### Device Setup

- [ ] Physical iOS device available (extension doesn't work in simulator)
- [ ] Device connected to Mac
- [ ] Device has network connectivity
- [ ] Device registered in Apple Developer account

### App Testing

- [ ] Build and run main app on device
- [ ] Login to server
- [ ] Register for push notifications
- [ ] Device token received and printed to console
- [ ] Device token saved to server
- [ ] No errors in Xcode console

### Extension Testing

- [ ] Extension target builds without errors
- [ ] Extension scheme created and activated
- [ ] Can debug extension by selecting it as host
- [ ] Console.app open on Mac (for viewing logs)
- [ ] Device filter applied in Console.app

### Notification Testing

- [ ] Send test notification from server
- [ ] Notification appears on device
- [ ] Check Console.app for extension logs
- [ ] Verify extension was triggered (look for "[NotificationService]" logs)
- [ ] Test notification with image attachment
- [ ] Test notification without mutable-content (should bypass extension)
- [ ] Test notification with badge update
- [ ] Test tapping notification opens app correctly

## ✅ Debugging

### If Extension Not Triggered

- [ ] Verified `mutable-content: 1` in payload
- [ ] Checked that notification was sent to correct device token
- [ ] Verified bundle ID matches APNs topic
- [ ] Checked that extension is included in build
- [ ] Confirmed extension target has no build errors

### If Media Not Attached

- [ ] Verified URL is accessible via browser
- [ ] Confirmed URL uses HTTPS
- [ ] Checked Console.app for download errors
- [ ] Verified file size is reasonable (<10MB for images)
- [ ] Tested with different image URLs

### If Shared Data Not Accessible

- [ ] Verified app groups match in both targets
- [ ] Checked that UserDefaults uses shared suite name
- [ ] Confirmed keychain access group is configured
- [ ] Verified entitlements files are correct
- [ ] Checked that data is being written to shared container

### If Token Not Found in Extension

- [ ] Verified keychain access group in main app
- [ ] Confirmed token is saved with access group
- [ ] Checked that extension has keychain capability
- [ ] Verified entitlements file includes keychain-access-groups
- [ ] Tested saving and retrieving token in main app first

## ✅ Production Deployment

### Pre-Release

- [ ] Test with TestFlight build
- [ ] Test on multiple iOS versions (15.0+)
- [ ] Test with different notification types
- [ ] Test with and without media attachments
- [ ] Test offline scenarios
- [ ] Test with expired or invalid tokens
- [ ] Verify extension respects 30-second time limit

### Release Build

- [ ] Extension included in archive
- [ ] Both targets signed with distribution certificates
- [ ] Both targets use production provisioning profiles
- [ ] App Groups properly configured in production profiles
- [ ] Push Notifications capability enabled in production
- [ ] Server configured to use production APNs endpoint

### Post-Release

- [ ] Monitor crash reports for extension
- [ ] Track notification delivery rates
- [ ] Monitor extension execution time
- [ ] Collect user feedback on notification experience
- [ ] Check APNs feedback service for invalid tokens

## 📝 Common Issues and Solutions

| Issue                                     | Solution                                             |
| ----------------------------------------- | ---------------------------------------------------- |
| Extension not triggered                   | Ensure `mutable-content: 1` is in payload            |
| Build error: "No such module"             | Verify extension target includes all required files  |
| Keychain access denied                    | Add keychain access group to both entitlements files |
| Shared data not accessible                | Ensure app group ID matches in both targets          |
| Media not displaying                      | Check URL is HTTPS and publicly accessible           |
| Extension crashes                         | Check Console.app logs for crash details             |
| Notification delivered without processing | Extension may have timed out (30s limit)             |

## 📚 Additional Resources

- [NOTIFICATION_SERVICE_EXTENSION_SETUP.md](./NOTIFICATION_SERVICE_EXTENSION_SETUP.md) - Detailed setup guide
- [SERVER_PUSH_NOTIFICATION_GUIDE.md](./SERVER_PUSH_NOTIFICATION_GUIDE.md) - Server payload documentation
- [test_push_notifications.sh](./test_push_notifications.sh) - Testing script
- [Apple's UNNotificationServiceExtension Docs](https://developer.apple.com/documentation/usernotifications/unnotificationserviceextension)
- [APNs Provider API](https://developer.apple.com/documentation/usernotifications/setting_up_a_remote_notification_server)

## ✨ Success Criteria

You'll know everything is working when:

- ✅ Extension logs appear in Console.app when notification arrives
- ✅ Media attachments display correctly in notifications
- ✅ Tapping notifications opens the app with correct data
- ✅ Extension processes notifications within time limit
- ✅ No crashes or errors in production

---

**Need Help?**

- Check Console.app logs for detailed error messages
- Enable breakpoints in extension for debugging
- Test with simple payloads first, then add complexity
- Verify each checklist item systematically
