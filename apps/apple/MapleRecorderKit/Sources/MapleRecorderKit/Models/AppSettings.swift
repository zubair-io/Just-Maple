import Foundation

enum CalendarTitleMode: String, Codable, Sendable, CaseIterable {
    case off        // Don't use calendar
    case hint       // Prefill as suggestion, prepend "Recording — "
    case exactName  // Use the event title as-is
}

struct AppSettings: Codable, Sendable {
    static let defaultAssistPrompt = """
        You are a discreet live presentation copilot. Use the visible screen text and the \
        presenter's notes to identify the question or topic being discussed and draft a \
        concise, confident answer the presenter can say aloud. Prefer specific, useful \
        wording over general advice. Never invent facts; when essential context is missing, \
        state the shortest clarification needed. Return only the suggested response.
        """

    var preferredLLMProvider: LLMProvider
    var claudeAPIKey: String?
    var openAIAPIKey: String?
    var iCloudEnabled: Bool
    var chunkDurationMinutes: Int
    var assistPrompt: String
    var shareAssistScreenshotsWithCloudAI: Bool

    // Calendar integration
    var calendarEnabled: Bool
    var calendarTitleMode: CalendarTitleMode
    var selectedCalendarIdentifiers: [String]  // empty = all calendars

    enum CodingKeys: String, CodingKey {
        case preferredLLMProvider = "preferred_llm_provider"
        case claudeAPIKey = "claude_api_key"
        case openAIAPIKey = "openai_api_key"
        case iCloudEnabled = "icloud_enabled"
        case chunkDurationMinutes = "chunk_duration_minutes"
        case assistPrompt = "assist_prompt"
        case shareAssistScreenshotsWithCloudAI = "share_assist_screenshots_with_cloud_ai"
        case calendarEnabled = "calendar_enabled"
        case calendarTitleMode = "calendar_title_mode"
        case selectedCalendarIdentifiers = "selected_calendar_identifiers"
    }

    init(
        preferredLLMProvider: LLMProvider = .none,
        claudeAPIKey: String? = nil,
        openAIAPIKey: String? = nil,
        iCloudEnabled: Bool = true,
        chunkDurationMinutes: Int = 30,
        assistPrompt: String = AppSettings.defaultAssistPrompt,
        shareAssistScreenshotsWithCloudAI: Bool = false,
        calendarEnabled: Bool = false,
        calendarTitleMode: CalendarTitleMode = .hint,
        selectedCalendarIdentifiers: [String] = []
    ) {
        self.preferredLLMProvider = preferredLLMProvider
        self.claudeAPIKey = claudeAPIKey
        self.openAIAPIKey = openAIAPIKey
        self.iCloudEnabled = iCloudEnabled
        self.chunkDurationMinutes = chunkDurationMinutes
        self.assistPrompt = assistPrompt
        self.shareAssistScreenshotsWithCloudAI = shareAssistScreenshotsWithCloudAI
        self.calendarEnabled = calendarEnabled
        self.calendarTitleMode = calendarTitleMode
        self.selectedCalendarIdentifiers = selectedCalendarIdentifiers
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        preferredLLMProvider = try container.decode(LLMProvider.self, forKey: .preferredLLMProvider)
        claudeAPIKey = try container.decodeIfPresent(String.self, forKey: .claudeAPIKey)
        openAIAPIKey = try container.decodeIfPresent(String.self, forKey: .openAIAPIKey)
        iCloudEnabled = try container.decode(Bool.self, forKey: .iCloudEnabled)
        chunkDurationMinutes = try container.decode(Int.self, forKey: .chunkDurationMinutes)
        assistPrompt = try container.decodeIfPresent(String.self, forKey: .assistPrompt) ?? Self.defaultAssistPrompt
        shareAssistScreenshotsWithCloudAI = try container.decodeIfPresent(
            Bool.self,
            forKey: .shareAssistScreenshotsWithCloudAI
        ) ?? false
        calendarEnabled = try container.decodeIfPresent(Bool.self, forKey: .calendarEnabled) ?? false
        calendarTitleMode = try container.decodeIfPresent(CalendarTitleMode.self, forKey: .calendarTitleMode) ?? .hint
        // Migrate from the old single-calendar setting while continuing to decode
        // the current array representation without throwing a type mismatch first.
        if let identifiers = try? container.decode([String].self, forKey: .selectedCalendarIdentifiers) {
            selectedCalendarIdentifiers = identifiers
        } else if let oldIdentifier = try? container.decode(String.self, forKey: .selectedCalendarIdentifiers) {
            selectedCalendarIdentifiers = [oldIdentifier]
        } else {
            selectedCalendarIdentifiers = []
        }
    }
}
