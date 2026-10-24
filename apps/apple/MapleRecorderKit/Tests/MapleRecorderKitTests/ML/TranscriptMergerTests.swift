import Foundation
import Testing
@testable import MapleRecorderKit

struct TranscriptMergerTests {

    @Test func testSingleSpeaker() {
        let asr = [
            RawASRSegment(text: "Hello world", start: 0.0, end: 2.0)
        ]
        let dia = [
            RawDiarizationSegment(speakerId: "spk_0", start: 0.0, end: 2.0)
        ]

        let result = TranscriptMerger.merge(asrSegments: asr, diarizationSegments: dia)

        #expect(result.segments.count == 1)
        #expect(result.segments[0].speakerId == "spk_0")
        #expect(result.segments[0].text == "Hello world")
        #expect(result.speakers.count == 1)
        #expect(result.speakers[0].displayName == "Speaker 1")
    }

    @Test func testTwoSpeakers() {
        let asr = [
            RawASRSegment(text: "Hello there", start: 0.0, end: 2.0),
            RawASRSegment(text: "Hi back", start: 2.5, end: 4.0),
        ]
        let dia = [
            RawDiarizationSegment(speakerId: "spk_0", start: 0.0, end: 2.2),
            RawDiarizationSegment(speakerId: "spk_1", start: 2.3, end: 4.5),
        ]

        let result = TranscriptMerger.merge(asrSegments: asr, diarizationSegments: dia)

        #expect(result.segments.count == 2)
        #expect(result.segments[0].speakerId == "spk_0")
        #expect(result.segments[1].speakerId == "spk_1")
        #expect(result.speakers.count == 2)
        #expect(result.speakers[0].displayName == "Speaker 1")
        #expect(result.speakers[1].displayName == "Speaker 2")
    }

    @Test func testSameSpeakerCoalescing() {
        let asr = [
            RawASRSegment(text: "First part", start: 0.0, end: 1.5),
            RawASRSegment(text: "second part", start: 1.8, end: 3.0), // < 1s gap
            RawASRSegment(text: "third part", start: 5.0, end: 6.0), // > 1s gap
        ]
        let dia = [
            RawDiarizationSegment(speakerId: "spk_0", start: 0.0, end: 6.0)
        ]

        let result = TranscriptMerger.merge(asrSegments: asr, diarizationSegments: dia)

        // First two should coalesce, third should be separate
        #expect(result.segments.count == 2)
        #expect(result.segments[0].text == "First part second part")
        #expect(result.segments[0].start == 0.0)
        #expect(result.segments[0].end == 3.0)
        #expect(result.segments[1].text == "third part")
    }

    @Test func testWordTimingEstimation() {
        let words = TranscriptMerger.estimateWordTimings(
            text: "Hi there friend",
            start: 0.0,
            end: 3.0
        )

        #expect(words.count == 3)
        #expect(words[0].word == "Hi")
        #expect(words[1].word == "there")
        #expect(words[2].word == "friend")

        // All words should span the full duration
        #expect(words[0].start == 0.0)
        #expect(abs(words[2].end - 3.0) < 0.001)

        // "there" (5 chars) should be longer than "Hi" (2 chars)
        let hiDuration = words[0].end - words[0].start
        let thereDuration = words[1].end - words[1].start
        #expect(thereDuration > hiDuration)
    }

    @Test func testSpeakerColorAssignment() {
        let asr = [
            RawASRSegment(text: "A", start: 0.0, end: 1.0),
            RawASRSegment(text: "B", start: 1.0, end: 2.0),
            RawASRSegment(text: "C", start: 2.0, end: 3.0),
        ]
        let dia = [
            RawDiarizationSegment(speakerId: "spk_0", start: 0.0, end: 1.0),
            RawDiarizationSegment(speakerId: "spk_1", start: 1.0, end: 2.0),
            RawDiarizationSegment(speakerId: "spk_2", start: 2.0, end: 3.0),
        ]

        let result = TranscriptMerger.merge(asrSegments: asr, diarizationSegments: dia)

        #expect(result.speakers.count == 3)
        #expect(result.speakers[0].color == "speaker0")
        #expect(result.speakers[1].color == "speaker1")
        #expect(result.speakers[2].color == "speaker2")
    }

    @Test func testEmptyInput() {
        let result = TranscriptMerger.merge(asrSegments: [], diarizationSegments: [])
        #expect(result.segments.isEmpty)
        #expect(result.speakers.isEmpty)
    }
}
