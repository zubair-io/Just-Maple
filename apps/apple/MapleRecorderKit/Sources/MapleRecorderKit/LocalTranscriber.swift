import Foundation
import FluidAudio

/// Timed speech shared with Just Maple's existing web recording bridge.
public nonisolated struct LocalSpeechSegment: Sendable {
    public let text: String
    public let start: TimeInterval
    public let end: TimeInterval
}

public actor LocalTranscriber {
    private let manager = TranscriptionManager()
    private var initialization: Task<Void, Error>?

    public init() {}

    public func initialize() async throws {
        if let initialization {
            return try await initialization.value
        }
        let task = Task { try await manager.initialize() }
        initialization = task
        do { try await task.value }
        catch {
            initialization = nil
            throw error
        }
    }

    public func transcribeText(_ url: URL) async throws -> String {
        let (result, _) = try await recognize(url)
        return result.text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func recognize(_ url: URL) async throws -> (ASRResult, TimeInterval) {
        try await initialize()
        let samples = try await Task.detached {
            try MapleAudioConverter.loadAndResample(url: url)
        }.value
        return (try await manager.transcribe(samples), Double(samples.count) / 16_000)
    }

    public func transcribe(_ url: URL) async throws -> [LocalSpeechSegment] {
        let (result, duration) = try await recognize(url)
        guard let timings = result.tokenTimings, !timings.isEmpty else {
            return [LocalSpeechSegment(text: result.text, start: 0, end: duration)]
        }
        return Self.sentences(tokens: timings.map { ($0.token, $0.startTime, $0.endTime) })
    }

    // ASR timings contain subword tokens. Preserve their boundaries when joining;
    // inserting a space between each token would split words in the bridge output.
    nonisolated static func sentences(tokens: [(String, TimeInterval, TimeInterval)]) -> [LocalSpeechSegment] {
        var segments: [LocalSpeechSegment] = []
        var text = ""
        var start: TimeInterval = 0
        var end: TimeInterval = 0
        func flush() {
            let sentence = text.replacingOccurrences(of: "▁", with: " ")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !sentence.isEmpty {
                segments.append(LocalSpeechSegment(text: sentence, start: start, end: end))
            }
            text = ""
        }
        for (token, tokenStart, tokenEnd) in tokens {
            guard !token.isEmpty, token != "<blank>", token != "<pad>" else { continue }
            if text.isEmpty { start = tokenStart }
            text += token
            end = tokenEnd
            if let last = token.trimmingCharacters(in: .whitespacesAndNewlines).last,
               ".!?".contains(last) { flush() }
        }
        flush()
        return segments
    }
}
