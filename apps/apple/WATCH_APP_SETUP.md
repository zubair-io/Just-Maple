# Apple Watch App Setup Guide

This guide explains how to add the Apple Watch app files to the Xcode project and configure the build targets.

## Files Created

### Shared Models (apps/apple/Shared/Models/)

These should be added to **both** iPhone and Watch app targets:

- `NoteContent.swift` - TipTap/ProseMirror JSON content structure
- `User.swift` - User data model
- `Tag.swift` - Tag (folder) data model with sharing
- `Message.swift` - Chat message data model
- `APIResponse.swift` - Generic API response wrappers

### Shared Services (apps/apple/Shared/Services/)

These should be added to **both** iPhone and Watch app targets:

- `KeychainHelper.swift` - Shared keychain access
- `APIClient.swift` - Network client for Just Maple API
- `TipTapParser.swift` - Rich text parser for Watch display

### iPhone App Files (apps/apple/JapaneseMaple/)

These should be added to the **iPhone app target only**:

- `WatchConnectivityService.swift` - Syncs auth token to Watch

### Watch App Files (apps/apple/Just Maple Watch Watch App/)

These should be added to the **Watch app target only**:

- `AuthenticationManager.swift` - Manages Watch authentication
- `TagListViewModel.swift` - Tag list view model
- `TagListView.swift` - Main tag list view
- `MessageListViewModel.swift` - Message list view model
- `MessageListView.swift` - Message list view
- `MessageComposerView.swift` - Message composition view

## Xcode Setup Steps

### 1. Add Shared Files to Xcode

1. In Xcode, right-click on the project navigator
2. Select "Add Files to JapaneseMaple..."
3. Navigate to `apps/apple/Shared/`
4. Select the `Shared` folder
5. **Important**: In the dialog, check both:
    - ✅ JapaneseMaple (iPhone app target)
    - ✅ Just Maple Watch Watch App (Watch app target)
6. Click "Add"

### 2. Add Watch App Files to Xcode

1. Right-click on "Just Maple Watch Watch App" in the project navigator
2. Select "Add Files to JapaneseMaple..."
3. Navigate to `apps/apple/Just Maple Watch Watch App/`
4. Select these files:
    - `AuthenticationManager.swift`
    - `TagListViewModel.swift`
    - `TagListView.swift`
    - `MessageListViewModel.swift`
    - `MessageListView.swift`
    - `MessageComposerView.swift`
5. **Important**: Only check:
    - ✅ Just Maple Watch Watch App
6. Click "Add"

### 3. Add iPhone Watch Connectivity Service

1. Right-click on "JapaneseMaple" folder in the project navigator
2. Select "Add Files to JapaneseMaple..."
3. Navigate to `apps/apple/JapaneseMaple/`
4. Select `WatchConnectivityService.swift`
5. **Important**: Only check:
    - ✅ JapaneseMaple (iPhone app target)
6. Click "Add"

### 4. Verify Watch App Entitlements

The Watch app needs the same app groups as the iPhone app to access shared keychain:

1. Select the "Just Maple Watch Watch App" target
2. Go to "Signing & Capabilities"
3. Click "+ Capability"
4. Add "App Groups"
5. Check: `group.com.just.maple.JapaneseMaple`

### 5. Initialize Watch Connectivity in iPhone App

The `NativeBridge.swift` file has already been updated to sync tokens to the Watch when saved/cleared.

To initialize the Watch Connectivity service when the app starts, you need to call it early in the app lifecycle. Add this to your main app initialization (AppDelegate or similar):

```swift
// Initialize Watch Connectivity
WatchConnectivityService.shared
```

### 6. Build and Test

1. Select the "Just Maple Watch Watch App" scheme
2. Choose a Watch simulator or device
3. Build and run (Cmd+R)

## How It Works

### Authentication Flow

1. User logs in on iPhone app
2. iPhone saves JWT token to shared keychain
3. `WatchConnectivityService` automatically syncs token to Watch via `updateApplicationContext`
4. Watch app receives token in `AuthenticationManager`
5. Watch saves token to shared keychain
6. Watch can now make authenticated API requests

### Data Flow

```
iPhone App (WebView)
    ↓ (login)
Keychain (shared: group.com.just.maple.JapaneseMaple)
    ↓ (Watch Connectivity)
Watch App (AuthenticationManager)
    ↓ (APIClient with token)
Just Maple API (https://paperbark.justmaple.app)
```

### Watch App Features

- **Tag List**: Shows all tags/folders from the API
- **Message List**: Shows messages within a tag
- **Message Composer**: Send messages using:
    - Dictation (voice to text)
    - Scribble (handwriting)
    - Keyboard input
- **Pull to Refresh**: Manually refresh tags and messages
- **Auto-sync**: Watch automatically requests auth from iPhone when needed

## Troubleshooting

### Watch shows "Not Authenticated"

1. Make sure you're logged in on the iPhone app
2. Check that iPhone and Watch are paired and connected
3. On Watch, tap "Request Sync" to manually trigger auth sync
4. Check Console.app for `[AuthManager]` and `[WatchConnectivity]` logs

### Build errors about missing files

1. Verify all files are added to the correct targets
2. Check "Target Membership" in File Inspector for each file
3. Clean build folder (Cmd+Shift+K) and rebuild

### Keychain errors

1. Verify App Groups capability is enabled on both targets
2. Check that both use `group.com.just.maple.JapaneseMaple`
3. Regenerate provisioning profiles if needed

## Testing Checklist

- [ ] iPhone app can save/clear tokens
- [ ] Watch receives token when iPhone logs in
- [ ] Watch shows "Not Authenticated" when no token
- [ ] Watch can request sync from iPhone
- [ ] Watch loads tags after authentication
- [ ] Watch displays tag list
- [ ] Watch loads messages when tapping a tag
- [ ] Watch can send messages using dictation
- [ ] Pull-to-refresh works on both views
- [ ] Watch clears auth when iPhone logs out

## Next Steps

### Optional Enhancements

1. **Background Refresh**: Use `WKApplicationRefreshBackgroundTask` for periodic updates
2. **Complications**: Show unread count on watch face
3. **Notifications**: Tap notification to open relevant tag
4. **Rich Text Display**: Parse more TipTap formatting (currently shows plain text)
5. **Message Editing**: Allow editing sent messages
6. **Haptic Feedback**: Add haptics for message send/receive

### Performance Optimizations

1. **Message Pagination**: Load more messages on scroll
2. **Local Caching**: Cache tags and messages using UserDefaults or CoreData
3. **Incremental Updates**: Only fetch new messages since last sync
4. **Image Caching**: Cache profile pictures

---

## Build Status

✅ **All builds successful!**

- iPhone app builds without errors
- Watch app builds without errors
- All shared files compile correctly for both targets

### Build Commands

Build iPhone app:
```bash
cd apps/apple
xcodebuild -project JapaneseMaple.xcodeproj -scheme "JapaneseMaple" -sdk iphonesimulator build
```

Build Watch app:
```bash
cd apps/apple
xcodebuild -project JapaneseMaple.xcodeproj -scheme "Just Maple Watch Watch App" -sdk watchsimulator build
```

Both targets can be built and run in Xcode by selecting the appropriate scheme from the scheme selector.
