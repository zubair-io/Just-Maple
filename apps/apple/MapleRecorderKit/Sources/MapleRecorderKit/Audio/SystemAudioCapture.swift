#if os(macOS)
import AVFoundation
import Foundation
import Observation
import ScreenCaptureKit

@Observable
final class SystemAudioCapture: NSObject, @unchecked Sendable, SCStreamDelegate {
    var isCapturing = false
    var permissionGranted = false

    private var stream: SCStream?
    private var streamOutput: AudioStreamOutput?
    private(set) var audioFormat: AVAudioFormat?
    private let sampleQueue = DispatchQueue(label: "com.maple.systemAudioCapture", qos: .userInteractive)

    /// Callback invoked on each captured audio buffer
    var onAudioBuffer: ((AVAudioPCMBuffer) -> Void)?

    /// Called when the stream encounters a fatal error (disconnect, permission revoked, etc.)
    var onStreamError: ((Error) -> Void)?

    // Reconnection state
    private var isReconnecting = false
    private var reconnectAttempts = 0
    private static let maxReconnectAttempts = 3
    private static let reconnectDelay: TimeInterval = 1.0

    func checkPermission() async {
        do {
            // Requesting shareable content checks/triggers the permission prompt
            _ = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            permissionGranted = true
        } catch {
            permissionGranted = false
        }
    }

    func startCapture() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)

        guard let display = content.displays.first else {
            throw SystemAudioCaptureError.noDisplay
        }

        // Audio-only: exclude all windows and apps from video capture
        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])

        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        // No video capture needed
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)

        // Audio format: 48kHz mono to match our recording pipeline
        config.sampleRate = 48000
        config.channelCount = 1

        let output = AudioStreamOutput { [weak self] buffer in
            if self?.audioFormat == nil {
                self?.audioFormat = buffer.format
            }
            self?.onAudioBuffer?(buffer)
        }
        self.streamOutput = output

        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream.addStreamOutput(output, type: .audio, sampleHandlerQueue: sampleQueue)
        try await stream.startCapture()

        self.stream = stream
        self.isCapturing = true
        self.reconnectAttempts = 0
    }

    func stopCapture() async {
        isReconnecting = false
        if let stream {
            try? await stream.stopCapture()
        }
        stream = nil
        streamOutput = nil
        isCapturing = false
    }

    // MARK: - SCStreamDelegate

    nonisolated func stream(_ stream: SCStream, didStopWithError error: Error) {
        print("[SystemAudioCapture] Stream stopped with error: \(error.localizedDescription)")
        Task { @MainActor [weak self] in
            guard let self, self.isCapturing, !self.isReconnecting else { return }
            self.isCapturing = false
            await self.attemptReconnect()
        }
    }

    @MainActor
    private func attemptReconnect() async {
        guard reconnectAttempts < Self.maxReconnectAttempts else {
            print("[SystemAudioCapture] Max reconnect attempts reached, giving up")
            onStreamError?(SystemAudioCaptureError.streamDisconnected)
            return
        }

        isReconnecting = true
        reconnectAttempts += 1
        print("[SystemAudioCapture] Attempting reconnect (\(reconnectAttempts)/\(Self.maxReconnectAttempts))...")

        // Brief delay before reconnecting
        try? await Task.sleep(for: .seconds(Self.reconnectDelay))
        guard isReconnecting else { return } // stopCapture was called during delay

        // Clean up old stream
        stream = nil
        streamOutput = nil

        do {
            try await startCapture()
            print("[SystemAudioCapture] Reconnected successfully")
            isReconnecting = false
        } catch {
            print("[SystemAudioCapture] Reconnect failed: \(error.localizedDescription)")
            isReconnecting = false
            await attemptReconnect()
        }
    }
}

// MARK: - Stream Output

private final class AudioStreamOutput: NSObject, SCStreamOutput, Sendable {
    let handler: @Sendable (AVAudioPCMBuffer) -> Void

    init(handler: @escaping @Sendable (AVAudioPCMBuffer) -> Void) {
        self.handler = handler
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio else { return }
        guard sampleBuffer.isValid, sampleBuffer.numSamples > 0 else { return }

        guard let formatDescription = sampleBuffer.formatDescription,
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription) else {
            return
        }

        let audioFormat = AVAudioFormat(streamDescription: asbd)
        guard let audioFormat else { return }

        guard let blockBuffer = sampleBuffer.dataBuffer else { return }
        let frameCount = AVAudioFrameCount(sampleBuffer.numSamples)

        guard let pcmBuffer = AVAudioPCMBuffer(pcmFormat: audioFormat, frameCapacity: frameCount) else {
            return
        }
        pcmBuffer.frameLength = frameCount

        var dataPointer: UnsafeMutablePointer<Int8>?
        var totalLength: Int = 0
        let status = CMBlockBufferGetDataPointer(blockBuffer, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &totalLength, dataPointerOut: &dataPointer)

        guard status == kCMBlockBufferNoErr, let dataPointer else { return }

        let byteCount = min(totalLength, Int(frameCount) * Int(audioFormat.streamDescription.pointee.mBytesPerFrame))
        if let channelData = pcmBuffer.floatChannelData {
            memcpy(channelData[0], dataPointer, byteCount)
        } else if let int16Data = pcmBuffer.int16ChannelData {
            memcpy(int16Data[0], dataPointer, byteCount)
        }

        handler(pcmBuffer)
    }
}

// MARK: - Errors

enum SystemAudioCaptureError: LocalizedError {
    case noDisplay
    case permissionDenied
    case streamDisconnected

    var errorDescription: String? {
        switch self {
        case .noDisplay: "No display found for audio capture."
        case .permissionDenied: "Screen Recording permission is required to capture system audio."
        case .streamDisconnected: "System audio stream disconnected and could not reconnect."
        }
    }
}
#endif
