# 🚀 Quick Start - Get Your Extension Working in 15 Minutes!

## ✅ Code Changes: DONE! ✨

I've already updated all your code files:

- ✅ JapaneseMapleApp.swift
- ✅ ServerConfigService.swift
- ✅ PushNotificationService.swift
- ✅ Created NotificationService.swift
- ✅ Created Info.plist and entitlements

**You don't need to write any code!** Just configure Xcode.

---

## 🎯 What You Need to Do

### Part 1: Xcode Configuration (10 minutes)

#### Step 1: Main App - Add App Groups

1. Click on your project in Xcode
2. Select **JapaneseMaple** target
3. Go to **Signing & Capabilities**
4. Click **+ Capability**
5. Choose **App Groups**
6. Check or add: `group.com.just.maple.JapaneseMaple`

#### Step 2: Main App - Add Keychain Sharing

1. Still on **JapaneseMaple** target
2. Click **+ Capability** again
3. Choose **Keychain Sharing**
4. Check or add: `group.com.just.maple.JapaneseMaple`

#### Step 3: Extension - Add App Groups

1. Select **NotificationServiceExtension** target
2. Go to **Signing & Capabilities**
3. Click **+ Capability**
4. Choose **App Groups**
5. Check or add: `group.com.just.maple.JapaneseMaple`

#### Step 4: Extension - Add Keychain Sharing

1. Still on **NotificationServiceExtension** target
2. Click **+ Capability**
3. Choose **Keychain Sharing**
4. Check or add: `group.com.just.maple.JapaneseMaple`

#### Step 5: Build

1. Select your app scheme
2. Press ⌘B to build
3. Fix any signing issues if they come up

### Part 2: Test on Device (5 minutes)

1. **Run on real device** (not simulator - extensions don't work there)
2. **Login** to your server
3. **Enable notifications** in your app
4. **Send test notification** from your server:

    ```json
    {
        "aps": {
            "alert": { "title": "Test", "body": "Hello!" },
            "mutable-content": 1,
            "sound": "default"
        },
        "notificationId": "test-001",
        "serverKey": "your-server-key",
        "type": "test"
    }
    ```

5. **Check if it works:**
    - Notification appears on device ✅
    - Console.app shows `[NotificationService]` logs ✅
    - Tapping notification opens app ✅

---

## 📋 Visual Checklist

```
XCODE SETUP:
□ Main app has App Groups (group.com.just.maple.JapaneseMaple)
□ Main app has Keychain Sharing (group.com.just.maple.JapaneseMaple)
□ Extension has App Groups (group.com.just.maple.JapaneseMaple)
□ Extension has Keychain Sharing (group.com.just.maple.JapaneseMaple)
□ Project builds without errors

TESTING:
□ App runs on real device
□ Can login to server
□ Push notifications enabled
□ Test notification received
□ Extension logs visible in Console.app
□ Tapping notification opens app
```

---

## 🎉 That's It!

Once you complete the checklist above, your Notification Service Extension is working!

### What You Get:

- 📸 Automatic media attachments (images, videos, audio)
- 🔄 Server-side notification enrichment
- 🔐 Multi-server authentication support
- ⚡ All handled automatically

---

## 🐛 Common Issues

### "App Groups not found"

- Make sure the group ID is **exactly**: `group.com.just.maple.JapaneseMaple`
- Check that both targets have the same group ID

### "Build error: No such module"

- Clean build folder: **Product → Clean Build Folder**
- Rebuild: ⌘B

### "Extension not triggered"

- Make sure `"mutable-content": 1` is in the push payload
- Test on real device, not simulator
- Check Console.app for errors

### "Cannot find ServerConfigService"

- The extension might need access to shared code
- Check if ServerConfigService.swift is in a shared location
- Or copy the ServerConfig struct to NotificationService.swift

---

## 📚 Need More Info?

- **SETUP_STEPS.md** - Detailed Xcode steps
- **FILES_CHANGED.md** - What code was modified
- **QUICK_REFERENCE.md** - Quick lookup
- **SERVER_PUSH_NOTIFICATION_GUIDE.md** - Server payload format

---

## 💡 Tips

1. **Use Console.app** to see extension logs:
    - Open Console.app on Mac
    - Connect your iOS device
    - Filter by "NotificationService"

2. **Test with simple payloads first:**
    - Start without media attachments
    - Add complexity once basic notifications work

3. **Server must send `mutable-content: 1`:**
    - This is REQUIRED for extension to run
    - Without it, extension is bypassed

---

## ✨ Success Looks Like:

```
Console.app logs:
[NotificationService] 📥 Received notification: test-001
[NotificationService] 📋 User Info: {...}
[NotificationService] 🖼️ Downloading image: https://...
[NotificationService] ✅ Successfully attached media: image.jpg
[NotificationService] 📤 Delivering notification
```

Then you'll see the notification on your device with the image attached! 🎉

---

**Ready?** Open Xcode and follow the steps above. You've got this! 💪
