//
//  TranscriptionService.swift
//  JapaneseMaple
//
//  Created by Zubair Lawrence on 11/30/25.
//

import Foundation
import AVFoundation

// IMPORTANT: Add WhisperKit package to your project:
// 1. In Xcode: File > Add Package Dependencies
// 2. Enter URL: https://github.com/argmaxinc/WhisperKit
// 3. Choose version: Up to Next Major (1.0.0 < 2.0.0)
// 4. Add to target: JapaneseMaple

import WhisperKit

class TranscriptionService {
    static let shared = TranscriptionService()

    private var whisperKit: WhisperKit?
    private var isInitialized = false

    enum TranscriptionError: Error {
        case modelNotFound
        case initializationFailed
        case audioConversionFailed
        case transcriptionFailed
    }

    private init() {}

    // Initialize WhisperKit with a model
    func initialize() async throws {
        guard !isInitialized else { return }

        print("[Transcription] Initializing WhisperKit...")

        do {
            // Initialize WhisperKit with base.en model
            // This will download the model on first run (~140MB)
            whisperKit = try await WhisperKit(
                computeOptions: ModelComputeOptions(),
                verbose: true,
                logLevel: .debug,
                prewarm: true,
                load: true,
                download: true
            )

            isInitialized = true
            print("[Transcription] WhisperKit initialized successfully")
        } catch {
            print("[Transcription] Failed to initialize: \(error)")
            throw TranscriptionError.initializationFailed
        }
    }

    // Transcribe audio file
    func transcribe(audioFileURL: URL, onProgress: ((String) -> Void)? = nil) async throws -> String {
        print("[Transcription] Starting transcription for: \(audioFileURL.path)")

        // Initialize if needed
        if !isInitialized {
            onProgress?("Initializing Whisper model...")
            try await initialize()
        }

        onProgress?("Processing audio...")

        guard let whisperKit = whisperKit else {
            throw TranscriptionError.initializationFailed
        }

        // Convert audio to format suitable for Whisper (16kHz mono)
        let processedURL = try convertAudioForWhisper(sourceURL: audioFileURL)

        onProgress?("Transcribing...")

        // Transcribe with progress callback
        let results = try await whisperKit.transcribe(
            audioPath: processedURL.path,
            decodeOptions: DecodingOptions(
                verbose: true,
                task: .transcribe,
                language: "en"
            )
        )

        // Get the transcription text
        guard let result = results.first else {
            throw TranscriptionError.transcriptionFailed
        }

        let fullText = result.text.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)

        print("[Transcription] Completed: \(fullText)")
        return fullText
    }

    // MARK: - Multi-Track Transcription

    struct TranscriptSegment: Codable {
        let speaker: Speaker
        let text: String
        let startTime: TimeInterval
        let endTime: TimeInterval

        enum Speaker: String, Codable {
            case microphone = "You"
            case system = "Other"
        }
    }

    struct MultiTrackTranscription: Codable {
        let segments: [TranscriptSegment]
        let duration: TimeInterval

        func toFormattedText() -> String {
            var output = ""
            for segment in segments {
                let timestamp = formatTime(segment.startTime)
                output += "[\(timestamp)] \(segment.speaker.rawValue): \(segment.text)\n"
            }
            return output
        }

        private func formatTime(_ time: TimeInterval) -> String {
            let minutes = Int(time) / 60
            let seconds = Int(time) % 60
            return String(format: "%02d:%02d", minutes, seconds)
        }
    }

    /// Transcribe both microphone and system audio tracks, then merge them chronologically
    func transcribeMultiTrack(
        micAudioURL: URL,
        systemAudioURL: URL,
        startTime: Date,
        onProgress: ((String) -> Void)? = nil
    ) async throws -> MultiTrackTranscription {
        print("[Transcription] Starting multi-track transcription")
        print("  Mic: \(micAudioURL.path)")
        print("  System: \(systemAudioURL.path)")

        // Initialize if needed
        if !isInitialized {
            onProgress?("Initializing Whisper model...")
            try await initialize()
        }

        guard let whisperKit = whisperKit else {
            throw TranscriptionError.initializationFailed
        }

        var allSegments: [TranscriptSegment] = []

        // Transcribe microphone track
        onProgress?("Transcribing microphone...")
        do {
            let micProcessedURL = try convertAudioForWhisper(sourceURL: micAudioURL)
            let micResults = try await whisperKit.transcribe(
                audioPath: micProcessedURL.path,
                decodeOptions: DecodingOptions(
                    verbose: true,
                    task: .transcribe,
                    language: "en",
                    wordTimestamps: true  // Enable word-level timestamps
                )
            )

            if let result = micResults.first {
                // Extract segments with timestamps
                for segment in result.segments {
                    allSegments.append(TranscriptSegment(
                        speaker: .microphone,
                        text: segment.text.trimmingCharacters(in: .whitespacesAndNewlines),
                        startTime: TimeInterval(segment.start),
                        endTime: TimeInterval(segment.end)
                    ))
                }
            }
        } catch {
            print("[Transcription] Mic transcription error: \(error)")
        }

        // Transcribe system audio track
        onProgress?("Transcribing system audio...")
        do {
            let systemProcessedURL = try convertAudioForWhisper(sourceURL: systemAudioURL)
            let systemResults = try await whisperKit.transcribe(
                audioPath: systemProcessedURL.path,
                decodeOptions: DecodingOptions(
                    verbose: true,
                    task: .transcribe,
                    language: "en",
                    wordTimestamps: true  // Enable word-level timestamps
                )
            )

            if let result = systemResults.first {
                // Extract segments with timestamps
                for segment in result.segments {
                    allSegments.append(TranscriptSegment(
                        speaker: .system,
                        text: segment.text.trimmingCharacters(in: .whitespacesAndNewlines),
                        startTime: TimeInterval(segment.start),
                        endTime: TimeInterval(segment.end)
                    ))
                }
            }
        } catch {
            print("[Transcription] System audio transcription error: \(error)")
        }

        // Sort segments chronologically by start time
        allSegments.sort { $0.startTime < $1.startTime }

        // Calculate total duration
        let duration = allSegments.last?.endTime ?? 0

        onProgress?("Merging transcriptions...")

        let transcription = MultiTrackTranscription(
            segments: allSegments,
            duration: duration
        )

        print("[Transcription] Multi-track completed with \(allSegments.count) segments")
        return transcription
    }

    // Convert audio to 16kHz mono WAV for Whisper
    private func convertAudioForWhisper(sourceURL: URL) throws -> URL {
        print("[Transcription] Converting audio to Whisper format...")

        let audioFile = try AVAudioFile(forReading: sourceURL)

        // Whisper expects 16kHz mono PCM
        guard let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: 16000,
            channels: 1,
            interleaved: false
        ) else {
            throw TranscriptionError.audioConversionFailed
        }

        guard let converter = AVAudioConverter(
            from: audioFile.processingFormat,
            to: format
        ) else {
            throw TranscriptionError.audioConversionFailed
        }

        // Output to temp directory
        let outputURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(sourceURL.deletingPathExtension().lastPathComponent)
            .appendingPathExtension("wav")

        let outputFile = try AVAudioFile(
            forWriting: outputURL,
            settings: format.settings,
            commonFormat: .pcmFormatFloat32,
            interleaved: false
        )

        // Read entire file
        let frameCount = AVAudioFrameCount(audioFile.length)
        guard let inputBuffer = AVAudioPCMBuffer(
            pcmFormat: audioFile.processingFormat,
            frameCapacity: frameCount
        ) else {
            throw TranscriptionError.audioConversionFailed
        }

        try audioFile.read(into: inputBuffer)

        // Convert
        let ratio = 16000.0 / audioFile.processingFormat.sampleRate
        let outputFrameCount = AVAudioFrameCount(Double(frameCount) * ratio)

        guard let outputBuffer = AVAudioPCMBuffer(
            pcmFormat: format,
            frameCapacity: outputFrameCount
        ) else {
            throw TranscriptionError.audioConversionFailed
        }

        var error: NSError?
        let status = converter.convert(to: outputBuffer, error: &error) { _, outStatus in
            outStatus.pointee = .haveData
            return inputBuffer
        }

        if let error = error {
            throw error
        }

        guard status != .error else {
            throw TranscriptionError.audioConversionFailed
        }

        try outputFile.write(from: outputBuffer)

        print("[Transcription] Audio converted to: \(outputURL.path)")
        return outputURL
    }
}
