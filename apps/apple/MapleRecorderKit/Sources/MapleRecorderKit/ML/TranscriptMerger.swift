import Foundation

struct RawASRSegment: Sendable {
    var text: String
    var start: TimeInterval
    var end: TimeInterval
}

struct RawDiarizationSegment: Sendable {
    var speakerId: String
    var start: TimeInterval
    var end: TimeInterval
}

nonisolated enum TranscriptMerger {

    static func merge(
        asrSegments: [RawASRSegment],
        diarizationSegments: [RawDiarizationSegment]
    ) -> (segments: [TranscriptSegment], speakers: [Speaker]) {
        guard !asrSegments.isEmpty else {
            return (segments: [], speakers: [])
        }

        var speakerIdSet: [String: Int] = [:]
        var rawSegments: [(speakerId: String, text: String, start: TimeInterval, end: TimeInterval)] = []

        for asr in asrSegments {
            let speaker = bestMatchingSpeaker(for: asr, in: diarizationSegments)
            let speakerId = speaker ?? "unknown"

            if speakerIdSet[speakerId] == nil {
                speakerIdSet[speakerId] = speakerIdSet.count
            }

            rawSegments.append((speakerId: speakerId, text: asr.text, start: asr.start, end: asr.end))
        }

        // Coalesce consecutive segments from same speaker with < 1s gap
        var coalesced: [(speakerId: String, text: String, start: TimeInterval, end: TimeInterval)] = []
        for seg in rawSegments {
            if let last = coalesced.last,
               last.speakerId == seg.speakerId,
               seg.start - last.end < 1.0 {
                coalesced[coalesced.count - 1].text += " " + seg.text
                coalesced[coalesced.count - 1].end = seg.end
            } else {
                coalesced.append(seg)
            }
        }

        // Build TranscriptSegments with word-level timing
        let segments = coalesced.map { seg in
            let words = estimateWordTimings(text: seg.text, start: seg.start, end: seg.end)
            return TranscriptSegment(
                speakerId: seg.speakerId,
                start: seg.start,
                end: seg.end,
                text: seg.text,
                words: words
            )
        }

        // Build speakers array sorted by first appearance index
        let sortedSpeakers = speakerIdSet.sorted { $0.value < $1.value }
        let speakerColorNames = ["speaker0", "speaker1", "speaker2", "speaker3",
                                  "speaker4", "speaker5", "speaker6", "speaker7"]
        let speakers = sortedSpeakers.map { (id, index) in
            Speaker(
                id: id,
                displayName: "Speaker \(index + 1)",
                color: speakerColorNames[index % speakerColorNames.count],
                embedding: nil
            )
        }

        return (segments: segments, speakers: speakers)
    }

    // MARK: - Private

    private static func bestMatchingSpeaker(
        for asr: RawASRSegment,
        in diarization: [RawDiarizationSegment]
    ) -> String? {
        var bestOverlap: TimeInterval = 0
        var bestSpeaker: String?

        for dia in diarization {
            let overlapStart = max(asr.start, dia.start)
            let overlapEnd = min(asr.end, dia.end)
            let overlap = max(0, overlapEnd - overlapStart)

            if overlap > bestOverlap {
                bestOverlap = overlap
                bestSpeaker = dia.speakerId
            }
        }

        return bestSpeaker
    }

    static func estimateWordTimings(
        text: String,
        start: TimeInterval,
        end: TimeInterval
    ) -> [WordTiming] {
        let wordsArray = text.split(separator: " ").map(String.init)
        guard !wordsArray.isEmpty else { return [] }

        let duration = end - start
        let totalChars = wordsArray.reduce(0) { $0 + $1.count }
        guard totalChars > 0 else { return [] }

        var timings: [WordTiming] = []
        var currentTime = start

        for word in wordsArray {
            let fraction = Double(word.count) / Double(totalChars)
            let wordDuration = duration * fraction
            let wordEnd = min(currentTime + wordDuration, end)

            timings.append(WordTiming(
                word: word,
                start: currentTime,
                end: wordEnd
            ))

            currentTime = wordEnd
        }

        return timings
    }
}
