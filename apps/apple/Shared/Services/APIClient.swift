//
//  APIClient.swift
//  Shared Services
//
//  Network client for Just Maple API
//

import Foundation

/// Network errors
enum APIClientError: LocalizedError {
    case invalidURL
    case noToken
    case invalidResponse
    case httpError(statusCode: Int, message: String?)
    case decodingError(Error)
    case networkError(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .noToken:
            return "No authentication token available"
        case .invalidResponse:
            return "Invalid response from server"
        case let .httpError(statusCode, message):
            return message ?? "HTTP error \(statusCode)"
        case let .decodingError(error):
            return "Failed to decode response: \(error.localizedDescription)"
        case let .networkError(error):
            return "Network error: \(error.localizedDescription)"
        }
    }
}

/// Main API client for making authenticated requests
class APIClient {
    static let shared = APIClient()

    private let baseURL: String
    private let session: URLSession

    /// Callback to request a fresh token (set by watch app's AuthenticationManager)
    var tokenRefreshHandler: (() async -> String?)?

    init(baseURL: String = "https://paperbark.justmaple.app") {
        self.baseURL = baseURL
        self.session = URLSession(configuration: .default)
    }

    // MARK: - Tags API

    /// Get all tags for the authenticated user
    func getTags() async throws -> [Tag] {
        let response: TagsResponse = try await get(path: "/api/tags")
        return response.tags
    }

    // MARK: - Messages API

    /// Get messages for a tag
    /// - Parameters:
    ///   - tagId: The tag ID
    ///   - limit: Number of messages to fetch (default: 50)
    ///   - before: Fetch messages before this ID (pagination)
    func getMessages(
        tagId: String,
        limit: Int = 50,
        before: String? = nil
    ) async throws -> [Message] {
        var queryItems = [URLQueryItem(name: "limit", value: "\(limit)")]
        if let before = before {
            queryItems.append(URLQueryItem(name: "before", value: before))
        }

        let response: MessagesResponse = try await get(
            path: "/api/tags/\(tagId)/messages",
            queryItems: queryItems
        )
        return response.messages
    }

    /// Send a message to a tag
    /// - Parameters:
    ///   - tagId: The tag ID
    ///   - content: The TipTap content
    func sendMessage(tagId: String, content: NoteContent) async throws -> Message {
        let input = CreateMessageInput(content: content)
        let response: MessageResponse = try await post(
            path: "/api/tags/\(tagId)/messages",
            body: input
        )
        return response.message
    }

    // MARK: - User API

    /// Get current user info
    func getCurrentUser() async throws -> User {
        let response: MeResponse = try await get(path: "/api/auth/me")
        return response.user
    }

    // MARK: - Notifications API

    /// Register device for push notifications
    /// - Parameters:
    ///   - deviceToken: The device token from APNs
    ///   - platform: The platform (ios or macos)
    ///   - production: Whether this is a production build
    func registerDevice(
        deviceToken: String,
        platform: String = "ios",
        production: Bool = false
    ) async throws {
        let serverUrl = baseURL
        let input = RegisterDeviceInput(
            serverUrl: serverUrl,
            deviceToken: deviceToken,
            platform: platform,
            production: production
        )
        let _: RegisterDeviceResponse = try await post(
            path: "/api/notifications/register",
            body: input
        )
    }

    // MARK: - Generic HTTP Methods

    private func get<T: Decodable>(
        path: String,
        queryItems: [URLQueryItem]? = nil
    ) async throws -> T {
        try await request(method: "GET", path: path, queryItems: queryItems, body: nil as String?)
    }

    private func post<T: Decodable, B: Encodable>(
        path: String,
        body: B
    ) async throws -> T {
        try await request(method: "POST", path: path, queryItems: nil, body: body)
    }

    private func request<T: Decodable, B: Encodable>(
        method: String,
        path: String,
        queryItems: [URLQueryItem]?,
        body: B?,
        isRetry: Bool = false
    ) async throws -> T {
        // Build URL
        guard var urlComponents = URLComponents(string: baseURL + path) else {
            throw APIClientError.invalidURL
        }
        urlComponents.queryItems = queryItems
        guard let url = urlComponents.url else {
            throw APIClientError.invalidURL
        }

        // Get auth token
        guard let token = KeychainHelper.shared.getToken() else {
            throw APIClientError.noToken
        }

        // Build request
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        // Add body if present
        if let body = body {
            do {
                request.httpBody = try JSONEncoder().encode(body)
            } catch {
                throw APIClientError.decodingError(error)
            }
        }

        // Make request
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIClientError.networkError(error)
        }

        // Check response
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }

        // On 401, try refreshing the token from iPhone and retry once
        if httpResponse.statusCode == 401 && !isRetry {
            if let refreshHandler = tokenRefreshHandler {
                print("[APIClient] 🔄 Got 401, requesting fresh token from iPhone...")
                if let _ = await refreshHandler() {
                    print("[APIClient] ✅ Got fresh token, retrying request...")
                    return try await self.request(
                        method: method,
                        path: path,
                        queryItems: queryItems,
                        body: body,
                        isRetry: true
                    )
                }
            }
        }

        // Handle errors
        if !(200 ... 299).contains(httpResponse.statusCode) {
            // Try to decode error message
            let errorMessage = try? JSONDecoder().decode(
                APIError.self,
                from: data
            ).localizedDescription
            throw APIClientError.httpError(
                statusCode: httpResponse.statusCode,
                message: errorMessage
            )
        }

        // Decode response
        do {
            let decoder = JSONDecoder()
            return try decoder.decode(T.self, from: data)
        } catch {
            // Log raw response for debugging
            if let responseString = String(data: data, encoding: .utf8) {
                print("[APIClient] Failed to decode response: \(responseString)")
            }
            throw APIClientError.decodingError(error)
        }
    }
}
