//
//  MultiTrackRecorder.swift
//  JapaneseMaple
//
//  Multi-track audio recorder that captures both system audio and microphone
//  separately, maintaining synchronized timestamps for speaker diarization.
//

#if os(macOS)

import Foundation
import AVFoundation
import Combine
import ScreenCaptureKit

@available(macOS 13.0, *)
class MultiTrackRecorder: NSObject, ObservableObject {
    static let shared = MultiTrackRecorder()

    // Audio engines for microphone
    private var micAudioEngine: AVAudioEngine?
    private var micAudioFile: AVAudioFile?

    // Screen capture stream for system audio
    private var screenCaptureStream: SCStream?
    private var systemAudioFile: AVAudioFile?
    private var systemAudioEngine: AVAudioEngine?

    // Recording state
    private var isRecording = false
    private var recordingStartTime: Date?
    private var micFilePath: URL?
    private var systemFilePath: URL?

    // Published properties
    @Published var recordingDuration: TimeInterval = 0
    @Published var micAudioLevel: Float = 0
    @Published var systemAudioLevel: Float = 0

    private var levelTimer: Timer?

    struct MultiTrackResult {
        let micPath: URL
        let systemPath: URL?  // nil when system audio not captured
        let duration: TimeInterval
        let startTime: Date
        let includesSystemAudio: Bool
    }

    enum RecordingError: Error {
        case permissionDenied
        case alreadyRecording
        case notRecording
        case engineStartFailed
        case fileCreationFailed
        case screenCaptureNotAvailable
        case noDisplaysFound
    }

    override init() {
        super.init()
    }

    // MARK: - Permission

    func requestPermissions(includeSystemAudio: Bool = false) async -> Bool {
        // Request microphone permission
        let micPermission = await requestMicrophonePermission()

        if !micPermission {
            return false
        }

        // Only request screen recording permission if system audio is needed
        if includeSystemAudio {
            let screenPermission = await requestScreenRecordingPermission()
            return screenPermission
        }

        return true
    }

    private func requestMicrophonePermission() async -> Bool {
        return await withCheckedContinuation { continuation in
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    private func requestScreenRecordingPermission() async -> Bool {
        do {
            // Requesting available content will trigger permission prompt if needed
            _ = try await SCShareableContent.excludingDesktopWindows(
                false,
                onScreenWindowsOnly: true
            )
            return true
        } catch {
            print("[MultiTrackRecorder] Screen recording permission error: \(error)")
            return false
        }
    }

    // Track whether current recording includes system audio
    private var currentRecordingIncludesSystemAudio = false

    // MARK: - Recording

    func startRecording(includeSystemAudio: Bool = false) async throws -> (micPath: URL, systemPath: URL?) {
        guard !isRecording else {
            throw RecordingError.alreadyRecording
        }

        currentRecordingIncludesSystemAudio = includeSystemAudio

        // Request permissions (only request screen capture if system audio needed)
        let hasPermissions = await requestPermissions(includeSystemAudio: includeSystemAudio)
        guard hasPermissions else {
            throw RecordingError.permissionDenied
        }

        // Create recordings directory
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let recordingsDir = documentsPath.appendingPathComponent("Recordings")
        try FileManager.default.createDirectory(at: recordingsDir, withIntermediateDirectories: true)

        let timestamp = Date().timeIntervalSince1970
        let micFileName = "mic_\(timestamp).m4a"

        micFilePath = recordingsDir.appendingPathComponent(micFileName)

        // Start microphone recording
        try await startMicrophoneRecording(to: micFilePath!)

        // Only start system audio recording if requested
        if includeSystemAudio {
            let systemFileName = "system_\(timestamp).m4a"
            systemFilePath = recordingsDir.appendingPathComponent(systemFileName)
            try await startSystemAudioRecording(to: systemFilePath!)
            print("  System: \(systemFilePath!.path)")
        } else {
            systemFilePath = nil
        }

        // Mark as recording
        isRecording = true
        recordingStartTime = Date()

        // Start duration timer
        startDurationTimer()

        print("[MultiTrackRecorder] Started recording (system audio: \(includeSystemAudio))")
        print("  Mic: \(micFilePath!.path)")

        return (micFilePath!, systemFilePath)
    }

    private func startMicrophoneRecording(to filePath: URL) async throws {
        let audioEngine = AVAudioEngine()
        let inputNode = audioEngine.inputNode
        let format = inputNode.outputFormat(forBus: 0)

        // Create audio file with AAC format
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 44100.0,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ]

        guard let audioFile = try? AVAudioFile(forWriting: filePath, settings: settings) else {
            throw RecordingError.fileCreationFailed
        }

        self.micAudioFile = audioFile

        // Install tap for recording and level metering
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            try? audioFile.write(from: buffer)

            // Calculate and update audio level
            let level = self?.calculateLevel(buffer: buffer) ?? 0
            DispatchQueue.main.async {
                self?.micAudioLevel = level
            }
        }

        // Start the engine
        do {
            try audioEngine.start()
        } catch {
            inputNode.removeTap(onBus: 0)
            throw RecordingError.engineStartFailed
        }

        self.micAudioEngine = audioEngine
    }

    private func startSystemAudioRecording(to filePath: URL) async throws {
        // Get available content
        let content = try await SCShareableContent.excludingDesktopWindows(
            false,
            onScreenWindowsOnly: true
        )

        guard let display = content.displays.first else {
            throw RecordingError.noDisplaysFound
        }

        // Configure stream to capture system audio only (no video)
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.sampleRate = 44100
        config.channelCount = 2

        // Exclude all windows - we only want audio
        config.excludesCurrentProcessAudio = false

        // Create filter to capture display audio
        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])

        // Create the stream
        let stream = SCStream(filter: filter, configuration: config, delegate: self)

        // Create audio file
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 44100.0,
            AVNumberOfChannelsKey: 2,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ]

        guard let audioFile = try? AVAudioFile(forWriting: filePath, settings: settings) else {
            throw RecordingError.fileCreationFailed
        }

        self.systemAudioFile = audioFile

        // Add audio output
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: DispatchQueue(label: "com.japaneseMaple.audioCapture"))

        // Start capture
        try await stream.startCapture()

        self.screenCaptureStream = stream
    }

    func stopRecording() async throws -> MultiTrackResult {
        guard isRecording else {
            throw RecordingError.notRecording
        }

        // Calculate duration
        let duration = Date().timeIntervalSince(recordingStartTime ?? Date())
        let startTime = recordingStartTime!
        let includesSystemAudio = currentRecordingIncludesSystemAudio

        // Stop microphone recording
        micAudioEngine?.stop()
        micAudioEngine?.inputNode.removeTap(onBus: 0)
        micAudioEngine = nil
        micAudioFile = nil

        // Stop system audio recording (only if it was started)
        if includesSystemAudio {
            if let stream = screenCaptureStream {
                try await stream.stopCapture()
                screenCaptureStream = nil
            }
            systemAudioFile = nil
        }

        // Get file paths
        guard let micPath = micFilePath else {
            throw RecordingError.fileCreationFailed
        }

        let systemPath = systemFilePath  // Can be nil if system audio wasn't recorded

        // Cleanup state
        isRecording = false
        recordingStartTime = nil
        micFilePath = nil
        systemFilePath = nil
        currentRecordingIncludesSystemAudio = false

        // Stop timer
        stopDurationTimer()

        print("[MultiTrackRecorder] Stopped recording. Duration: \(duration)s, System audio: \(includesSystemAudio)")

        return MultiTrackResult(
            micPath: micPath,
            systemPath: systemPath,
            duration: duration,
            startTime: startTime,
            includesSystemAudio: includesSystemAudio
        )
    }

    func cancelRecording() async {
        if isRecording {
            // Stop engines
            micAudioEngine?.stop()
            micAudioEngine?.inputNode.removeTap(onBus: 0)
            micAudioEngine = nil

            // Only stop screen capture if it was started
            if currentRecordingIncludesSystemAudio {
                if let stream = screenCaptureStream {
                    try? await stream.stopCapture()
                    screenCaptureStream = nil
                }
            }

            // Delete files
            if let micPath = micFilePath {
                try? FileManager.default.removeItem(at: micPath)
                print("[MultiTrackRecorder] Deleted mic recording: \(micPath.path)")
            }

            if let systemPath = systemFilePath {
                try? FileManager.default.removeItem(at: systemPath)
                print("[MultiTrackRecorder] Deleted system recording: \(systemPath.path)")
            }

            // Cleanup
            micAudioFile = nil
            systemAudioFile = nil
            isRecording = false
            recordingStartTime = nil
            micFilePath = nil
            systemFilePath = nil
            currentRecordingIncludesSystemAudio = false

            stopDurationTimer()
        }
    }

    // MARK: - Helpers

    private func calculateLevel(buffer: AVAudioPCMBuffer) -> Float {
        guard let channelData = buffer.floatChannelData?[0] else { return 0 }
        let frameLength = Int(buffer.frameLength)

        var sum: Float = 0
        for i in 0..<frameLength {
            sum += channelData[i] * channelData[i]
        }

        let rms = sqrt(sum / Float(frameLength))
        let db = 20 * log10(rms)

        // Normalize to 0-1 range (assuming -60db to 0db range)
        return max(0, min(1, (db + 60) / 60))
    }

    private func startDurationTimer() {
        levelTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            guard let self = self, let startTime = self.recordingStartTime else { return }
            DispatchQueue.main.async {
                self.recordingDuration = Date().timeIntervalSince(startTime)
            }
        }
    }

    private func stopDurationTimer() {
        levelTimer?.invalidate()
        levelTimer = nil
        DispatchQueue.main.async {
            self.recordingDuration = 0
            self.micAudioLevel = 0
            self.systemAudioLevel = 0
        }
    }
}

// MARK: - SCStreamDelegate

@available(macOS 13.0, *)
extension MultiTrackRecorder: SCStreamDelegate {
    func stream(_ stream: SCStream, didStopWithError error: Error) {
        print("[MultiTrackRecorder] Stream stopped with error: \(error)")
    }
}

// MARK: - SCStreamOutput

@available(macOS 13.0, *)
extension MultiTrackRecorder: SCStreamOutput {
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio else { return }

        // Convert CMSampleBuffer to AVAudioPCMBuffer and write to file
        guard let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer) else { return }
        guard let audioStreamBasicDescription = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription) else { return }

        let format = AVAudioFormat(streamDescription: audioStreamBasicDescription)

        guard let buffer = createPCMBuffer(from: sampleBuffer, format: format) else { return }

        // Write to file
        if let audioFile = systemAudioFile {
            try? audioFile.write(from: buffer)
        }

        // Calculate level for system audio
        let level = calculateLevel(buffer: buffer)
        DispatchQueue.main.async {
            self.systemAudioLevel = level
        }
    }

    private func createPCMBuffer(from sampleBuffer: CMSampleBuffer, format: AVAudioFormat?) -> AVAudioPCMBuffer? {
        guard let format = format else { return nil }

        let numSamples = CMSampleBufferGetNumSamples(sampleBuffer)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(numSamples)) else {
            return nil
        }
        buffer.frameLength = buffer.frameCapacity

        // Get audio buffer list
        var audioBufferList = AudioBufferList()
        var blockBuffer: CMBlockBuffer?

        CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: &audioBufferList,
            bufferListSize: MemoryLayout<AudioBufferList>.size,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: 0,
            blockBufferOut: &blockBuffer
        )

        // Copy data to PCM buffer
        let channels = Int(format.channelCount)
        for channel in 0..<channels {
            if let channelData = buffer.floatChannelData?[channel],
               let sourceData = audioBufferList.mBuffers.mData {
                let sourceFloatData = sourceData.assumingMemoryBound(to: Float.self)
                channelData.update(from: sourceFloatData, count: numSamples)
            }
        }

        return buffer
    }
}

#endif // os(macOS)
