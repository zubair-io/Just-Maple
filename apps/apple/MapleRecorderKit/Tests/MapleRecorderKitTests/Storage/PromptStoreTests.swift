import Foundation
import Testing
@testable import MapleRecorderKit

struct PromptStoreTests {

    private func makeTempDirectory() -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("PromptStoreTests-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    @Test func defaultPromptsOnInit() {
        let dir = makeTempDirectory()
        let store = PromptStore(directory: dir)
        #expect(store.prompts.count == 3)
        #expect(store.prompts[0].name == "Extract Action Items")
        #expect(store.prompts[1].name == "Meeting Notes")
        #expect(store.prompts[2].name == "Key Decisions")
    }

    @Test func addAndPersist() throws {
        let dir = makeTempDirectory()
        let store = PromptStore(directory: dir)

        let prompt = CustomPrompt(
            id: UUID(),
            name: "Test Prompt",
            systemPrompt: "Test body",
            createdAt: Date()
        )
        try store.add(prompt)
        #expect(store.prompts.count == 4)

        // Reload from disk
        let store2 = PromptStore(directory: dir)
        #expect(store2.prompts.count == 4)
        #expect(store2.prompts.last?.name == "Test Prompt")
    }

    @Test func deletePrompt() throws {
        let dir = makeTempDirectory()
        let store = PromptStore(directory: dir)
        let initial = store.prompts.count

        try store.delete(store.prompts[0])
        #expect(store.prompts.count == initial - 1)
    }

    @Test func updatePrompt() throws {
        let dir = makeTempDirectory()
        let store = PromptStore(directory: dir)
        var prompt = store.prompts[0]

        prompt.name = "Updated Name"
        try store.update(prompt)
        #expect(store.prompts[0].name == "Updated Name")
    }
}
