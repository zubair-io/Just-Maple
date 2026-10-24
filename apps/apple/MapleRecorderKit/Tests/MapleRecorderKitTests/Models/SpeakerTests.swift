import Testing
import Foundation
@testable import MapleRecorderKit

struct SpeakerTests {

    @Test func encodingDecodingWithEmbedding() throws {
        let speaker = Speaker(
            id: "speaker_0",
            displayName: "Alice",
            color: "speaker0",
            embedding: [0.1, 0.2, 0.3]
        )

        let encoder = JSONEncoder()
        let data = try encoder.encode(speaker)

        let decoder = JSONDecoder()
        let decoded = try decoder.decode(Speaker.self, from: data)

        #expect(decoded.id == "speaker_0")
        #expect(decoded.displayName == "Alice")
        #expect(decoded.color == "speaker0")
        #expect(decoded.embedding == [0.1, 0.2, 0.3])
    }

    @Test func encodingDecodingWithoutEmbedding() throws {
        let speaker = Speaker(
            id: "speaker_1",
            displayName: "Bob",
            color: "speaker1",
            embedding: nil
        )

        let encoder = JSONEncoder()
        let data = try encoder.encode(speaker)

        let decoder = JSONDecoder()
        let decoded = try decoder.decode(Speaker.self, from: data)

        #expect(decoded.id == "speaker_1")
        #expect(decoded.displayName == "Bob")
        #expect(decoded.embedding == nil)
    }

    @Test func snakeCaseKeys() throws {
        let json = """
        {"id":"s0","display_name":"Speaker 0","color":"speaker0"}
        """.data(using: .utf8)!

        let decoder = JSONDecoder()
        let speaker = try decoder.decode(Speaker.self, from: json)

        #expect(speaker.displayName == "Speaker 0")
    }
}
