# Maple Recorder in Just Maple

Native recorder ported from the local Maple Recorder working checkout, based on
revision `ad91b6e`, including its current uncommitted recording and S1 cleanup changes.
The Apple app opens the **Recorder** workspace inside its existing webview, from
the home header or sidebar (`/recorder`). `RecorderWebController` retains recording,
playback, and processing while navigating between notebooks. `MapleRecorderView`
remains available as a reusable native view; the app uses the web workspace.

The package includes microphone recording, optional Mac system audio, chunked
recordings, playback with transcript timing, speaker editing, local speech
recognition and diarization (FluidAudio), S1-mini transcript cleanup (MLX),
summaries, custom prompts, calendar titles, and the Mac floating recording panels.
Apple Foundation Models requires macOS/iOS 26 and a supported device. Optional
Claude/OpenAI processing uses keys entered in Recorder settings. The existing web
recording bridge uses `LocalTranscriber` from this package instead of WhisperKit,
whose tokenizer dependency conflicts with the MLX stack.

## Storage and first launch

Choose **Prepare models**, or stop the first recording, to initialize the speech,
speaker, and S1 models and download them if absent. Progress and errors appear in
the web workspace. Recording remains available while models prepare. New recordings
queue behind existing processing jobs; preparing models also queues saved recordings
that do not yet have transcripts.
Audio inference and cleanup run on the device once the models are cached.

Recordings live under `Documents/MapleRecorder/recordings`, either in Just Maple's
existing iCloud container or the app's local Documents directory. This path avoids
colliding with the web bridge's `Documents/Recordings` on case-insensitive disks.
The old standalone app's library and API keys are not imported automatically.
Recorder API keys use a separate Keychain service in Just Maple.

The standalone Watch app and its transfer delegate are excluded: Just Maple keeps
its existing Watch messaging integration. Changes to the Apple developer account
and provisioning profiles have not been made.

## Webview integration

The Angular workspace exposes the recording library, microphone and Mac system
audio capture, playback/seek/speed, transcript and speaker editing, tags, notes,
cleanup, summary generation, Ask AI, saved prompts/results, screenshot previews,
calendar titles, provider settings, and Markdown export. Live Mac notes and Assist
are inline; no floating notes panel is required. Automatic Assist is opt-in in the
web controls. Export opens an Apple save/share dialog.

The bridge accepts `recorderRequest` messages with a unique `requestId`, operation,
and optional arguments, then returns a correlated `recorderResponse`. Long model
and AI work runs as native jobs; the page polls progress without blocking controls.
Polling continues during recording/processing after navigating away so the shared
app header can show the active recorder. Start/stop Shortcuts use the same controller
and open the web workspace, including during cold launch.

Provider keys are write-only request fields. Responses contain only key-presence
flags. Recorder requests bypass the bridge's normal message logging and are accepted
only from the webview's main frame. Media access uses recording IDs and validated
screenshot names rather than arbitrary filesystem paths.

The webview loads the configured Just Maple server. To use this change, rebuild the
Apple app **and serve the updated web client** from that server. This work does not
publish or deploy the hosted client.

## Validation

Build the app from the repository root:

```sh
xcodebuild -project apps/apple/JapaneseMaple.xcodeproj -scheme JapaneseMaple \
  -destination 'platform=macOS' -skipPackagePluginValidation \
  CODE_SIGNING_ALLOWED=NO build

xcodebuild -project apps/apple/JapaneseMaple.xcodeproj -scheme JapaneseMaple \
  -destination 'generic/platform=iOS' -skipPackagePluginValidation \
  CODE_SIGNING_ALLOWED=NO build
```

Run the package tests from this directory:

```sh
xcodebuild -scheme MapleRecorderKit -destination 'platform=macOS' \
  -skipPackagePluginValidation CODE_SIGNING_ALLOWED=NO test
```

Run the focused web tests from `apps/web`:

```sh
bunx vitest run --config vitest.config.ts recorder recording.service
```

The native tests cover bridge validation and screenshot path boundaries as well as serialization, storage, speaker/transcript merging, playback
synchronization, settings, prompt requests, cleanup chunking, and bridge subword
assembly. They do not download models, capture microphone/system audio, or send AI
requests. Angular tests cover request correlation, stale responses, timeouts,
background status, edits, settings, confirmation, and Shortcut routing. Browser
checks use a simulated native bridge to exercise desktop/mobile controls.
Live recording, model inference, iCloud sync, and signed device installs
still require validation on the user's devices.
