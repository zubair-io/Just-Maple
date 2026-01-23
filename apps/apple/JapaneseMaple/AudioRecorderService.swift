//
//  AudioRecorderService.swift
//  JapaneseMaple
//
//  Created by Zubair Lawrence on 11/30/25.
//

import Foundation
import AVFoundation
import Combine

class AudioRecorderService: NSObject, ObservableObject {
    static let shared = AudioRecorderService()

    private var audioEngine: AVAudioEngine?
    private var audioFile: AVAudioFile?
    private var isRecording = false
    private var recordingStartTime: Date?

    @Published var recordingDuration: TimeInterval = 0
    @Published var audioLevel: Float = 0

    private var levelTimer: Timer?

    struct RecordingResult {
        let path: URL
        let duration: TimeInterval
    }

    enum RecordingError: Error {
        case permissionDenied
        case alreadyRecording
        case notRecording
        case engineStartFailed
        case fileCreationFailed
    }

    override init() {
        super.init()
    }

    // MARK: - Permission

    func requestMicrophonePermission() async -> Bool {
        #if os(macOS)
        return await withCheckedContinuation { continuation in
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                continuation.resume(returning: granted)
            }
        }
        #else
        if #available(iOS 17.0, *) {
            return await withCheckedContinuation { continuation in
                AVAudioApplication.requestRecordPermission { granted in
                    continuation.resume(returning: granted)
                }
            }
        } else {
            return await withCheckedContinuation { continuation in
                AVAudioSession.sharedInstance().requestRecordPermission { granted in
                    continuation.resume(returning: granted)
                }
            }
        }
        #endif
    }

    // MARK: - Recording

    func startRecording() async throws -> URL {
        // Check if already recording
        guard !isRecording else {
            throw RecordingError.alreadyRecording
        }

        // Configure audio session for recording (iOS only)
        #if os(iOS)
        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
            try audioSession.setActive(true)
        } catch {
            print("[AudioRecorder] Failed to configure audio session: \(error)")
            throw RecordingError.engineStartFailed
        }
        #endif

        // Request permission
        let hasPermission = await requestMicrophonePermission()
        guard hasPermission else {
            throw RecordingError.permissionDenied
        }

        // Setup audio engine
        let audioEngine = AVAudioEngine()
        let inputNode = audioEngine.inputNode
        let format = inputNode.outputFormat(forBus: 0)

        // Create output file
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let recordingsDir = documentsPath.appendingPathComponent("Recordings")

        // Create directory if needed
        try FileManager.default.createDirectory(at: recordingsDir, withIntermediateDirectories: true)

        let fileName = "recording_\(Date().timeIntervalSince1970).m4a"
        let filePath = recordingsDir.appendingPathComponent(fileName)

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

        self.audioFile = audioFile

        // Install tap for recording and level metering
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            // Write to file
            try? audioFile.write(from: buffer)

            // Calculate and update audio level
            let level = self?.calculateLevel(buffer: buffer) ?? 0
            DispatchQueue.main.async {
                self?.audioLevel = level
            }
        }

        // Start the engine
        do {
            try audioEngine.start()
        } catch {
            inputNode.removeTap(onBus: 0)
            throw RecordingError.engineStartFailed
        }

        self.audioEngine = audioEngine
        self.isRecording = true
        self.recordingStartTime = Date()

        // Start duration timer
        startDurationTimer()

        print("[AudioRecorder] Started recording to: \(filePath.path)")
        return filePath
    }

    func stopRecording() async throws -> RecordingResult {
        guard isRecording else {
            throw RecordingError.notRecording
        }

        // Stop the engine
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)

        // Calculate duration
        let duration = Date().timeIntervalSince(recordingStartTime ?? Date())

        // Get file path
        guard let filePath = audioFile?.url else {
            throw RecordingError.fileCreationFailed
        }

        // Cleanup
        audioFile = nil
        audioEngine = nil
        isRecording = false
        recordingStartTime = nil

        // Stop timer
        stopDurationTimer()

        // Deactivate audio session (iOS only)
        #if os(iOS)
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            print("[AudioRecorder] Failed to deactivate audio session: \(error)")
        }
        #endif

        print("[AudioRecorder] Stopped recording. Duration: \(duration)s, Path: \(filePath.path)")

        return RecordingResult(path: filePath, duration: duration)
    }

    func cancelRecording() async {
        if isRecording {
            audioEngine?.stop()
            audioEngine?.inputNode.removeTap(onBus: 0)

            // Delete the file
            if let filePath = audioFile?.url {
                try? FileManager.default.removeItem(at: filePath)
                print("[AudioRecorder] Cancelled and deleted recording: \(filePath.path)")
            }

            audioFile = nil
            audioEngine = nil
            isRecording = false
            recordingStartTime = nil

            stopDurationTimer()

            // Deactivate audio session (iOS only)
            #if os(iOS)
            do {
                try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            } catch {
                print("[AudioRecorder] Failed to deactivate audio session: \(error)")
            }
            #endif
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
            self.audioLevel = 0
        }
    }
}
