# JapaneseMaple Native App - Final Setup Instructions

## Auth0 Removal Complete ✅

All Auth0 code has been removed from the native app.

## Xcode Project Configuration

### 1. Add ServerConfigService.swift to Xcode Project

1. Open `JapaneseMaple.xcodeproj` in Xcode
2. Right-click on the JapaneseMaple group
3. Add `ServerConfigService.swift` to the project
4. Ensure it's added to the app target

### 2. Remove Auth0 Dependencies (if any)

1. In Xcode, go to the project navigator
2. Select the JapaneseMaple project
3. Select the JapaneseMaple target
4. Go to "Build Phases" → "Link Binary With Libraries"
5. Remove any Auth0 frameworks if present
6. Go to "Package Dependencies"
7. Remove any Auth0 SPM packages if present

### 3. Configure Universal Links

1. Select the JapaneseMaple target
2. Go to "Signing & Capabilities"
3. Click "+ Capability" and add "Associated Domains"
4. Add the following domain:
    ```
    applinks:justmaple.app
    ```

### 4. Configure Custom URL Scheme (for deep links)

1. Still in the JapaneseMaple target
2. Go to the "Info" tab
3. Expand "URL Types"
4. Click "+" to add a new URL Type
5. Set:
    - **Identifier**: `com.just.maple`
    - **URL Schemes**: `justmaple`
    - **Role**: Editor

This allows the app to handle `justmaple://` URLs.

### 5. Deploy Apple App Site Association File

The file has been created at:

```
apps/web/public/.well-known/apple-app-site-association
```

**Important**: This file MUST be served from `https://justmaple.app/.well-known/apple-app-site-association`

- No file extension
- Content-Type: `application/json`
- Must be accessible via HTTPS
- Must be at the root domain

For testing, you can validate the file at:
https://search.developer.apple.com/appsearch-validation-tool/

## Build Configuration

### Native App Bundle Structure

The native app should have the Angular web app bundled as a fallback:

```
JapaneseMaple.app/
└── Contents/
    └── Resources/
        └── WebApp/
            └── browser/
                ├── index.html
                ├── *.js
                ├── *.css
                └── assets/
```

### Build Script

You can automate copying the web build to the native app:

```bash
#!/bin/bash
# Copy latest web build to native app

cd apps/web
bun run build:paperbark

# Copy to Xcode project
rm -rf ../apple/JapaneseMaple/WebApp
cp -r dist/apps/web/browser ../apple/JapaneseMaple/WebApp/browser

echo "✅ Web app copied to native bundle"
```

## Testing Checklist

### Server Configuration

- [ ] App loads from https://justmaple.app by default
- [ ] Can switch to https://localhost:4200 in settings
- [ ] Can add custom server URLs
- [ ] Server validation checks HTML title
- [ ] App falls back to bundled version if server unreachable

### Authentication

- [ ] Login saves token to iOS Keychain
- [ ] Token persists across app restarts
- [ ] Logout clears token from keychain
- [ ] Token syncs between native and web

### Universal Links

- [ ] Clicking justmaple.app links in email opens the app
- [ ] Deep links navigate to correct route
- [ ] Falls back to Safari if app not installed

### Audio Recording (existing features)

- [ ] Audio recording still works
- [ ] Transcription still works
- [ ] Multi-track recording works on macOS 13+

## Server Requirements

The Just Maple server must:

1. Serve the Angular app with `<title>Just Maple</title>` in the HTML
2. Serve the apple-app-site-association file at `/.well-known/apple-app-site-association`
3. Support HTTPS (required for universal links)
4. Handle CORS for API requests (if web app is served from different domain)

## Development Workflow

### Running with Dev Server

1. Start the API server: `cd apps/api && bun run dev`
2. Start the web app: `cd apps/web && bun run dev` (runs on https://localhost:4200)
3. Open the native app in Xcode
4. The app will load from localhost:4200
5. If localhost:4200 is not available, it falls back to the bundled app

### Production Build

1. Build the web app: `cd apps/web && bun run build:paperbark`
2. Deploy to https://justmaple.app
3. Ensure apple-app-site-association is accessible
4. Build and archive the native app in Xcode
5. Upload to App Store Connect

## Debugging

### Check if Universal Links are Working

```bash
# On macOS, check associated domains
swcutil show --application-identifier QREP66JW5U.com.just.maple.JapaneseMaple

# Validate apple-app-site-association
curl https://justmaple.app/.well-known/apple-app-site-association
```

### View Native Bridge Messages

Enable Web Inspector in Safari:

1. Open the app
2. Right-click on the web view
3. Select "Inspect Element"
4. View console logs for bridge messages

### Check Keychain Token Storage

```swift
// In Xcode debugger
po ServerConfigService.shared.getToken()
```

## Architecture Summary

```
┌─────────────────────────────────────────┐
│          JapaneseMaple (Native)         │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │   WKWebView                       │ │
│  │   ┌─────────────────────────────┐ │ │
│  │   │  SugarMaple (Angular)       │ │ │
│  │   │  - NativeBridgeService      │ │ │
│  │   │  - Auth Service             │ │ │
│  │   │  - PreferencesService       │ │ │
│  │   └─────────────────────────────┘ │ │
│  └───────────────────────────────────┘ │
│           ↕ Native Bridge               │
│  ┌───────────────────────────────────┐ │
│  │  ServerConfigService (Keychain)  │ │
│  │  NativeBridge (Swift)            │ │
│  │  Deep Link Handler               │ │
│  └───────────────────────────────────┘ │
└─────────────────────────────────────────┘
             ↓
      https://justmaple.app
      or custom server
```

## Next Steps

1. Open the project in Xcode and configure capabilities
2. Build and run on a device
3. Test server switching
4. Test authentication flow
5. Test universal links
6. Submit to App Store
