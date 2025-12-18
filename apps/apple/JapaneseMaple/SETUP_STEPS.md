# Setup Steps - You're Almost Done! ✨

## ✅ What's Already Done

1. ✅ **NotificationService.swift** - Extension code is ready
2. ✅ **ServerConfigService.swift** - Updated to use shared storage
3. ✅ **PushNotificationService.swift** - Updated to sync data
4. ✅ **JapaneseMapleApp.swift** - Updated with initialization code
5. ✅ **AppDelegate** - Updated to pass serverKey in notifications

## 🎯 What You Need to Do in Xcode

### Step 1: Add Capabilities to MAIN APP Target (5 minutes)

1. Select your project in Xcode Navigator
2. Select the **JapaneseMaple** target
3. Go to **Signing & Capabilities** tab
4. Click **+ Capability**
5. Add **App Groups**:
    - Click the `+` button
    - Add: `group.com.just.maple.JapaneseMaple`
6. Click **+ Capability** again
7. Add **Keychain Sharing**:
    - Click the `+` button
    - Add: `group.com.just.maple.JapaneseMaple`

### Step 2: Add Capabilities to EXTENSION Target (5 minutes)

1. Still in project settings
2. Select the **NotificationServiceExtension** target
3. Go to **Signing & Capabilities** tab
4. Click **+ Capability**
5. Add **App Groups**:
    - Click the `+` button
    - Add: `group.com.just.maple.JapaneseMaple`
6. Click **+ Capability** again
7. Add **Keychain Sharing**:
    - Click the `+` button
    - Add: `group.com.just.maple.JapaneseMaple`

### Step 3: Link the Entitlements File (2 minutes)

1. Select the **NotificationServiceExtension** target
2. Go to **Build Settings** tab
3. Search for "entitlements"
4. Find **Code Signing Entitlements**
5. Set the value to: `NotificationServiceExtension.entitlements`

### Step 4: Build and Test (2 minutes)

1. Select your main app scheme
2. Build the project (⌘B)
3. If it builds successfully, you're done! 🎉

## 📱 Testing

To test if everything works:

1. **Run the app** on a physical device
2. **Login** to your server
3. **Enable push notifications** in the app
4. **Send a test notification** from your server with:
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
5. **Check Console.app** on Mac for logs starting with `[NotificationService]`

## 🐛 If You See Build Errors

### "No such module 'Foundation'" or similar

- Clean build folder: **Product → Clean Build Folder**
- Rebuild: ⌘B

### "Code signing error"

- Make sure both targets have a valid development team selected
- Check that provisioning profiles are up to date

### "Cannot find 'ServerConfigService' in scope"

- Make sure `ServerConfigService.swift` is added to the extension target
- Go to File Inspector → Target Membership
- Check the box next to NotificationServiceExtension

## 📝 Quick Checklist

```
□ App Groups added to main app (group.com.just.maple.JapaneseMaple)
□ Keychain Sharing added to main app (group.com.just.maple.JapaneseMaple)
□ App Groups added to extension (group.com.just.maple.JapaneseMaple)
□ Keychain Sharing added to extension (group.com.just.maple.JapaneseMaple)
□ Entitlements file linked to extension target
□ Project builds without errors
□ Tested on physical device
```

## 🎉 Success!

Once you complete these steps, your Notification Service Extension will be ready to:

- Download and attach media (images, videos, audio)
- Fetch enriched notification data from your server
- Support multiple server configurations
- Work seamlessly with your existing push notification system

## 📚 Full Documentation

For more details, see:

- **QUICK_REFERENCE.md** - Quick lookup guide
- **NOTIFICATION_EXTENSION_SUMMARY.md** - Complete overview
- **NOTIFICATION_SERVICE_EXTENSION_SETUP.md** - Detailed setup guide
- **SERVER_PUSH_NOTIFICATION_GUIDE.md** - Server configuration
- **NOTIFICATION_EXTENSION_CHECKLIST.md** - Full verification checklist

---

**Need help?** Check the documentation files or open Console.app to see debug logs!
