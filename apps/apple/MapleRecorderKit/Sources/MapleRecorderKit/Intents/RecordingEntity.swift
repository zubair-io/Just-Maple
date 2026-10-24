import AppIntents
import Foundation

struct RecordingEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Recording"

    static var defaultQuery = RecordingQuery()

    var id: UUID
    var title: String
    var createdAt: Date
    var duration: TimeInterval
    var hasSummary: Bool
    var hasTranscript: Bool

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(
            title: "\(title)",
            subtitle: "\(formatDuration(duration))"
        )
    }

    private func formatDuration(_ d: TimeInterval) -> String {
        let m = Int(d) / 60
        let s = Int(d) % 60
        return String(format: "%d:%02d", m, s)
    }
}

struct RecordingQuery: EntityQuery {
    func entities(for identifiers: [UUID]) async throws -> [RecordingEntity] {
        await MainActor.run {
            let store = RecordingStore()
            return store.recordings
                .filter { identifiers.contains($0.id) }
                .map { $0.toEntity() }
        }
    }

    func suggestedEntities() async throws -> [RecordingEntity] {
        await MainActor.run {
            let store = RecordingStore()
            return Array(store.recordings.prefix(10).map { $0.toEntity() })
        }
    }
}

extension MapleRecording {
    func toEntity() -> RecordingEntity {
        RecordingEntity(
            id: id,
            title: title,
            createdAt: createdAt,
            duration: duration,
            hasSummary: !summary.isEmpty,
            hasTranscript: !transcript.isEmpty
        )
    }
}
