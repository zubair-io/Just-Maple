import Foundation

/// A visually distinct frame captured from the foreground presentation/video window.
/// The image lives beside the recording's audio files so the Markdown metadata stays
/// portable and inexpensive to load.
struct TimelineScreenshot: Identifiable, Codable, Hashable, Sendable {
    var id: UUID
    var fileName: String
    var timestamp: TimeInterval

    init(id: UUID = UUID(), fileName: String, timestamp: TimeInterval) {
        self.id = id
        self.fileName = fileName
        self.timestamp = timestamp
    }

    enum CodingKeys: String, CodingKey {
        case id
        case fileName = "file_name"
        case timestamp
    }
}
