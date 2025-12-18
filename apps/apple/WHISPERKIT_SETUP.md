# WhisperKit Integration Guide for JapaneseMaple

This guide shows you how to add real Whisper speech-to-text transcription to JapaneseMaple.

## Current Status

✅ Audio recording working
✅ Native bridge communication working
✅ TranscriptionService prepared for WhisperKit
⏳ WhisperKit package needs to be added

## Step-by-Step Integration

### Step 1: Add WhisperKit Package

1. Open `JapaneseMaple.xcodeproj` in Xcode Beta
2. Go to **File > Add Package Dependencies...**
3. In the search bar, enter: `https://github.com/argmaxinc/WhisperKit`
4. Select **Up to Next Major Version**: `1.0.0` < `2.0.0`
5. Click **Add Package**
6. Make sure **JapaneseMaple** target is checked
7. Click **Add Package** again

### Step 2: Enable WhisperKit in TranscriptionService

Open `TranscriptionService.swift` and make these changes:

1. **Uncomment the import** (line 18):

    ```swift
    import WhisperKit
    ```

2. **Uncomment the property** (line 24):

    ```swift
    private var whisperKit: WhisperKit?
    ```

3. **Replace the mock initialization** (lines 42-64) with the real code:
    - Remove the mock Task.sleep
    - Uncomment the WhisperKit initialization block

4. **Replace the mock transcription** (lines 79-136) with the real code:
    - Uncomment the WhisperKit transcription block
    - Remove the mock Task.sleep and mockTranscription

### Step 3: Build and Test

1. Build the project (Cmd+B)
2. Run the app (Cmd+R)
3. Click the record button
4. Speak into your microphone
5. Click "Stop Recording"
6. Wait for transcription (first run downloads model ~140MB)

## Model Options

WhisperKit supports multiple model sizes. Edit line 48 in `TranscriptionService.swift`:

- `tiny.en` - ~75MB, fastest, decent quality
- **`base.en`** - ~140MB, good balance (recommended)
- `small.en` - ~460MB, better accuracy
- `medium.en` - ~1.5GB, very good quality
- `large-v3` - ~3GB, best quality, supports 99 languages

For hour-long recordings, `base.en` or `small.en` are recommended.

## Model Download

On first run, WhisperKit will automatically download the model:

- The model is cached in ~/Library/Caches/
- Subsequent runs will use the cached model
- No internet required after first download

## Performance Expectations

### base.en model on M1/M2 Mac:

- **Short recordings** (1-5 min): ~10-30 seconds
- **Medium recordings** (10-30 min): ~1-3 minutes
- **Long recordings** (1 hour): ~5-10 minutes

Processing happens in the background - the UI stays responsive.

## Troubleshooting

### Build Errors

- Make sure you're using Xcode Beta
- Clean build folder (Cmd+Shift+K)
- Restart Xcode

### Model Download Fails

- Check internet connection
- Try deleting `~/Library/Caches/WhisperKit/`
- Re-run the app

### Poor Transcription Quality

- Use a better model (`small.en` or `medium.en`)
- Check microphone levels (should see green visualizer)
- Reduce background noise
- Speak clearly and not too fast

## Advanced Configuration

### Change Language

Edit line 96 in `TranscriptionService.swift`:

```swift
language: "es"  // Spanish
language: "fr"  // French
language: "de"  // German
// etc...
```

Note: For non-English, use `large-v3` model (not `.en` models)

### Adjust Decoding Options

Edit lines 93-97:

```swift
decodeOptions: DecodingOptions(
    verbose: true,
    task: .transcribe,  // or .translate for translation
    language: "en",
    temperature: 0.0,   // 0.0 = more deterministic
    compressionRatioThreshold: 2.4
)
```

## Support

- WhisperKit Docs: https://github.com/argmaxinc/WhisperKit
- Whisper.cpp Docs: https://github.com/ggerganov/whisper.cpp
- Open issues in this repo for JapaneseMaple-specific questions
