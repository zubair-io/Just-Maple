# Maple Bridge TypeScript SDK

Complete TypeScript SDK for Japanese Maple native integration with full type safety and multiple build formats.

## 📦 What's Included

### Core Files

- **[maple-bridge.ts](JapaneseMaple/Resources/WebApp/maple-bridge.ts)** - TypeScript source (530+ lines)
    - Full type definitions
    - Complete API implementation
    - Proper generics and type safety
    - Global type declarations

- **[maple-bridge.js](JapaneseMaple/Resources/WebApp/maple-bridge.js)** - JavaScript fallback
    - Works without compilation
    - JSDoc comments for IDE support
    - Backward compatible

### Configuration

- **[tsconfig.json](JapaneseMaple/Resources/WebApp/tsconfig.json)** - TypeScript compiler config
    - Strict mode enabled
    - ES2020 target
    - Multiple module formats

- **[package.json](JapaneseMaple/Resources/WebApp/package.json)** - NPM package config
    - Build scripts
    - Multiple entry points (ESM, CJS, UMD)
    - Type definitions export

- **[build.sh](JapaneseMaple/Resources/WebApp/build.sh)** - Build automation script
    - Builds all formats
    - Creates source maps
    - Generates type definitions

### Documentation

- **[README.md](JapaneseMaple/Resources/WebApp/README.md)** - TypeScript-specific guide
    - Installation instructions
    - TypeScript examples
    - React, Vue, Angular examples
    - Type safety guide

- **[MAPLE_BRIDGE_API.md](MAPLE_BRIDGE_API.md)** - Complete API reference
- **[BRIDGE_README.md](BRIDGE_README.md)** - Quick start guide

### Examples

- **[example.html](JapaneseMaple/Resources/WebApp/example.html)** - Working demo

## 🚀 Quick Start

### For TypeScript Projects

```bash
cd JapaneseMaple/Resources/WebApp
npm install
npm run build
```

Then in your TypeScript project:

```typescript
import { mapleBridge, recorder, TranscriptionResult } from './dist/maple-bridge.mjs';

async function record() {
    await mapleBridge.initialize();
    await recorder.start();

    const result: TranscriptionResult = await recorder.stop();
    console.log(result.text);
}
```

### For JavaScript Projects

```javascript
import { mapleBridge, recorder } from './dist/maple-bridge.mjs';

// Or CommonJS
const { mapleBridge, recorder } = require('./dist/maple-bridge.js');
```

### For Browser (No Build Step)

```html
<script src="dist/maple-bridge.umd.js"></script>
<script>
    const { mapleBridge, recorder } = window.MapleBridge;
</script>
```

## 📚 Type Definitions

All exported types are fully documented:

```typescript
// Core interfaces
export interface TranscriptionResult {
    text: string;
    duration: number;
    segments?: TranscriptSegment[];
}

export interface TranscriptSegment {
    speaker: 'You' | 'Other';
    text: string;
    startTime: number;
    endTime: number;
}

export interface AudioLevelData {
    level: number;
    duration: number;
}

// Main classes
export class MapleBridge {
    initialize(): Promise<InitialState>;
    startRecording(): Promise<RecordingMetadata>;
    stopRecording(): Promise<TranscriptionResult>;
    // ... etc
}

export class Recorder {
    onAudioLevel: ((level: number, duration: number) => void) | null;
    onComplete: ((result: TranscriptionResult) => void) | null;
    start(): Promise<RecordingMetadata>;
    stop(): Promise<TranscriptionResult>;
    // ... etc
}
```

## 🔨 Build Formats

The build process generates multiple formats:

### 1. ES Module (`.mjs`)

```typescript
import { mapleBridge } from './dist/maple-bridge.mjs';
```

### 2. CommonJS (`.js`)

```typescript
const { mapleBridge } = require('./dist/maple-bridge.js');
```

### 3. UMD Bundle (`.umd.js`)

```html
<script src="dist/maple-bridge.umd.js"></script>
```

### 4. Type Definitions (`.d.ts`)

```typescript
// Automatic IDE completion and type checking
```

## 📖 Usage Examples

### TypeScript with Full Type Safety

```typescript
import {
    mapleBridge,
    recorder,
    TranscriptionResult,
    TranscriptSegment,
} from '@japanese-maple/bridge';

// Initialize with type checking
const state = await mapleBridge.initialize();
console.log(`Running on ${state.platform} v${state.appVersion}`);

// Recording with callbacks
recorder.onAudioLevel = (level: number, duration: number): void => {
    updateVisualizer(level);
};

recorder.onComplete = (result: TranscriptionResult): void => {
    if (result.segments) {
        result.segments.forEach((seg: TranscriptSegment) => {
            console.log(`${seg.speaker} (${seg.startTime}s): ${seg.text}`);
        });
    }
};

// Start/stop recording
await recorder.start();
const result = await recorder.stop();
```

### React with TypeScript

```tsx
import React, { useState, useEffect } from 'react';
import { recorder, TranscriptionResult } from '@japanese-maple/bridge';

export const RecordingComponent: React.FC = () => {
    const [result, setResult] = useState<TranscriptionResult | null>(null);
    const [level, setLevel] = useState<number>(0);

    useEffect(() => {
        recorder.onAudioLevel = (level: number) => setLevel(level);
        recorder.onComplete = (result: TranscriptionResult) => setResult(result);
    }, []);

    return (
        <div>
            <button onClick={() => recorder.start()}>Start</button>
            <button onClick={() => recorder.stop()}>Stop</button>
            <div>Audio Level: {Math.round(level * 100)}%</div>
            {result?.segments?.map((seg, i) => (
                <div key={i}>
                    <strong>{seg.speaker}:</strong> {seg.text}
                </div>
            ))}
        </div>
    );
};
```

### Vue 3 with TypeScript

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { recorder, type TranscriptionResult } from '@japanese-maple/bridge';

const result = ref<TranscriptionResult | null>(null);
const audioLevel = ref<number>(0);

onMounted(() => {
    recorder.onAudioLevel = (level: number) => {
        audioLevel.value = level;
    };

    recorder.onComplete = (res: TranscriptionResult) => {
        result.value = res;
    };
});

async function start(): Promise<void> {
    await recorder.start();
}

async function stop(): Promise<void> {
    await recorder.stop();
}
</script>

<template>
    <div>
        <button @click="start">Start</button>
        <button @click="stop">Stop</button>
        <div>Level: {{ Math.round(audioLevel * 100) }}%</div>
        <div v-if="result?.segments">
            <div v-for="(seg, i) in result.segments" :key="i">
                <strong>{{ seg.speaker }}:</strong> {{ seg.text }}
            </div>
        </div>
    </div>
</template>
```

## 🏗️ Building

```bash
# Install dependencies
npm install

# Build all formats
npm run build

# Or use the shell script
./build.sh

# Build individual formats
npm run build:esm    # ES Module
npm run build:cjs    # CommonJS
npm run build:umd    # UMD bundle

# Watch mode for development
npm run watch
```

## 📂 Output Structure

```
dist/
├── maple-bridge.js          # CommonJS
├── maple-bridge.js.map      # Source map (CJS)
├── maple-bridge.mjs         # ES Module
├── maple-bridge.d.ts        # Type definitions
├── maple-bridge.d.ts.map    # Source map (types)
├── maple-bridge.umd.js      # UMD bundle (minified)
├── maple-bridge.umd.js.map  # Source map (UMD)
└── maple-bridge.browser.js  # Browser bundle (unminified)
```

## 🎯 Type Safety Features

### 1. Strict Null Checks

```typescript
// result.segments might be undefined
if (result.segments) {
    // TypeScript knows segments is defined here
    result.segments.forEach((seg) => console.log(seg.text));
}
```

### 2. Union Types

```typescript
// Speaker is "You" | "Other"
const speaker: Speaker = segment.speaker;

if (speaker === 'You') {
    // TypeScript narrows the type
}
```

### 3. Generic Events

```typescript
// Type-safe event listeners
mapleBridge.on<AudioLevelData>('audioLevel', (data) => {
    // data.level is number
    // data.duration is number
});
```

### 4. Promise Types

```typescript
// Return types are enforced
const result: TranscriptionResult = await recorder.stop();
const metadata: RecordingMetadata = await recorder.start();
```

## 🔧 IDE Support

### VS Code

- Full IntelliSense
- Type hints on hover
- Auto-completion
- Error checking
- Go to definition

### WebStorm/IntelliJ

- Type inference
- Refactoring support
- Code navigation
- Documentation popup

## 📊 Comparison

| Feature             | JavaScript | TypeScript |
| ------------------- | ---------- | ---------- |
| Type safety         | ❌         | ✅         |
| IDE completion      | Partial    | Full       |
| Compile-time errors | ❌         | ✅         |
| Refactoring support | Basic      | Advanced   |
| Documentation       | JSDoc      | Native     |
| Build step required | ❌         | ✅         |
| Bundle size         | Same       | Same       |

## 🚢 Publishing (Optional)

To publish to NPM:

```bash
# Update version in package.json
npm version patch

# Build
npm run build

# Publish
npm publish --access public
```

Then users can install:

```bash
npm install @japanese-maple/bridge
```

## 📝 Migration from JavaScript

If you have existing JavaScript code:

```javascript
// Before (JS)
const result = await recorder.stop();
console.log(result.text);
```

```typescript
// After (TS) - add type annotations
const result: TranscriptionResult = await recorder.stop();
console.log(result.text);
```

The API is identical - just add types!

## 🎓 Learning Resources

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [TypeScript Deep Dive](https://basarat.gitbook.io/typescript/)
- [Full API Documentation](MAPLE_BRIDGE_API.md)

## 📄 License

MIT © 2025 Japanese Maple Team
