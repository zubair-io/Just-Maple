import Foundation

struct CustomPrompt: Identifiable, Codable, Sendable {
    var id: UUID
    var name: String
    var systemPrompt: String
    var createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id, name
        case systemPrompt = "system_prompt"
        case createdAt = "created_at"
    }
}
