import Foundation
import Observation

@Observable
final class PlaybackSyncEngine {
    var activeSegmentId: UUID?
    var activeWordId: UUID?
    var shouldAutoScroll: Bool = true

    private var timer: Timer?
    private var player: AudioPlayer?
    private var transcript: [TranscriptSegment] = []
    private var lastManualScrollTime: Date = .distantPast

    func start(player: AudioPlayer, transcript: [TranscriptSegment]) {
        self.player = player
        self.transcript = transcript
        stopTimer()
        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 15.0, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.tick()
            }
        }
    }

    func stop() {
        stopTimer()
        activeSegmentId = nil
        activeWordId = nil
    }

    func userDidScroll() {
        lastManualScrollTime = Date()
        shouldAutoScroll = false
    }

    func seekToWord(_ word: WordTiming) {
        player?.seek(to: word.start)
    }

    // MARK: - Tick Logic (exposed for testing)

    func tick() {
        guard let player else { return }
        let time = player.currentTime

        let (segId, wordId) = findActive(time: time, transcript: transcript)

        // Only update when values actually change to avoid unnecessary SwiftUI re-renders
        if activeSegmentId != segId {
            activeSegmentId = segId
        }
        if activeWordId != wordId {
            activeWordId = wordId
        }

        let autoScroll = Date().timeIntervalSince(lastManualScrollTime) > 3.0
        if shouldAutoScroll != autoScroll {
            shouldAutoScroll = autoScroll
        }
    }

    static func findActive(
        time: TimeInterval,
        transcript: [TranscriptSegment]
    ) -> (segmentId: UUID?, wordId: UUID?) {
        // Binary search for active segment
        guard let segIndex = binarySearchSegment(time: time, segments: transcript) else {
            return (nil, nil)
        }

        let segment = transcript[segIndex]

        // Binary search for active word within segment
        let wordId = binarySearchWord(time: time, words: segment.words)

        return (segment.id, wordId)
    }

    // MARK: - Private

    private func findActive(
        time: TimeInterval,
        transcript: [TranscriptSegment]
    ) -> (segmentId: UUID?, wordId: UUID?) {
        Self.findActive(time: time, transcript: transcript)
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }

    private static func binarySearchSegment(
        time: TimeInterval,
        segments: [TranscriptSegment]
    ) -> Int? {
        var low = 0
        var high = segments.count - 1

        while low <= high {
            let mid = (low + high) / 2
            let seg = segments[mid]

            if time < seg.start {
                high = mid - 1
            } else if time >= seg.end {
                low = mid + 1
            } else {
                return mid
            }
        }

        return nil
    }

    private static func binarySearchWord(
        time: TimeInterval,
        words: [WordTiming]
    ) -> UUID? {
        guard !words.isEmpty else { return nil }

        var result: UUID?
        var low = 0
        var high = words.count - 1

        while low <= high {
            let mid = (low + high) / 2
            if words[mid].start <= time {
                result = words[mid].id
                low = mid + 1
            } else {
                high = mid - 1
            }
        }

        return result
    }
}
