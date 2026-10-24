#if !os(watchOS)
import Foundation

struct LLMImage: Sendable, Equatable {
    let data: Data
    let mediaType: String
    let label: String

    init(data: Data, mediaType: String, label: String = "Current screen") {
        self.data = data
        self.mediaType = mediaType
        self.label = label
    }
}

protocol LLMService: Sendable {
    var isAvailable: Bool { get }
    func generate(systemPrompt: String, userMessage: String) async throws -> String
    func generate(systemPrompt: String, userMessage: String, images: [LLMImage]) async throws -> String
}

extension LLMService {
    /// Providers that do not yet support image input retain the OCR-first text path.
    func generate(systemPrompt: String, userMessage: String, images: [LLMImage]) async throws -> String {
        try await generate(systemPrompt: systemPrompt, userMessage: userMessage)
    }
}

enum LLMServiceError: Error, LocalizedError {
    case notAvailable
    case invalidResponse
    case apiError(String)
    case networkError(Error)

    var errorDescription: String? {
        switch self {
        case .notAvailable: "LLM service is not available"
        case .invalidResponse: "Invalid response from LLM"
        case .apiError(let message): "API error: \(message)"
        case .networkError(let error): "Network error: \(error.localizedDescription)"
        }
    }
}

// MARK: - Apple Foundation Models

import FoundationModels

struct AppleFoundationModelsService: LLMService {
    var isAvailable: Bool {
        if #available(macOS 26.0, iOS 26.0, *) {
            return SystemLanguageModel.default.isAvailable
        }
        return false
    }

    func generate(systemPrompt: String, userMessage: String) async throws -> String {
        guard #available(macOS 26.0, iOS 26.0, *), isAvailable else {
            throw LLMServiceError.notAvailable
        }
        let session = LanguageModelSession(instructions: systemPrompt)
        let response = try await session.respond(to: userMessage)
        return response.content
    }
}

// MARK: - Claude (Anthropic API)

struct ClaudeService: LLMService {
    let apiKey: String

    var isAvailable: Bool { !apiKey.isEmpty }

    func generate(systemPrompt: String, userMessage: String) async throws -> String {
        try await generate(systemPrompt: systemPrompt, userMessage: userMessage, images: [])
    }

    func generate(systemPrompt: String, userMessage: String, images: [LLMImage]) async throws -> String {
        let request = try makeRequest(systemPrompt: systemPrompt, userMessage: userMessage, images: images)
        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw LLMServiceError.invalidResponse
        }
        guard httpResponse.statusCode == 200 else {
            let errorBody = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw LLMServiceError.apiError("HTTP \(httpResponse.statusCode): \(errorBody)")
        }

        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let content = json?["content"] as? [[String: Any]],
              let text = content.first(where: { $0["type"] as? String == "text" })?["text"] as? String else {
            throw LLMServiceError.invalidResponse
        }

        return text
    }

    func makeRequest(systemPrompt: String, userMessage: String, images: [LLMImage]) throws -> URLRequest {
        let url = URL(string: "https://api.anthropic.com/v1/messages")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")

        var content: [[String: Any]] = []
        for image in images {
            content.append(["type": "text", "text": "\(image.label):"])
            content.append([
                "type": "image",
                "source": [
                    "type": "base64",
                    "media_type": image.mediaType,
                    "data": image.data.base64EncodedString(),
                ],
            ])
        }
        content.append(["type": "text", "text": userMessage])

        let body: [String: Any] = [
            "model": "claude-sonnet-4-5-20250929",
            "max_tokens": 4096,
            "system": systemPrompt,
            "messages": [
                ["role": "user", "content": content]
            ],
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        return request
    }
}

// MARK: - OpenAI

struct OpenAIService: LLMService {
    let apiKey: String

    var isAvailable: Bool { !apiKey.isEmpty }

    func generate(systemPrompt: String, userMessage: String) async throws -> String {
        let request = try makeTextRequest(systemPrompt: systemPrompt, userMessage: userMessage)
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.validate(response: response, data: data)

        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let choices = json?["choices"] as? [[String: Any]],
              let message = choices.first?["message"] as? [String: Any],
              let text = message["content"] as? String else {
            throw LLMServiceError.invalidResponse
        }

        return text
    }

    func generate(systemPrompt: String, userMessage: String, images: [LLMImage]) async throws -> String {
        guard !images.isEmpty else {
            return try await generate(systemPrompt: systemPrompt, userMessage: userMessage)
        }

        let request = try makeImageRequest(systemPrompt: systemPrompt, userMessage: userMessage, images: images)
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.validate(response: response, data: data)
        return try Self.responsesText(from: data)
    }

    func makeTextRequest(systemPrompt: String, userMessage: String) throws -> URLRequest {
        let url = URL(string: "https://api.openai.com/v1/chat/completions")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        let body: [String: Any] = [
            "model": "gpt-4o",
            "messages": [
                ["role": "system", "content": systemPrompt],
                ["role": "user", "content": userMessage],
            ],
            "max_tokens": 4096,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        return request
    }

    func makeImageRequest(systemPrompt: String, userMessage: String, images: [LLMImage]) throws -> URLRequest {
        let url = URL(string: "https://api.openai.com/v1/responses")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        var content: [[String: Any]] = [
            ["type": "input_text", "text": userMessage]
        ]
        for image in images {
            let dataURL = "data:\(image.mediaType);base64,\(image.data.base64EncodedString())"
            content.append(["type": "input_text", "text": "\(image.label):"])
            content.append(["type": "input_image", "image_url": dataURL, "detail": "high"])
        }

        let body: [String: Any] = [
            "model": "gpt-4o",
            "instructions": systemPrompt,
            "input": [
                [
                    "role": "user",
                    "content": content,
                ]
            ],
            "max_output_tokens": 4096,
            "store": false,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        return request
    }

    static func responsesText(from data: Data) throws -> String {
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        if let outputText = json?["output_text"] as? String, !outputText.isEmpty {
            return outputText
        }

        let text = (json?["output"] as? [[String: Any]] ?? [])
            .flatMap { $0["content"] as? [[String: Any]] ?? [] }
            .filter { $0["type"] as? String == "output_text" }
            .compactMap { $0["text"] as? String }
            .joined(separator: "\n")

        guard !text.isEmpty else { throw LLMServiceError.invalidResponse }
        return text
    }

    private static func validate(response: URLResponse, data: Data) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw LLMServiceError.invalidResponse
        }
        guard httpResponse.statusCode == 200 else {
            let errorBody = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw LLMServiceError.apiError("HTTP \(httpResponse.statusCode): \(errorBody)")
        }
    }
}

// MARK: - Factory

enum LLMServiceFactory {
    static func service(for provider: LLMProvider) -> (any LLMService)? {
        switch provider {
        case .appleFoundationModels:
            return AppleFoundationModelsService()
        case .claude:
            guard let key = KeychainManager.load(key: .claudeAPIKey), !key.isEmpty else { return nil }
            return ClaudeService(apiKey: key)
        case .openai:
            guard let key = KeychainManager.load(key: .openAIAPIKey), !key.isEmpty else { return nil }
            return OpenAIService(apiKey: key)
        case .none:
            return nil
        }
    }
}
#endif
