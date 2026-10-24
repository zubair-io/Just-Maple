import Foundation

enum LLMProvider: String, Codable, CaseIterable, Sendable {
    case appleFoundationModels = "apple_foundation_models"
    case claude = "claude"
    case openai = "openai"
    case none = "none"

    var displayName: String {
        switch self {
        case .appleFoundationModels: "Apple On-Device"
        case .claude: "Claude"
        case .openai: "OpenAI"
        case .none: "Off"
        }
    }

    /// Maximum transcript characters to send in a single LLM request, sized to the
    /// provider's context window. Apple Foundation Models has only a 4,096-token
    /// window shared by the system prompt, transcript, and reply (~1.8 chars/token
    /// for transcript text), so requests over this are split via map-reduce (see
    /// `TranscriptLLM`). Cloud providers have far larger windows.
    var maxChunkCharacters: Int {
        switch self {
        case .appleFoundationModels: return 4_000
        case .claude, .openai: return 100_000
        case .none: return 4_000
        }
    }
}
