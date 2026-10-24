import Foundation
import Testing
@testable import MapleRecorderKit

struct PlaybackSyncEngineTests {

    private func makeSampleTranscript() -> [TranscriptSegment] {
        [
            TranscriptSegment(
                speakerId: "s0",
                start: 0.0,
                end: 3.0,
                text: "Hello world friend",
                words: [
                    WordTiming(word: "Hello", start: 0.0, end: 1.0),
                    WordTiming(word: "world", start: 1.0, end: 2.0),
                    WordTiming(word: "friend", start: 2.0, end: 3.0),
                ]
            ),
            TranscriptSegment(
                speakerId: "s1",
                start: 4.0,
                end: 6.0,
                text: "Good morning",
                words: [
                    WordTiming(word: "Good", start: 4.0, end: 5.0),
                    WordTiming(word: "morning", start: 5.0, end: 6.0),
                ]
            ),
        ]
    }

    @Test func findsActiveSegment() {
        let transcript = makeSampleTranscript()

        let result1 = PlaybackSyncEngine.findActive(time: 1.5, transcript: transcript)
        #expect(result1.segmentId == transcript[0].id)

        let result2 = PlaybackSyncEngine.findActive(time: 4.5, transcript: transcript)
        #expect(result2.segmentId == transcript[1].id)
    }

    @Test func findsActiveWord() {
        let transcript = makeSampleTranscript()

        let result = PlaybackSyncEngine.findActive(time: 1.5, transcript: transcript)
        #expect(result.wordId == transcript[0].words[1].id) // "world"
    }

    @Test func noActiveInGap() {
        let transcript = makeSampleTranscript()

        // Time 3.5 is between segment 0 (ends 3.0) and segment 1 (starts 4.0)
        let result = PlaybackSyncEngine.findActive(time: 3.5, transcript: transcript)
        #expect(result.segmentId == nil)
        #expect(result.wordId == nil)
    }

    @Test func autoScrollResumesAfterTimeout() async throws {
        let engine = PlaybackSyncEngine()

        #expect(engine.shouldAutoScroll == true)

        engine.userDidScroll()
        #expect(engine.shouldAutoScroll == false)
    }

    @Test func emptyTranscript() {
        let result = PlaybackSyncEngine.findActive(time: 1.0, transcript: [])
        #expect(result.segmentId == nil)
        #expect(result.wordId == nil)
    }

    @Test func findsFirstWord() {
        let transcript = makeSampleTranscript()

        let result = PlaybackSyncEngine.findActive(time: 0.0, transcript: transcript)
        #expect(result.segmentId == transcript[0].id)
        #expect(result.wordId == transcript[0].words[0].id) // "Hello"
    }

    @Test func findsLastWord() {
        let transcript = makeSampleTranscript()

        let result = PlaybackSyncEngine.findActive(time: 5.5, transcript: transcript)
        #expect(result.segmentId == transcript[1].id)
        #expect(result.wordId == transcript[1].words[1].id) // "morning"
    }
}
