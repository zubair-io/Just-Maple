# Watch Authentication - Simplified Approach

## ✅ Direct Keychain Access (No Watch Connectivity Required!)

The Watch app now reads the JWT token **directly from the shared keychain** instead of requiring Watch Connectivity sync. This is simpler and more reliable!

## How It Works

```
┌─────────────────┐
│   iPhone App    │
│  (Login via     │
│   WebView)      │
└────────┬────────┘
         │
         │ Saves token to
         │ shared keychain
         ▼
┌──────────────────────────────────┐
│   Shared Keychain                │
│   group.com.just.maple.JapaneseMaple │
└────────┬─────────────────────────┘
         │
         │ Both apps can read/write
         ▼
┌─────────────────┐
│  Apple Watch    │
│  Reads token    │
│  directly!      │
└─────────────────┘
```

## Authentication Flow

1. **User logs in on iPhone** → Token saved to shared keychain
2. **User opens Watch app** → Reads token directly from keychain
3. **Authenticated!** → Watch can make API requests

No sync button needed. No Watch Connectivity required for auth. Just works! ✨

## What Changed

### Before (Complex)

- iPhone saves token to keychain
- iPhone sends token to Watch via Watch Connectivity
- Watch receives token in delegate callback
- Watch saves to keychain
- Watch is now authenticated

**Problem**: Watch Connectivity can be unreliable, requires iPhone to be reachable, "Request Sync" button didn't work reliably.

### After (Simple)

- iPhone saves token to keychain (done by existing code)
- Watch reads token directly from keychain
- Watch is authenticated

**Benefits**:

- ✅ Instant authentication (no waiting for sync)
- ✅ More reliable (no network dependency)
- ✅ Simpler code (no delegate callbacks needed)
- ✅ Works even when iPhone is off or out of range

## Watch Connectivity Still Used For...

While not needed for authentication, Watch Connectivity is still useful for:

1. **Logout sync**: iPhone can notify Watch when user logs out
2. **Server changes**: If user switches servers on iPhone
3. **Future features**: Real-time updates, complications, etc.

But the Watch app will work fine even if Watch Connectivity is unavailable!

## User Experience

### On Watch App Launch

**If authenticated:**

```
┌─────────────────────┐
│   Just Maple        │
├─────────────────────┤
│  📁 Work            │
│  📁 Personal        │
│  📁 Projects        │
└─────────────────────┘
```

**If not authenticated:**

```
┌─────────────────────┐
│   🔒                │
│   Not Authenticated │
│                     │
│ Please sign in on   │
│ the iPhone app      │
│                     │
│ [Check Again] ↻     │
│                     │
│ Token is shared     │
│ via Keychain        │
└─────────────────────┘
```

### After iPhone Login

User just needs to:

1. Log in on iPhone
2. Open Watch app (or tap "Check Again" if already open)
3. Watch immediately sees the token and authenticates

No sync button. No waiting. Just works!

## Code Changes

### AuthenticationManager.swift

**Key method:**

```swift
func checkAuthenticationStatus() {
    // Try to read token directly from shared keychain
    if let token = KeychainHelper.shared.getToken() {
        isAuthenticated = true
        apiUrl = "https://paperbark.justmaple.app"
        lastSyncDate = Date()
        print("[AuthManager] ✅ Token found in shared keychain")
    } else {
        isAuthenticated = false
        print("[AuthManager] ⚠️ No token found")
    }
}
```

Called:

- On app initialization
- When session activates
- When user taps "Check Again" button
- When phone becomes reachable (optional re-check)

### TagListView.swift

**Updated "not authenticated" view:**

```swift
Button {
    authManager.checkAuthenticationStatus()
} label: {
    Label("Check Again", systemImage: "arrow.clockwise")
}
.buttonStyle(.borderedProminent)

Text("Token is shared via Keychain")
    .font(.caption2)
    .foregroundColor(.secondary)
```

Simple refresh button that re-reads from keychain.

## Keychain Configuration

Both targets must have the **same App Group**:

### iPhone App Target

```
Signing & Capabilities → App Groups
✅ group.com.just.maple.JapaneseMaple
```

### Watch App Target

```
Signing & Capabilities → App Groups
✅ group.com.just.maple.JapaneseMaple
```

This allows both apps to access the same keychain items.

## Debugging

### Check if token is in keychain:

**On iPhone:**

```swift
if let token = ServerConfigService.shared.getToken() {
    print("iPhone has token: \(token.prefix(20))...")
}
```

**On Watch:**

```swift
if let token = KeychainHelper.shared.getToken() {
    print("Watch has token: \(token.prefix(20))...")
}
```

Both should print the same token (first 20 chars).

### If Watch doesn't see token:

1. **Verify App Groups capability** is enabled on Watch target
2. **Check group ID matches** exactly: `group.com.just.maple.JapaneseMaple`
3. **Regenerate provisioning profiles** if you just added the capability
4. **Clean build** and rebuild both targets

## Testing

1. **Delete Watch app** from simulator/device (clean slate)
2. **Log in on iPhone app** (save token to keychain)
3. **Install Watch app** from Xcode
4. **Launch Watch app** → Should immediately show tags (authenticated)
5. **Tap "Check Again"** if needed → Should authenticate within seconds

No "Request Sync" button needed. No waiting for iPhone to be reachable. Just instant authentication via shared keychain! 🎉

## Benefits Summary

| Aspect              | Before                     | After                      |
| ------------------- | -------------------------- | -------------------------- |
| **Complexity**      | High (Watch Connectivity)  | Low (Direct keychain)      |
| **Reliability**     | Medium (network dependent) | High (always works)        |
| **Speed**           | Slow (wait for sync)       | Instant (direct read)      |
| **Dependencies**    | iPhone must be reachable   | None                       |
| **Code**            | ~50 lines of sync logic    | ~10 lines to read keychain |
| **User Experience** | "Request Sync" button      | Just works automatically   |

## Migration Notes

Existing users who already have the Watch app installed:

- Will automatically benefit from this change
- No migration needed
- Old sync mechanism still works as fallback
- New approach is primary method

New users installing the Watch app:

- Will use direct keychain access only
- Simpler, faster, more reliable experience
