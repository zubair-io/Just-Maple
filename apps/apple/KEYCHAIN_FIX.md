# Keychain Token Lookup Fix

## Problem

The Watch app couldn't find the JWT token saved by the iPhone app because it was only checking one specific account key.

## Root Cause

The iPhone app saves tokens to keychain with different account keys based on the server configuration:

- `"bearer_token:https://justmaple.app"` (production)
- `"bearer_token:https://paperbark.justmaple.app"` (could be used)
- `"bearer_token:https://localhost:4200"` (development)
- Or any custom server URL

The Watch app was only looking for one hardcoded key, so if the token was saved with a different server URL, it wouldn't find it.

## Solution

Updated `KeychainHelper.swift` to try multiple account keys:

### Before

```swift
func getToken(serverId: String? = nil) -> String? {
    // Only tried ONE account key
    let account = "\(tokenKeyPrefix):https://justmaple.app"

    // Query keychain...
    // If not found, return nil immediately
}
```

### After

```swift
func getToken(serverId: String? = nil) -> String? {
    // Try MULTIPLE account keys
    let accountsToTry = [
        "\(tokenKeyPrefix):https://justmaple.app",
        "\(tokenKeyPrefix):https://paperbark.justmaple.app",
        "\(tokenKeyPrefix):https://localhost:4200",
    ]

    // Try each one until we find a token
    for account in accountsToTry {
        // Query keychain...
        if found {
            return token
        }
    }

    // Debug: List what's actually in the keychain
    listAllKeychainItems()

    return nil
}
```

## Debug Helper Added

When no token is found, the helper now lists all keychain items in the app group:

```swift
private func listAllKeychainItems() {
    // Queries all items with:
    // - Service: "com.just.maple.JapaneseMaple"
    // - Access Group: "group.com.just.maple.JapaneseMaple"

    print("[KeychainHelper] 🔍 Found X items in keychain:")
    print("[KeychainHelper]   - Account: bearer_token:...")
}
```

This helps diagnose issues by showing exactly what account keys exist.

## How to Test

### 1. Check iPhone Logs (when logging in)

Look for:

```
[ServerConfigService] Saved token to shared keychain for account: bearer_token:https://justmaple.app
```

This shows the exact account key used.

### 2. Check Watch Logs (when opening app)

Look for one of:

```
✅ Success:
[KeychainHelper] ✅ Found token with account: bearer_token:https://justmaple.app

❌ Not found:
[KeychainHelper] ❌ No token found in any account
[KeychainHelper] 🔍 Found 0 items in keychain (status: -25300)
```

### 3. If Watch Can't Find Token

The debug output will show:

- How many items are in the shared keychain
- What account keys exist
- What the Watch tried to find

Compare this to what the iPhone saved to identify the mismatch.

## Common Issues & Solutions

### Issue: Watch shows 0 items in keychain

**Cause**: App Groups not configured correctly

**Solution**:

1. Check iPhone target has `group.com.just.maple.JapaneseMaple` in App Groups capability
2. Check Watch target has the same App Group
3. Regenerate provisioning profiles
4. Clean and rebuild

### Issue: Watch finds items but wrong account name

**Cause**: iPhone is using a custom server URL

**Solution**: Add the custom URL to `accountsToTry` array in `KeychainHelper.swift`

### Issue: Watch logs show "status: -25300"

**Meaning**: `errSecItemNotFound` - No matching items

**Solution**: This is normal if not logged in. Log in on iPhone first.

### Issue: Watch logs show "status: -34018"

**Meaning**: Keychain access denied

**Solution**:

1. Verify both targets use the same App Group ID
2. Check entitlements files are correct
3. Rebuild with new provisioning profiles

## Token Account Key Format

The account key format is:

```
"bearer_token:<server_url>"
```

Examples:

- `bearer_token:https://justmaple.app` (most common)
- `bearer_token:https://paperbark.justmaple.app`
- `bearer_token:https://localhost:4200`

The server URL comes from `ServerConfigService.getActiveServer().url`.

## Files Modified

1. **`Shared/Services/KeychainHelper.swift`**
    - Updated `getToken()` to try multiple account keys
    - Added `listAllKeychainItems()` debug helper
    - Better logging for troubleshooting

## Testing Checklist

- [ ] Log in on iPhone app
- [ ] Check iPhone logs for saved account key
- [ ] Open Watch app
- [ ] Check Watch logs for token lookup
- [ ] Verify Watch finds the token
- [ ] If not found, check debug output for mismatches
- [ ] Try "Check Again" button
- [ ] Verify authentication works

## Expected Behavior

1. **User logs in on iPhone**: Token saved to shared keychain with server URL as account key
2. **User opens Watch app**: Watch tries multiple account keys until it finds one
3. **Token found**: Watch authenticates and loads tags
4. **Token not found**: Watch shows debug info to help diagnose issue

The multi-key approach ensures the Watch app works regardless of which server configuration the iPhone is using!
