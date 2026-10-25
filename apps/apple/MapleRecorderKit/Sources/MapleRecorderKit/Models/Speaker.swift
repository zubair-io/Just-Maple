import Foundation

struct Speaker: Identifiable, Codable, Sendable, Hashable {
    var id: String
    var displayName: String
    var color: String
    var embedding: [Float]?

    enum CodingKeys: String, CodingKey {
        case id
        case displayName = "display_name"
        case color
        case embedding
    }
}
