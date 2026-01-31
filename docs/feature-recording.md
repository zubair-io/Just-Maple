# Voice Recording

Just Maple lets you capture audio directly in your notes. Record voice memos, interviews, lectures, or any audio content alongside your written notes.

## Getting Started

### Creating a Recording

1. Open a notebook
2. Click the **+** button and select "Recording"
3. Or use the command palette: `Cmd/Ctrl + K` then "new recording"

### Recording Interface

- **Record button** - Start/stop recording
- **Waveform display** - Visual audio levels
- **Timer** - Elapsed recording time
- **Controls** - Pause, resume, finish

## Recording Audio

### Start Recording

1. Click the red record button
2. Grant microphone permission if prompted
3. Speak clearly - audio levels show in real-time

### Recording States

| State     | Icon         | Description              |
| --------- | ------------ | ------------------------ |
| Empty     | Gray circle  | No recording yet         |
| Recording | Red pulse    | Actively capturing audio |
| Paused    | Yellow pause | Temporarily stopped      |
| Uploading | Spinner      | Sending to server        |
| Complete  | Green check  | Recording saved          |

### Pause & Resume

- Click pause to temporarily stop
- Resume to continue in the same recording
- Useful for breaks during long sessions

### Finish Recording

- Click the stop button to complete
- Recording uploads to your server
- Transcription begins automatically (if enabled)

## Multi-Track Recording (Desktop)

On macOS, capture multiple audio sources:

### Available Sources

- **Microphone** - Your voice
- **System audio** - Computer sounds, calls

### Setting Up Multi-Track

1. Open recording settings
2. Enable "System audio" capture
3. Grant necessary permissions
4. Tracks are synchronized in playback

## Playback

### Playing Recordings

1. Open a recording page
2. Click the play button
3. Use the progress bar to seek

### Playback Controls

- **Play/Pause** - Toggle playback
- **Seek** - Click or drag the timeline
- **Speed** - 0.5x, 1x, 1.5x, 2x
- **Volume** - Adjust audio level

### With Transcript

If transcription is available:

- Words highlight as audio plays
- Click any word to jump to that moment
- Search within the transcript

## Storage & Upload

### Automatic Upload

Recordings upload automatically when completed:

1. Audio captured locally
2. Compressed and uploaded to server storage
3. URL saved to recording metadata
4. Original cleared from device

### Upload Progress

- See upload percentage during transfer
- Retry button if upload fails
- Recording saved locally until successful

### Storage Location

- Audio files stored on your server
- Accessible from any synced device
- Backed up with your server's backup strategy

## Native App Features

### iOS/macOS

- **WhisperKit integration** - On-device transcription
- **Background recording** - Continue recording while using other apps
- **Quick capture** - Start recording from control center or menu bar
- **System audio** - Capture computer audio (macOS)

### Privacy

- Audio processing happens on-device
- Raw audio only sent to your server
- No third-party services by default

## Tips & Best Practices

### Recording Quality

- Use a quiet environment
- Position microphone appropriately
- Test levels before important recordings

### Organizing Recordings

- Give recordings descriptive titles
- Use notebooks for topic grouping
- Add notes alongside recordings

### Storage Considerations

- Audio files can be large
- Compress/delete old recordings
- Monitor server storage usage

## Related Documentation

- [Transcription](./feature-transcription.md) - AI-powered transcription
- [Notebooks](./feature-notebooks.md) - Organizing recordings
- [Search](./feature-search.md) - Finding recordings
- [Engineering: Recording](./eng-recording.md) - Technical implementation
