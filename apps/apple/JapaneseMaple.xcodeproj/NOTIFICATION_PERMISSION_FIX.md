# Push Notification Permission Fix

## Problem Summary

In TestFlight (production), when users tap "Allow" on the system notification permission dialog, the native bridge was incorrectly returning a "permission denied" error message.

## Root Cause

The issue was a timing problem in the permission request flow:

1. User taps "Allow" on the system dialog
2. `requestPermissionsAndRegister()` gets permission approval
3. Code calls `registerForRemoteNotifications()` to get device token
4. **The async function returns immediately** without waiting for device token
5. In production, there can be a slight delay before the device token callback fires
6. The bridge's error handling was catching something and sending a premature "denied" response

## Changes Made

### 1. PushNotificationService.swift

**Added better error handling:**

- Wrapped authorization request in proper try-catch
- Added detailed logging for each step
- Added 30-second timeout mechanism in case device token never arrives
- Cancel timeout when token is received or registration fails
- Ensure completion handler is always called on main thread

**Key improvements:**

```swift
// Added timeout property
private var registrationTimeoutTask: Task<Void, Never>?

// Start timeout when waiting for device token
registrationTimeoutTask = Task { @MainActor [weak self] in
    try? await Task.sleep(nanoseconds: 30_000_000_000) // 30 seconds
    // Handle timeout...
}

// Cancel timeout when token arrives
registrationTimeoutTask?.cancel()
```

### 2. NativeBridge.swift

**Updated both iOS and macOS handlers:**

- Changed completion handler to use `DispatchQueue.main.async` for thread safety
- Added logging to distinguish between immediate permission denial vs waiting for token
- Improved error messages to show what's happening

**Key improvements:**

```swift
// If we get here without throwing, permission was granted
print("[Bridge] ✅ Permission granted, waiting for device token and API registration...")

// vs when it fails immediately
print("[Bridge] ❌ Permission request failed immediately: \(error)")
```

## How It Works Now

### Success Flow:

1. Web calls `requestPushPermission`
2. Bridge calls `PushNotificationService.requestPermissionsAndRegister()`
3. System shows permission dialog
4. User taps "Allow"
5. Permission granted → logs "✅ User granted notification permissions"
6. Call `registerForRemoteNotifications()` → logs "📱 Called registerForRemoteNotifications"
7. Start 30-second timeout timer
8. Wait for device token callback...
9. Device token arrives → `didReceiveDeviceToken()` called
10. Cancel timeout
11. Register with Maple API
12. Call completion handler with success
13. Bridge sends `pushPermissionResult` to web

### Denial Flow:

1. Web calls `requestPushPermission`
2. Bridge calls `PushNotificationService.requestPermissionsAndRegister()`
3. System shows permission dialog
4. User taps "Don't Allow"
5. Permission denied → throw `PushError.permissionDenied`
6. Bridge catches error immediately
7. Bridge sends `pushPermissionResult` with `granted: false`

### Timeout Flow (network issues):

1. Web calls `requestPushPermission`
2. User grants permission
3. `registerForRemoteNotifications()` called
4. Timeout timer starts (30 seconds)
5. Device token never arrives (poor network, etc.)
6. Timeout fires after 30 seconds
7. Call completion handler with `registrationTimeout` error
8. Bridge sends `pushPermissionResult` with error message

## Testing Checklist

- [ ] Test on device with notifications disabled → should get "denied" immediately
- [ ] Test on device with notifications allowed → should get success after token arrives
- [ ] Test in airplane mode → should get timeout error after 30 seconds
- [ ] Test in TestFlight → should work correctly (this was the main issue)
- [ ] Test switching servers → should re-register correctly
- [ ] Check console logs for clear flow tracking

## Logging Guide

Look for these log messages to understand what's happening:

- `✅ User granted notification permissions` - Permission dialog accepted
- `📱 Called registerForRemoteNotifications` - Waiting for device token
- `Received device token: [token]` - Token arrived from APNs
- `✅ Registration successful` - API registration completed
- `⏰ Device token timeout` - Token never arrived (30s timeout)
- `❌ Permission request failed immediately` - User denied permission

## Related Files

- `PushNotificationService.swift` - Handles permission and registration flow
- `NativeBridge.swift` - Bridges between web and native
- `JapaneseMapleApp.swift` - AppDelegate receives device token callbacks
- `Info.plist` - Must have proper entitlements and background modes

## Important Notes

1. **TestFlight vs Development**: Production APNs environment is different from development. The `isProductionEnvironment()` method automatically detects this.

2. **Thread Safety**: All completion handlers now run on main thread to avoid race conditions.

3. **Timeout Duration**: 30 seconds is generous but reasonable. Most devices get tokens in 1-3 seconds.

4. **Multiple Servers**: The service handles registration per-server. Each server gets its own registration state.

5. **Token Persistence**: Device token is saved to UserDefaults and reused if available.
