//
//  PaperbarkClient.swift
//  JapaneseMaple
//
//  Client for fetching notification content from user's Maple server
//

import Foundation

struct PaperbarkClient {
    /// Fetch full notification content from Maple server
    static func fetchNotification(notificationId: String, serverUrl: String) async throws -> NotificationContent {
        guard let url = URL(string: "\(serverUrl)/api/notifications/\(notificationId)") else {
            throw PaperbarkError.invalidURL
        }

        guard let token = ServerConfigService.shared.getToken() else {
            throw PaperbarkError.notAuthenticated
        }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw PaperbarkError.fetchFailed
        }

        let decoder = JSONDecoder()
        let notificationResponse = try decoder.decode(NotificationResponse.self, from: data)

        return notificationResponse.notification
    }

    // MARK: - Models

    struct NotificationResponse: Codable {
        let notification: NotificationContent
    }

    struct NotificationContent: Codable {
        let _id: String
        let userId: String
        let type: String
        let data: [String: AnyCodable]
        let read: Bool
        let createdAt: String
        let expiresAt: String?

        /// Generate user-facing title and body from notification data
        func formatForDisplay() -> (title: String, body: String) {
            switch type {
            case "transcription_complete":
                return (
                    title: "Transcription Complete",
                    body: "Your voice memo has been transcribed"
                )
            case "share_received":
                if let tagLabel = data["tagLabel"]?.value as? String {
                    return (
                        title: "New Share",
                        body: "Someone shared \"\(tagLabel)\" with you"
                    )
                }
                return (
                    title: "New Share",
                    body: "Someone shared a folder with you"
                )
            case "reminder":
                return (
                    title: "Reminder",
                    body: "You have a reminder"
                )
            case "processing_failed":
                return (
                    title: "Processing Failed",
                    body: "Unable to process your memo"
                )
            case "export_ready":
                return (
                    title: "Export Ready",
                    body: "Your export is ready to download"
                )
            default:
                return (
                    title: "Notification",
                    body: "You have a new notification"
                )
            }
        }
    }

    /// Type-erased wrapper for decoding heterogeneous JSON values
    struct AnyCodable: Codable {
        let value: Any

        init(_ value: Any) {
            self.value = value
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.singleValueContainer()

            if let bool = try? container.decode(Bool.self) {
                value = bool
            } else if let int = try? container.decode(Int.self) {
                value = int
            } else if let double = try? container.decode(Double.self) {
                value = double
            } else if let string = try? container.decode(String.self) {
                value = string
            } else if let array = try? container.decode([AnyCodable].self) {
                value = array.map { $0.value }
            } else if let dict = try? container.decode([String: AnyCodable].self) {
                value = dict.mapValues { $0.value }
            } else {
                value = NSNull()
            }
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.singleValueContainer()

            if let bool = value as? Bool {
                try container.encode(bool)
            } else if let int = value as? Int {
                try container.encode(int)
            } else if let double = value as? Double {
                try container.encode(double)
            } else if let string = value as? String {
                try container.encode(string)
            } else if let array = value as? [Any] {
                try container.encode(array.map { AnyCodable($0) })
            } else if let dict = value as? [String: Any] {
                try container.encode(dict.mapValues { AnyCodable($0) })
            } else {
                try container.encodeNil()
            }
        }
    }

    enum PaperbarkError: LocalizedError {
        case invalidURL
        case notAuthenticated
        case fetchFailed

        var errorDescription: String? {
            switch self {
            case .invalidURL:
                return "Invalid notification URL"
            case .notAuthenticated:
                return "User not authenticated"
            case .fetchFailed:
                return "Failed to fetch notification content"
            }
        }
    }
}
