import AppIntents
import Foundation

struct ListRecordingsIntent: AppIntent {
    static var title: LocalizedStringResource = "List Recordings"
    static var description: IntentDescription = "Returns recent recordings from Maple Recorder."

    @Parameter(title: "Limit", default: 10)
    var limit: Int

    func perform() async throws -> some IntentResult & ReturnsValue<[RecordingEntity]> {
        let entities: [RecordingEntity] = await MainActor.run {
            let store = RecordingStore()
            return Array(store.recordings.prefix(limit).map { $0.toEntity() })
        }
        return .result(value: entities)
    }
}
