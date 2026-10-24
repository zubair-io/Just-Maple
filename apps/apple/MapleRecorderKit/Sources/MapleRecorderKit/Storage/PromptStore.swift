import Foundation
import Observation

@Observable
final class PromptStore {
    var prompts: [CustomPrompt] = []

    private let fileManager = FileManager.default

    init() {
        loadPrompts()
        if prompts.isEmpty {
            prompts = Self.defaultPrompts
        }
    }

    // For testing
    init(directory: URL) {
        self.overrideURL = directory.appendingPathComponent("prompts.json")
        loadPrompts()
        if prompts.isEmpty {
            prompts = Self.defaultPrompts
        }
    }

    private var overrideURL: URL?

    private var promptsURL: URL {
        if let url = overrideURL { return url }
        // Store in iCloud Documents (syncs across devices) or local fallback
        if let iCloudURL = fileManager
            .url(forUbiquityContainerIdentifier: nil)?
            .appendingPathComponent("Documents")
            .appendingPathComponent("prompts.json") {
            return iCloudURL
        }
        return fileManager
            .urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("prompts.json")
    }

    func loadPrompts() {
        guard let data = try? Data(contentsOf: promptsURL) else { return }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let loaded = try? decoder.decode([CustomPrompt].self, from: data) else { return }
        prompts = loaded
    }

    func save() throws {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(prompts)

        let directory = promptsURL.deletingLastPathComponent()
        if !fileManager.fileExists(atPath: directory.path(percentEncoded: false)) {
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        }

        try data.write(to: promptsURL, options: .atomic)
    }

    func add(_ prompt: CustomPrompt) throws {
        prompts.append(prompt)
        try save()
    }

    func delete(_ prompt: CustomPrompt) throws {
        prompts.removeAll { $0.id == prompt.id }
        try save()
    }

    func update(_ prompt: CustomPrompt) throws {
        if let index = prompts.firstIndex(where: { $0.id == prompt.id }) {
            prompts[index] = prompt
        }
        try save()
    }

    // MARK: - Defaults

    static let defaultPrompts: [CustomPrompt] = [
        CustomPrompt(
            id: UUID(),
            name: "Extract Action Items",
            systemPrompt: "Extract all action items from this transcript. List each action item with the responsible person (if mentioned) and any deadlines. Format as a bulleted list.",
            createdAt: Date()
        ),
        CustomPrompt(
            id: UUID(),
            name: "Meeting Notes",
            systemPrompt: "Rewrite this transcript as clean, organized meeting notes. Include sections for: Attendees, Key Discussion Points, Decisions Made, and Next Steps. Use markdown formatting.",
            createdAt: Date()
        ),
        CustomPrompt(
            id: UUID(),
            name: "Key Decisions",
            systemPrompt: "Identify all key decisions made in this transcript. For each decision, note who proposed it, any discussion points, and the final outcome. Format as a numbered list.",
            createdAt: Date()
        ),
    ]
}
