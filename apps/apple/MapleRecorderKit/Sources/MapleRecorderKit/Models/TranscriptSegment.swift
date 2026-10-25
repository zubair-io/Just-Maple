import Foundation

struct TranscriptSegment: Identifiable, Codable, Sendable {
    var id: UUID
    var speakerId: String
    var start: TimeInterval
    var end: TimeInterval
    var text: String
    var words: [WordTiming]

    enum CodingKeys: String, CodingKey {
        case speakerId = "speaker_id"
        case start, end, text, words
    }

    init(
        id: UUID = UUID(),
        speakerId: String,
        start: TimeInterval,
        end: TimeInterval,
        text: String,
        words: [WordTiming] = []
    ) {
        self.id = id
        self.speakerId = speakerId
        self.start = start
        self.end = end
        self.text = text
        self.words = words
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = UUID()
        self.speakerId = try container.decode(String.self, forKey: .speakerId)
        self.start = try container.decode(TimeInterval.self, forKey: .start)
        self.end = try container.decode(TimeInterval.self, forKey: .end)
        self.text = try container.decode(String.self, forKey: .text)
        self.words = try container.decode([WordTiming].self, forKey: .words)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(speakerId, forKey: .speakerId)
        try container.encode(start, forKey: .start)
        try container.encode(end, forKey: .end)
        try container.encode(text, forKey: .text)
        try container.encode(words, forKey: .words)
    }
}
