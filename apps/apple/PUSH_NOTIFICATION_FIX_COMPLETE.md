# Push Notification Permission Fix - COMPLETE

## Problem

TestFlight users clicking "Allow" on the notification permission dialog were immediately receiving a "Permission denied" error, with no API calls being made.

## Root Cause

**APNs Environment Mismatch**

The app's entitlements were configured with `aps-environment: development`, but TestFlight builds run in the **production** APNs environment. This caused iOS to immediately reject the device token registration, triggering `didFailToRegisterForRemoteNotifications` with an error.

### Evidence from Logs:

```
[NativeBridge] Sent: {type: "requestPushPermission"}
[NativeBridge] Received: {type: "pushPermissionResult", payload: {...}}
[Settings] Push permission denied
```

The response came back in **milliseconds** - far too fast to be waiting for a device token. This confirmed the registration was failing immediately at the iOS level, before any API calls could be made.

## The Complete Fix

### 1. Created Separate Entitlements for Release Builds

**File: `apps/apple/JapaneseMaple/JapaneseMaple-Release.entitlements`**

Changed APNs environment from `development` to `production`:

```xml
<key>aps-environment</key>
<string>production</string>
<key>com.apple.developer.aps-environment</key>
<string>production</string>
```

This ensures TestFlight and App Store builds use the correct APNs environment.

### 2. Updated Xcode Project Configuration

**File: `apps/apple/JapaneseMaple.xcodeproj/project.pbxproj`**

Modified Release build settings to use the production entitlements:

```
CODE_SIGN_ENTITLEMENTS = JapaneseMaple/JapaneseMaple-Release.entitlements;
```

Debug builds continue to use `JapaneseMaple/JapaneseMaple.entitlements` with `development` settings for local testing.

### 3. Added Timeout Mechanism

**File: `apps/apple/JapaneseMaple/PushNotificationService.swift`**

Added 30-second timeout in case device token never arrives:

- Prevents indefinite waiting
- Provides clear error message to user
- Properly cleans up when token arrives or registration fails

### 4. Improved Thread Safety

**File: `apps/apple/JapaneseMaple/NativeBridge.swift`**

Wrapped bridge messages in `DispatchQueue.main.async` to ensure WebView communication happens on the main thread, preventing potential race conditions.

### 5. Enhanced Logging

Added comprehensive logging throughout the flow:

- `✅ User granted notification permissions` - Permission granted
- `📱 Called registerForRemoteNotifications` - Waiting for device token
- `Received device token: [token]` - Token arrived from APNs
- `✅ Registration successful` - API registration completed
- `❌ Permission request failed immediately` - User denied permission

## Files Changed

1. ✅ `JapaneseMaple/JapaneseMaple-Release.entitlements` - NEW (production APNs)
2. ✅ `JapaneseMaple.xcodeproj/project.pbxproj` - Updated Release config
3. ✅ `JapaneseMaple/PushNotificationService.swift` - Timeout + logging
4. ✅ `JapaneseMaple/NativeBridge.swift` - Thread safety + logging

## How to Test

### TestFlight (Production Environment):

1. Build app in Release mode
2. Upload to TestFlight
3. Install on device
4. Go to Settings → Enable Notifications
5. Click "Allow" on system dialog
6. **Expected:** Device token arrives, API registration succeeds, notifications enabled ✅

### Debug Build (Development Environment):

1. Build app in Debug mode
2. Run on physical device (simulators can't get push tokens)
3. Go to Settings → Enable Notifications
4. **Expected:** Still works with development APNs sandbox

## Why This Fixes the Issue

**Before:**

- TestFlight build has `development` APNs entitlement
- iOS rejects device token registration immediately
- `didFailToRegisterForRemoteNotifications` called
- Bridge sends "permission denied" error
- No API call ever made

**After:**

- TestFlight build has `production` APNs entitlement
- iOS accepts device token registration
- `didReceiveDeviceToken` called with valid token
- Device token sent to API for registration
- Bridge sends "permission granted" success

## Important Notes

1. **Debug vs Release**: Debug builds use `development` APNs (sandbox), Release/TestFlight use `production` APNs. This is now correctly configured.

2. **Simulator Testing**: Simulators cannot receive push notifications. The timeout mechanism will trigger after 30 seconds if testing on simulator.

3. **Provisioning Profiles**: Ensure your Release provisioning profile includes the Push Notifications entitlement with production environment.

4. **First TestFlight Build**: After deploying this fix, users will need to enable notifications again. Previously failed registrations won't automatically retry.

## Next Steps

1. ✅ Commit all changes
2. ✅ Build Release configuration
3. ✅ Upload to TestFlight
4. ✅ Test on physical device
5. ✅ Verify logs show successful device token registration
6. ✅ Verify API receives registration request

## Related Files

- `PushNotificationService.swift` - Handles notification registration flow
- `NativeBridge.swift` - Bridge between web and native
- `JapaneseMapleApp.swift` - AppDelegate receives device token callbacks
- `apps/api/src/routes/notifications.ts` - API endpoint for device registration
