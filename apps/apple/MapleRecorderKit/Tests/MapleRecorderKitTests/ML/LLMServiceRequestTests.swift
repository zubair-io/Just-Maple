import Foundation
import Testing
@testable import MapleRecorderKit

struct LLMServiceRequestTests {
    private let previousImage = LLMImage(
        data: Data([0x00]),
        mediaType: "image/jpeg",
        label: "Previous screen"
    )
    private let image = LLMImage(
        data: Data([0x01, 0x02, 0x03]),
        mediaType: "image/jpeg",
        label: "Current screen"
    )

    @Test func openAIImageRequestUsesResponsesMultimodalInput() throws {
        let request = try OpenAIService(apiKey: "test-key").makeImageRequest(
            systemPrompt: "System",
            userMessage: "Read this screen",
            images: [previousImage, image]
        )

        #expect(request.url?.absoluteString == "https://api.openai.com/v1/responses")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer test-key")

        let requestBody = try #require(request.httpBody)
        let body = try #require(JSONSerialization.jsonObject(with: requestBody) as? [String: Any])
        #expect(body["store"] as? Bool == false)
        let input = try #require(body["input"] as? [[String: Any]])
        let content = try #require(input.first?["content"] as? [[String: Any]])
        let imageParts = content.filter { $0["type"] as? String == "input_image" }
        #expect(imageParts.count == 2)
        #expect(imageParts.first?["image_url"] as? String == "data:image/jpeg;base64,AA==")
        #expect(imageParts.last?["image_url"] as? String == "data:image/jpeg;base64,AQID")
        #expect(imageParts.allSatisfy { $0["detail"] as? String == "high" })
        let labels = content.compactMap { $0["text"] as? String }
        #expect(labels.contains("Previous screen:"))
        #expect(labels.contains("Current screen:"))
    }

    @Test func claudeImageRequestUsesBase64ContentBlock() throws {
        let request = try ClaudeService(apiKey: "test-key").makeRequest(
            systemPrompt: "System",
            userMessage: "Read this screen",
            images: [previousImage, image]
        )

        #expect(request.url?.absoluteString == "https://api.anthropic.com/v1/messages")
        let requestBody = try #require(request.httpBody)
        let body = try #require(JSONSerialization.jsonObject(with: requestBody) as? [String: Any])
        let messages = try #require(body["messages"] as? [[String: Any]])
        let content = try #require(messages.first?["content"] as? [[String: Any]])
        let imageParts = content.filter { $0["type"] as? String == "image" }
        #expect(imageParts.count == 2)
        let sources = imageParts.compactMap { $0["source"] as? [String: Any] }
        #expect(sources.first?["data"] as? String == "AA==")
        #expect(sources.last?["data"] as? String == "AQID")
        #expect(sources.allSatisfy { $0["type"] as? String == "base64" })
        #expect(sources.allSatisfy { $0["media_type"] as? String == "image/jpeg" })
        let labels = content.compactMap { $0["text"] as? String }
        #expect(labels.contains("Previous screen:"))
        #expect(labels.contains("Current screen:"))
    }

    @Test func openAIResponsesTextReadsNestedOutput() throws {
        let data = try JSONSerialization.data(withJSONObject: [
            "output": [
                [
                    "content": [
                        ["type": "output_text", "text": "Suggested answer"]
                    ]
                ]
            ]
        ])

        #expect(try OpenAIService.responsesText(from: data) == "Suggested answer")
    }

    @Test func imageGenerationDispatchesThroughProviderExistential() async throws {
        let service: any LLMService = ImageAwareTestService()

        let result = try await service.generate(
            systemPrompt: "System",
            userMessage: "Message",
            images: [image]
        )

        #expect(result == "image")
    }
}

private struct ImageAwareTestService: LLMService {
    let isAvailable = true

    func generate(systemPrompt: String, userMessage: String) async throws -> String {
        "text"
    }

    func generate(systemPrompt: String, userMessage: String, images: [LLMImage]) async throws -> String {
        images.isEmpty ? "text" : "image"
    }
}
