#if !os(watchOS)
import Foundation
import Testing
@testable import MapleRecorderKit

struct S1TextNormalizerTests {
    @Test func joinsAdjacentSegmentsFromSameSpeaker() {
        let speakers = [Speaker(id: "s0", displayName: "Alice", color: "speaker0", embedding: nil)]
        let transcript = [
            TranscriptSegment(speakerId: "s0", start: 0, end: 1, text: "send it friday", words: []),
            TranscriptSegment(speakerId: "s0", start: 1, end: 2, text: "no make that thursday", words: []),
        ]

        let chunks = S1TextNormalizer.makeChunks(transcript: transcript, speakers: speakers)

        #expect(chunks == [
            .init(speakerName: "Alice", text: "send it friday no make that thursday")
        ])
    }

    @Test func keepsSpeakersSeparateAndHonorsChunkLimit() {
        let speakers = [
            Speaker(id: "s0", displayName: "Alice", color: "speaker0", embedding: nil),
            Speaker(id: "s1", displayName: "Bob", color: "speaker1", embedding: nil),
        ]
        let transcript = [
            TranscriptSegment(speakerId: "s0", start: 0, end: 1, text: "one two three four", words: []),
            TranscriptSegment(speakerId: "s1", start: 1, end: 2, text: "five six", words: []),
        ]

        let chunks = S1TextNormalizer.makeChunks(
            transcript: transcript,
            speakers: speakers,
            maximumCharacters: 10
        )

        #expect(chunks == [
            .init(speakerName: "Alice", text: "one two"),
            .init(speakerName: "Alice", text: "three four"),
            .init(speakerName: "Bob", text: "five six"),
        ])
        #expect(chunks.allSatisfy { $0.text.count <= 10 })
    }

    @Test func chunksOpenNoteTextWithoutSpeakerLabels() {
        let chunks = S1TextNormalizer.makeTextChunks(
            "um this is a note that needs cleanup",
            maximumCharacters: 14
        )

        #expect(chunks == ["um this is a", "note that", "needs cleanup"])
        #expect(chunks.allSatisfy { $0.count <= 14 })
    }
}
#endif
