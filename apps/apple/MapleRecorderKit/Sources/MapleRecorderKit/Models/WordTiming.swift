import Foundation

struct WordTiming: Identifiable, Codable, Sendable, Hashable {
    var id: UUID
    var word: String
    var start: TimeInterval
    var end: TimeInterval

    enum CodingKeys: String, CodingKey {
        case id, word, start, end
    }

    init(id: UUID = UUID(), word: String, start: TimeInterval, end: TimeInterval) {
        self.id = id
        self.word = word
        self.start = start
        self.end = end
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = (try? container.decode(UUID.self, forKey: .id)) ?? UUID()
        self.word = try container.decode(String.self, forKey: .word)
        self.start = try container.decode(TimeInterval.self, forKey: .start)
        self.end = try container.decode(TimeInterval.self, forKey: .end)
    }
}
