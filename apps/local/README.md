# Just Maple

A separate macOS/iOS app containing a bundled Markdown editor and native recorder.
Open a local folder or the app's iCloud Drive notebooks. Notes are ordinary `.md`
files; recordings use Markdown metadata/transcripts alongside their audio files.
The editor and recording controls start without a Just Maple server, account or
login. Initial on-device transcription needs model preparation. Optional recorder
provider features use only keys the user enters in Recorder settings.

The hosted JapaneseMaple remains deployed on Phoebe. This app has a separate target,
sandbox, preferences, WebKit data, URL scheme, recorder Keychain service and iCloud
container. No hosted or Sugar Maple data is imported automatically. Display
name: **Just Maple**; bundle ID `app.justmaple.JustMaple`; iCloud container
`iCloud.com.just.maple.Local`. The storage container, recorder Keychain service and
local recording namespace retain their original identifiers across this rename.

## Build

```sh
bun install --cwd apps/local/web --frozen-lockfile
bun run build:local
xcodebuild build -project apps/local/apple/JustMaple.xcodeproj \
  -scheme JustMaple -destination 'platform=macOS' CODE_SIGNING_ALLOWED=NO
xcodebuild build -project apps/local/apple/JustMaple.xcodeproj \
  -scheme JustMaple -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO
bun run test:local
```

Open `apple/JustMaple.xcodeproj` in Xcode. Its build phase builds and bundles the
web editor, fonts, icons and lazy chunks into `WebApp/`; production loads only the
confined `app://localhost` origin. `MAPLE_LOCAL_SKIP_WEB_BUILD=1` is for operator
builds immediately after `bun run build:local`; it still requires an existing
bundle. Dependency installation is explicit. The standalone web dependency lock is
`web/bun.lock`; it does not upgrade the hosted web/API dependencies.

## File behavior

Native file access is limited to this app's Documents/iCloud roots and folders the
user selected. Folder grants use security-scoped bookmarks across relaunches.
Native requests subscribe before posting and match request IDs, with a bounded
reply timeout. Symlink/traversal escapes and navigation to remote bridge origins
are rejected. The document webview cannot make external network requests; ordinary
external links open in the system browser only when clicked.

Notes read and write off the UI thread using coordinated, atomic writes with SHA-256 versions. If the file changed or
was removed after reading, the original stays untouched and the attempted edits
are saved as a separate `*.conflict-UUID.md` file. Reopen the original to review it.
Unsaved edits also remain in a local recovery draft until acknowledged on disk.
Failed saves show a visible error and require an explicit retry. Opening a note
with a recovery draft shows the disk version first and offers **Restore unsaved
edits**; it does not silently overwrite the disk version. Save queues survive
editor navigation and flush on backgrounding. macOS quit waits for saves or offers
an explicit choice to quit with the recovery draft retained.

Both workspaces remain mounted when switching, preserving editor state and active
capture. Recordings are independent files in the recorder library; automatic note
attachments are not part of this first split. The native recorder is reused from
`apps/apple/MapleRecorderKit`. Local startup does not download models or register a
global record shortcut. **Prepare on-device transcription models** is explicit;
audio capture works before model preparation. Existing hosted recorder defaults
are retained.

Local recording fallback is `Documents/JustMapleLocal/MapleRecorder/recordings`
inside the app sandbox. When available, the app's own iCloud Drive container uses
`Documents/MapleRecorder/recordings`; the existing recorder migrates only this
app's local fallback into that container. It never reads the hosted app's container.
Local fallback files are retained when the destination already exists. Prompts and
provider-key storage also use the new host identity. Model caches live in the app's
own sandbox. iCloud availability/materialization and cross-device behavior require
signed-device acceptance.

## Validation and signing

The local web suite passes 176 tests. `scripts/test-core.sh` runs five focused Swift
tests against the actual document/asset-path and recorder host-configuration sources,
without downloading inference models. They cover exact file round trips, conflicting
edits, duplicate creation, missing folders, path/symlink denial, bundled routes and
preservation of the hosted recorder defaults. Both Apple platform builds compile and sign with automatic Apple development provisioning.

A sandboxed, ad-hoc signed macOS smoke build opened the bundled editor, selected a
disposable folder, edited a note, verified the saved `.md` bytes and switched to the
recorder without model downloads. This development signing does not enable iCloud.

After refreshing the Xcode account, automatic provisioning succeeds for macOS and
iOS with bundle ID `app.justmaple.JustMaple` and this app’s own iCloud entitlement.
The signed Mac app shows **Just Maple** in its window, menu and bundled editor, and
can enumerate/open its iCloud folder. This verifies availability on this Mac;
cross-device synchronization, microphone/system-audio capture, real model inference
and App Store/TestFlight distribution remain device/release acceptance work.
The hosted Apple app and web source now use **JapaneseMaple** branding. No main
merge or hosted redeployment occurs in this rename.

## Source attribution

The editor and minimal Apple file shell were adapted from the user's Sugar Maple
checkout at commit `3e06248` (repository `zubair-io/Sugar-Maple`). See `SOURCE.md` for
scope. This is an independent local source copy, not a build-time dependency on
another checkout. Fonts ship from the pinned Fontsource packages with their license
notices bundled under `WebApp/licenses/`; no runtime Google Fonts request.
