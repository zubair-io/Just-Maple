# Maple Bridge JavaScript SDK

A clean, Promise-based JavaScript SDK for integrating with Japanese Maple's native multi-track audio recording and transcription capabilities.

## Quick Start

```html
<script src="maple-bridge.js"></script>
<script>
    // Start recording
    await recorder.start();

    // Show real-time audio levels
    recorder.onAudioLevel = (level) => {
        console.log('Audio level:', level);
    };

    // Stop and get transcription with speaker labels
    const result = await recorder.stop();
    console.log('Transcription:', result.text);
    console.log('Segments:', result.segments);
</script>
```

## Features

- ✅ **Promise-based API** - Clean async/await syntax
- 🎙️ **Multi-track Recording** - Captures microphone + system audio (macOS 13+)
- 🗣️ **Speaker Diarization** - Automatic "You" vs "Other" labeling
- ⏱️ **Timestamps** - Precise timing for each segment
- 📊 **Real-time Audio Levels** - 10 updates per second
- 🔄 **Progress Callbacks** - Track transcription progress
- 🎯 **Type-Safe** - Full TypeScript definitions included
- 📱 **Cross-platform** - Works on macOS and iOS

## Installation

Copy these files to your web app:

```
Resources/WebApp/
├── maple-bridge.js      # Main SDK
├── example.html         # Complete example
└── MAPLE_BRIDGE_API.md  # Full documentation
```

Include in your HTML:

```html
<script src="maple-bridge.js"></script>
```

## Basic Usage

### Simple Recording

```javascript
// Initialize
await mapleBridge.initialize();

// Start recording
await recorder.start();

// Stop and get result
const result = await recorder.stop();
alert('You said: ' + result.text);
```

### With Progress Tracking

```javascript
recorder.onAudioLevel = (level, duration) => {
    updateVisualizer(level);
    updateTimer(duration);
};

recorder.onProgress = (text, progress) => {
    showProgress(text, progress);
};

recorder.onComplete = (result) => {
    displayTranscription(result);
};

await recorder.start();
// ... user stops recording
```

### Multi-Track Transcription

```javascript
const result = await recorder.stop();

if (result.segments) {
    // Display conversation with speaker labels
    result.segments.forEach(segment => {
        console.log(`[${segment.startTime}s] ${segment.speaker}: ${segment.text}`);
    });
} else {
    // Fallback for single-track
    console.log(result.text);
}
```

## Key Classes

### `MapleBridge`

Main bridge class for native communication.

```javascript
// Initialize
await mapleBridge.initialize();

// Start recording
await mapleBridge.startRecording();

// Stop and get transcription
const result = await mapleBridge.stopRecording();

// Cancel recording
await mapleBridge.cancelRecording();

// Event listeners
mapleBridge.on('audioLevel', (data) => { ... });
mapleBridge.on('transcriptionComplete', (result) => { ... });
```

### `Recorder`

High-level recording interface with callbacks.

```javascript
// Properties
recorder.isRecording  // boolean
recorder.duration     // number (seconds)

// Callbacks
recorder.onAudioLevel = (level, duration) => { ... };
recorder.onProgress = (text, progress) => { ... };
recorder.onComplete = (result) => { ... };
recorder.onError = (error) => { ... };

// Methods
await recorder.start();
await recorder.stop();
await recorder.cancel();
```

## Events

| Event | Description |
|-------|-------------|
| `recordingStarted` | Recording has started |
| `recordingStopped` | Recording has stopped |
| `recordingCancelled` | Recording was cancelled |
| `audioLevel` | Audio level update (~10/sec) |
| `transcriptionProgress` | Transcription in progress |
| `transcriptionComplete` | Transcription finished |
| `error` | An error occurred |

## Data Types

### TranscriptionResult

```javascript
{
    text: "Full transcription text",
    duration: 45.2,  // seconds
    segments: [      // Optional: multi-track only
        {
            speaker: "You",
            text: "Hello, how are you?",
            startTime: 0.0,
            endTime: 2.5
        },
        {
            speaker: "Other",
            text: "I'm doing great, thanks!",
            startTime: 3.0,
            endTime: 5.5
        }
    ]
}
```

### AudioLevelData

```javascript
{
    level: 0.75,    // 0.0 to 1.0
    duration: 12.3  // seconds
}
```

## Utility Functions

```javascript
// Format duration to MM:SS
MapleBridge.formatDuration(125)  // "02:05"

// Format segments to text
const text = MapleBridge.formatSegments(result.segments);
// "[00:00] You: Hello
//  [00:03] Other: Hi there"
```

## Complete Example

See [example.html](JapaneseMaple/Resources/WebApp/example.html) for a fully working demo with:
- Visual audio level meter
- Real-time timer
- Progress tracking
- Speaker-labeled conversation view
- Error handling

## Architecture

```
┌─────────────────┐
│   Your Web App  │
└────────┬────────┘
         │ JavaScript
         ↓
┌─────────────────┐
│  Maple Bridge   │  ← This SDK
│   (JS Library)  │
└────────┬────────┘
         │ WKWebView Messages
         ↓
┌─────────────────┐
│  Native Swift   │
│   (macOS/iOS)   │
└────────┬────────┘
         │
    ┌────┴────┐
    ↓         ↓
┌─────────┐ ┌──────────────┐
│  Audio  │ │ WhisperKit   │
│ Capture │ │Transcription │
└─────────┘ └──────────────┘
```

## Requirements

**Web:**
- Modern browser with ES6 support
- Running inside WKWebView (provided by app)

**Native:**
- macOS 13+ (for multi-track recording)
- macOS 11+ or iOS 15+ (single-track fallback)

## API Documentation

See [MAPLE_BRIDGE_API.md](MAPLE_BRIDGE_API.md) for complete API reference with:
- All methods and properties
- Event documentation
- Error handling
- TypeScript definitions
- Advanced examples

## Files

```
JapaneseMaple/
├── BRIDGE_README.md           # This file (quick start)
├── MAPLE_BRIDGE_API.md        # Complete API docs
├── Resources/WebApp/
│   ├── maple-bridge.js        # SDK library
│   ├── example.html           # Working example
│   └── index.html             # Your custom app
```

## License

Copyright © 2025 Japanese Maple Team

---

**Need Help?** Check out [example.html](JapaneseMaple/Resources/WebApp/example.html) or the [full API documentation](MAPLE_BRIDGE_API.md).
