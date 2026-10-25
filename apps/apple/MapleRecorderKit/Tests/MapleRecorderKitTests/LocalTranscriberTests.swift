import Testing
@testable import MapleRecorderKit

struct LocalTranscriberTests {
    @Test func joinsSubwordsAndKeepsSentenceTimestamps() {
        let segments = LocalTranscriber.sentences(tokens: [
            (" Hello", 0.2, 0.4), (" record", 0.4, 0.6), ("ing", 0.6, 0.8),
            (".", 0.8, 0.9), (" Next", 1.2, 1.5), (" sentence", 1.5, 2.0)
        ])
        #expect(segments.map(\.text) == ["Hello recording.", "Next sentence"])
        #expect(segments.first?.start == 0.2)
        #expect(segments.first?.end == 0.9)
        #expect(segments.last?.end == 2.0)
    }

    @Test func handlesSentencePieceBoundariesAndBlankTokens() {
        let segments = LocalTranscriber.sentences(tokens: [
            ("<blank>", 0, 0.1), ("▁Hello", 0.2, 0.5), ("▁world!", 0.5, 1.0),
            ("<pad>", 1, 1.1)
        ])
        #expect(segments.map(\.text) == ["Hello world!"])
        #expect(LocalTranscriber.sentences(tokens: []).isEmpty)
    }
}
