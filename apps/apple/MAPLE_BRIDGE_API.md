# Maple Bridge JavaScript SDK Documentation

The Maple Bridge JavaScript SDK provides a clean, Promise-based API for integrating with the Japanese Maple native application. It handles multi-track audio recording, real-time transcription with speaker diarization, and bidirectional communication between JavaScript and native Swift code.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
    - [MapleBridge](#maplebridge)
    - [Recorder](#recorder)
- [Events](#events)
- [Multi-Track Recording](#multi-track-recording)
- [Examples](#examples)
- [Error Handling](#error-handling)
- [TypeScript Definitions](#typescript-definitions)

---

## Installation

Include the SDK in your HTML:

```html
<script src="maple-bridge.js"></script>
```

The SDK automatically creates global instances:

- `mapleBridge` - Main bridge instance
- `recorder` - High-level recorder instance

---

## Quick Start

### Basic Recording

```javascript
// Initialize the bridge
await mapleBridge.initialize();

// Start recording
await recorder.start();

// Show audio level
recorder.onAudioLevel = (level, duration) => {
    console.log(`Level: ${level}, Duration: ${duration}s`);
};

// Get transcription
const result = await recorder.stop();
console.log('Transcription:', result.text);

// Multi-track segments (if available)
if (result.segments) {
    result.segments.forEach((segment) => {
        console.log(`[${segment.startTime}s] ${segment.speaker}: ${segment.text}`);
    });
}
```

### Promise-Based API

```javascript
recorder
    .start()
    .then(() => console.log('Recording started'))
    .catch((err) => console.error('Failed to start:', err));

recorder
    .stop()
    .then((result) => console.log('Transcription:', result.text))
    .catch((err) => console.error('Failed to stop:', err));
```

### Event-Based API

```javascript
// Listen for transcription progress
mapleBridge.on('transcriptionProgress', (data) => {
    console.log('Progress:', data.text);
});

// Listen for completion
mapleBridge.on('transcriptionComplete', (result) => {
    console.log('Complete:', result);
});

// Listen for errors
mapleBridge.on('error', (error) => {
    console.error('Error:', error.message);
});
```

---

## API Reference

### MapleBridge

Main bridge class for native communication.

#### Methods

##### `initialize()`

Initialize the bridge and wait for native ready signal.

```javascript
await mapleBridge.initialize();
// Returns: Promise<InitialState>
```

**InitialState:**

```typescript
{
    appVersion: string; // e.g., "1.0.0"
    platform: string; // "macOS" or "iOS"
    timestamp: string; // ISO 8601 timestamp
}
```

##### `isAvailable()`

Check if native bridge is available.

```javascript
if (mapleBridge.isAvailable()) {
    console.log('Native bridge is ready');
}
// Returns: boolean
```

##### `startRecording()`

Start audio recording (microphone + system audio on macOS 13+).

```javascript
const metadata = await mapleBridge.startRecording();
// Returns: Promise<RecordingMetadata>
```

**RecordingMetadata:**

```typescript
{
    filePath: string; // Path to audio file
    timestamp: string; // ISO 8601 timestamp
}
```

##### `stopRecording()`

Stop recording and get transcription with speaker diarization.

```javascript
const result = await mapleBridge.stopRecording();
// Returns: Promise<TranscriptionResult>
```

**TranscriptionResult:**

```typescript
{
    text: string;              // Full transcription
    duration: number;          // Total duration in seconds
    segments?: Array<{         // Speaker-labeled segments (multi-track)
        speaker: "You" | "Other";
        text: string;
        startTime: number;     // Seconds
        endTime: number;       // Seconds
    }>;
}
```

##### `cancelRecording()`

Cancel recording without transcription.

```javascript
await mapleBridge.cancelRecording();
// Returns: Promise<void>
```

##### `getRecordingState()`

Get current recording state.

```javascript
const isRecording = mapleBridge.getRecordingState();
// Returns: boolean
```

##### `getRecordingDuration()`

Get current recording duration in seconds.

```javascript
const duration = mapleBridge.getRecordingDuration();
// Returns: number
```

##### `sendTest(message)`

Send a test message to native.

```javascript
const response = await mapleBridge.sendTest('Hello from web!');
// Returns: Promise<TestResponse>
```

#### Event Methods

##### `on(event, callback)`

Register an event listener.

```javascript
const unsubscribe = mapleBridge.on('audioLevel', (data) => {
    console.log('Audio level:', data.level);
});

// Later: unsubscribe()
// Returns: Function (unsubscribe function)
```

##### `once(event, callback)`

Register a one-time event listener.

```javascript
mapleBridge.once('recordingStarted', (data) => {
    console.log('Recording started:', data);
});
```

##### `off(event, callback)`

Remove specific event listener.

```javascript
function handleLevel(data) {
    console.log(data.level);
}

mapleBridge.on('audioLevel', handleLevel);
mapleBridge.off('audioLevel', handleLevel);
```

##### `offAll(event)`

Remove all listeners for an event.

```javascript
mapleBridge.offAll('audioLevel');
```

#### Static Methods

##### `MapleBridge.formatDuration(seconds)`

Format duration to MM:SS.

```javascript
const formatted = MapleBridge.formatDuration(125);
// Returns: "02:05"
```

##### `MapleBridge.formatSegments(segments)`

Format segments to readable text.

```javascript
const text = MapleBridge.formatSegments(result.segments);
// Returns:
// "[00:00] You: Hello, how are you?
//  [00:03] Other: I'm doing great, thanks!"
```

---

### Recorder

High-level recording interface with convenient callbacks.

#### Properties

##### `isRecording`

Get current recording state.

```javascript
if (recorder.isRecording) {
    console.log('Currently recording');
}
// Type: boolean (readonly)
```

##### `duration`

Get current recording duration.

```javascript
const seconds = recorder.duration;
// Type: number (readonly)
```

##### `onAudioLevel`

Callback for audio level updates (called ~10 times per second).

```javascript
recorder.onAudioLevel = (level, duration) => {
    // level: 0.0 to 1.0
    // duration: seconds since recording started
    updateVisualizer(level);
};
// Type: (level: number, duration: number) => void
```

##### `onProgress`

Callback for transcription progress.

```javascript
recorder.onProgress = (text, progress) => {
    // text: partial transcription
    // progress: 0.0 to 1.0
    console.log(`${Math.round(progress * 100)}%: ${text}`);
};
// Type: (text: string, progress: number) => void
```

##### `onComplete`

Callback for transcription completion.

```javascript
recorder.onComplete = (result) => {
    console.log('Transcription:', result.text);
    if (result.segments) {
        displayConversation(result.segments);
    }
};
// Type: (result: TranscriptionResult) => void
```

##### `onError`

Callback for errors.

```javascript
recorder.onError = (error) => {
    alert(`Error: ${error.message}`);
};
// Type: (error: ErrorData) => void
```

#### Methods

##### `start()`

Start recording.

```javascript
await recorder.start();
// Returns: Promise<RecordingMetadata>
```

##### `stop()`

Stop recording and get result.

```javascript
const result = await recorder.stop();
// Returns: Promise<TranscriptionResult>
```

##### `cancel()`

Cancel recording.

```javascript
await recorder.cancel();
// Returns: Promise<void>
```

---

## Events

All events emitted by MapleBridge:

| Event                   | Payload               | Description               |
| ----------------------- | --------------------- | ------------------------- |
| `initialize`            | `InitialState`        | Bridge initialized        |
| `recordingStarted`      | `RecordingMetadata`   | Recording started         |
| `recordingStopped`      | `RecordingResult`     | Recording stopped         |
| `recordingCancelled`    | `null`                | Recording cancelled       |
| `audioLevel`            | `AudioLevelData`      | Audio level update        |
| `transcriptionProgress` | `{ text, progress }`  | Transcription in progress |
| `transcriptionComplete` | `TranscriptionResult` | Transcription complete    |
| `error`                 | `ErrorData`           | Error occurred            |
| `testResponse`          | `TestResponse`        | Test message response     |

---

## Multi-Track Recording

On macOS 13+, the app captures both microphone and system audio simultaneously, then transcribes each track separately with timestamps. The results are merged chronologically with speaker labels.

### Features

- **Separate Tracks**: Microphone (You) and System Audio (Other)
- **Speaker Diarization**: Automatic speaker identification
- **Chronological Ordering**: Segments sorted by timestamp
- **High Accuracy**: Uses WhisperKit for local transcription

### Example

```javascript
const result = await recorder.stop();

if (result.segments) {
    // Multi-track transcription available
    result.segments.forEach((segment) => {
        const time = MapleBridge.formatDuration(segment.startTime);
        const speaker = segment.speaker; // "You" or "Other"
        console.log(`[${time}] ${speaker}: ${segment.text}`);
    });
} else {
    // Single-track fallback (older macOS versions)
    console.log(result.text);
}
```

### Display Speaker-Labeled UI

```javascript
recorder.onComplete = (result) => {
    const container = document.getElementById('transcript');
    container.innerHTML = '';

    if (result.segments) {
        result.segments.forEach((segment) => {
            const div = document.createElement('div');
            div.className = `segment ${segment.speaker.toLowerCase()}`;

            const timestamp = MapleBridge.formatDuration(segment.startTime);
            div.innerHTML = `
                <span class="speaker">${segment.speaker}</span>
                <span class="time">${timestamp}</span>
                <p>${segment.text}</p>
            `;

            container.appendChild(div);
        });
    }
};
```

```css
.segment {
    padding: 12px;
    margin: 8px 0;
    border-radius: 8px;
}

.segment.you {
    background: rgba(16, 185, 129, 0.2);
    border-left: 4px solid #10b981;
}

.segment.other {
    background: rgba(96, 165, 250, 0.2);
    border-left: 4px solid #60a5fa;
}

.speaker {
    font-weight: bold;
    margin-right: 8px;
}

.time {
    opacity: 0.7;
    font-size: 0.9em;
}
```

---

## Examples

### Complete Recording Flow

```javascript
async function recordAndTranscribe() {
    try {
        // Initialize
        await mapleBridge.initialize();
        console.log('Bridge ready');

        // Setup callbacks
        recorder.onAudioLevel = (level, duration) => {
            document.getElementById('level').style.width = `${level * 100}%`;
            document.getElementById('timer').textContent = MapleBridge.formatDuration(duration);
        };

        recorder.onProgress = (text, progress) => {
            document.getElementById('status').textContent =
                `Transcribing... ${Math.round(progress * 100)}%`;
        };

        recorder.onError = (error) => {
            alert(`Error: ${error.message}`);
        };

        // Start recording
        await recorder.start();
        document.getElementById('status').textContent = 'Recording...';

        // User clicks stop button...
        // (handled by your UI)
    } catch (error) {
        console.error('Failed:', error);
    }
}

async function stopAndProcess() {
    try {
        const result = await recorder.stop();

        // Display results
        displayTranscription(result);
    } catch (error) {
        console.error('Failed to stop:', error);
    }
}

function displayTranscription(result) {
    const container = document.getElementById('transcript');

    if (result.segments) {
        // Multi-track conversation view
        container.innerHTML = result.segments
            .map(
                (seg) => `
            <div class="segment ${seg.speaker.toLowerCase()}">
                <strong>${seg.speaker}</strong>
                <span>[${MapleBridge.formatDuration(seg.startTime)}]</span>
                <p>${seg.text}</p>
            </div>
        `,
            )
            .join('');
    } else {
        // Simple text view
        container.textContent = result.text;
    }
}
```

### Timer Component

```javascript
class RecordingTimer {
    constructor() {
        this.interval = null;
    }

    start() {
        this.interval = setInterval(() => {
            const duration = recorder.duration;
            document.getElementById('timer').textContent = MapleBridge.formatDuration(duration);
        }, 100);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }
}

const timer = new RecordingTimer();

recorder.start().then(() => timer.start());
recorder.stop().then(() => timer.stop());
```

### Audio Visualizer

```javascript
class AudioVisualizer {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.ctx = canvasElement.getContext('2d');
        this.levels = [];
        this.maxLevels = 100;
    }

    update(level) {
        this.levels.push(level);
        if (this.levels.length > this.maxLevels) {
            this.levels.shift();
        }
        this.draw();
    }

    draw() {
        const { width, height } = this.canvas;
        this.ctx.clearRect(0, 0, width, height);

        const barWidth = width / this.maxLevels;
        this.levels.forEach((level, i) => {
            const barHeight = level * height;
            const x = i * barWidth;
            const y = height - barHeight;

            this.ctx.fillStyle = `rgba(16, 185, 129, ${0.5 + level * 0.5})`;
            this.ctx.fillRect(x, y, barWidth - 1, barHeight);
        });
    }
}

const visualizer = new AudioVisualizer(document.getElementById('canvas'));
recorder.onAudioLevel = (level) => visualizer.update(level);
```

---

## Error Handling

### Error Types

```javascript
{
    code: "RECORDING_ERROR" | "TRANSCRIPTION_ERROR" | "STOP_RECORDING_ERROR",
    message: string
}
```

### Handling Errors

```javascript
// Promise-based
try {
    await recorder.start();
} catch (error) {
    if (error.message.includes('permission')) {
        alert('Please grant microphone permission');
    } else {
        alert(`Error: ${error.message}`);
    }
}

// Event-based
recorder.onError = (error) => {
    switch (error.code) {
        case 'RECORDING_ERROR':
            console.error('Failed to start recording');
            break;
        case 'TRANSCRIPTION_ERROR':
            console.error('Failed to transcribe audio');
            break;
        default:
            console.error('Unknown error:', error.message);
    }
};
```

---

## TypeScript Definitions

```typescript
declare class MapleBridge {
    initialize(): Promise<InitialState>;
    isAvailable(): boolean;
    startRecording(): Promise<RecordingMetadata>;
    stopRecording(): Promise<TranscriptionResult>;
    cancelRecording(): Promise<void>;
    getRecordingState(): boolean;
    getRecordingDuration(): number;
    sendTest(message: string): Promise<TestResponse>;

    on(event: string, callback: (data: any) => void): () => void;
    once(event: string, callback: (data: any) => void): void;
    off(event: string, callback: (data: any) => void): void;
    offAll(event: string): void;

    static formatDuration(seconds: number): string;
    static formatSegments(segments: TranscriptSegment[]): string;
}

declare class Recorder {
    readonly isRecording: boolean;
    readonly duration: number;

    onAudioLevel: ((level: number, duration: number) => void) | null;
    onProgress: ((text: string, progress: number) => void) | null;
    onComplete: ((result: TranscriptionResult) => void) | null;
    onError: ((error: ErrorData) => void) | null;

    start(): Promise<RecordingMetadata>;
    stop(): Promise<TranscriptionResult>;
    cancel(): Promise<void>;
}

interface InitialState {
    appVersion: string;
    platform: string;
    timestamp: string;
}

interface RecordingMetadata {
    filePath: string;
    timestamp: string;
}

interface TranscriptionResult {
    text: string;
    duration: number;
    segments?: TranscriptSegment[];
}

interface TranscriptSegment {
    speaker: 'You' | 'Other';
    text: string;
    startTime: number;
    endTime: number;
}

interface AudioLevelData {
    level: number;
    duration: number;
}

interface ErrorData {
    code: string;
    message: string;
}

declare const mapleBridge: MapleBridge;
declare const recorder: Recorder;
```

---

## Browser Compatibility

The SDK is compatible with all modern browsers that support:

- ES6 Promises
- Map/Set
- Arrow functions
- Template literals

Required for native integration:

- WebKit message handlers (iOS/macOS WKWebView)

---

## License

Copyright © 2025 Japanese Maple Team
