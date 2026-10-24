import Foundation

struct PromptResult: Identifiable, Codable, Sendable {
    var id: UUID
    var promptName: String
    var promptBody: String
    var additionalContext: String?
    var llmProvider: LLMProvider
    var result: String
    var createdAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case promptName = "prompt_name"
        case promptBody = "prompt_body"
        case additionalContext = "additional_context"
        case llmProvider = "llm_provider"
        case result
        case createdAt = "created_at"
    }
}
