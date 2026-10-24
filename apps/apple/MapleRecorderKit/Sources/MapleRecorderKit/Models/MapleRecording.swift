import Foundation

struct MapleRecording: Identifiable, Sendable {
    var id: UUID
    var title: String
    var summary: String
    var notes: String
    var audioFiles: [String]
    var systemAudioFiles: [String]
    var duration: TimeInterval
    var createdAt: Date
    var modifiedAt: Date
    var speakers: [Speaker]
    var transcript: [TranscriptSegment]
    var promptResults: [PromptResult]
    var tags: [String]
    var screenshots: [TimelineScreenshot]
    var userNotes: String

    init(
        id: UUID = UUID(),
        title: String,
        summary: String = "",
        notes: String = "",
        audioFiles: [String] = [],
        systemAudioFiles: [String] = [],
        duration: TimeInterval = 0,
        createdAt: Date = Date(),
        modifiedAt: Date = Date(),
        speakers: [Speaker] = [],
        transcript: [TranscriptSegment] = [],
        promptResults: [PromptResult] = [],
        tags: [String] = [],
        screenshots: [TimelineScreenshot] = [],
        userNotes: String = ""
    ) {
        self.id = id
        self.title = title
        self.summary = summary
        self.notes = notes
        self.audioFiles = audioFiles
        self.systemAudioFiles = systemAudioFiles
        self.duration = duration
        self.createdAt = createdAt
        self.modifiedAt = modifiedAt
        self.speakers = speakers
        self.transcript = transcript
        self.promptResults = promptResults
        self.tags = tags
        self.screenshots = screenshots
        self.userNotes = userNotes
    }
}

// MARK: - Hashable / Equatable

extension MapleRecording: Hashable {
    // Equality must reflect the fields shown in the UI. SwiftUI uses `==` to decide
    // whether a row's input changed; comparing `id` alone makes it treat a row as
    // unchanged after processing updates the title/summary/tags, so the sidebar row
    // never re-renders. `modifiedAt` is bumped on every save and acts as a catch-all
    // version stamp (covering transcript/speaker changes without deep array compares).
    static func == (lhs: MapleRecording, rhs: MapleRecording) -> Bool {
        lhs.id == rhs.id
            && lhs.modifiedAt == rhs.modifiedAt
            && lhs.title == rhs.title
            && lhs.summary == rhs.summary
            && lhs.notes == rhs.notes
            && lhs.duration == rhs.duration
            && lhs.tags == rhs.tags
    }

    // Hashing stays id-only: equal values always share an id, and hash collisions
    // for same-id/different-content values are permitted.
    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}

// MARK: - JSON Metadata Codable (excludes title and summary — those come from Markdown)

extension MapleRecording {
    struct MetadataJSON: Codable {
        var id: UUID
        var notes: String
        var audio: [String]
        var systemAudio: [String]
        var duration: TimeInterval
        var createdAt: Date
        var modifiedAt: Date
        var speakers: [Speaker]
        var transcript: [TranscriptSegment]
        var promptResults: [PromptResult]
        var tags: [String]
        var screenshots: [TimelineScreenshot]
        var userNotes: String

        enum CodingKeys: String, CodingKey {
            case id, notes, audio, duration, speakers, transcript, tags
            case systemAudio = "system_audio"
            case createdAt = "created_at"
            case modifiedAt = "modified_at"
            case promptResults = "prompt_results"
            case screenshots
            case userNotes = "user_notes"
        }

        init(
            id: UUID,
            notes: String = "",
            audio: [String],
            systemAudio: [String] = [],
            duration: TimeInterval,
            createdAt: Date,
            modifiedAt: Date,
            speakers: [Speaker],
            transcript: [TranscriptSegment],
            promptResults: [PromptResult],
            tags: [String],
            screenshots: [TimelineScreenshot] = [],
            userNotes: String = ""
        ) {
            self.id = id
            self.notes = notes
            self.audio = audio
            self.systemAudio = systemAudio
            self.duration = duration
            self.createdAt = createdAt
            self.modifiedAt = modifiedAt
            self.speakers = speakers
            self.transcript = transcript
            self.promptResults = promptResults
            self.tags = tags
            self.screenshots = screenshots
            self.userNotes = userNotes
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            id = try container.decode(UUID.self, forKey: .id)
            notes = try container.decodeIfPresent(String.self, forKey: .notes) ?? ""
            audio = try container.decode([String].self, forKey: .audio)
            systemAudio = try container.decodeIfPresent([String].self, forKey: .systemAudio) ?? []
            duration = try container.decode(TimeInterval.self, forKey: .duration)
            createdAt = try container.decode(Date.self, forKey: .createdAt)
            modifiedAt = try container.decode(Date.self, forKey: .modifiedAt)
            speakers = try container.decode([Speaker].self, forKey: .speakers)
            transcript = try container.decode([TranscriptSegment].self, forKey: .transcript)
            promptResults = try container.decode([PromptResult].self, forKey: .promptResults)
            tags = try container.decodeIfPresent([String].self, forKey: .tags) ?? []
            screenshots = try container.decodeIfPresent([TimelineScreenshot].self, forKey: .screenshots) ?? []
            userNotes = try container.decodeIfPresent(String.self, forKey: .userNotes) ?? ""
        }
    }

    var metadata: MetadataJSON {
        MetadataJSON(
            id: id,
            notes: notes,
            audio: audioFiles,
            systemAudio: systemAudioFiles,
            duration: duration,
            createdAt: createdAt,
            modifiedAt: modifiedAt,
            speakers: speakers,
            transcript: transcript,
            promptResults: promptResults,
            tags: tags,
            screenshots: screenshots,
            userNotes: userNotes
        )
    }

    init(title: String, summary: String, metadata: MetadataJSON) {
        self.id = metadata.id
        self.title = title
        self.summary = summary
        self.notes = metadata.notes
        self.audioFiles = metadata.audio
        self.systemAudioFiles = metadata.systemAudio
        self.duration = metadata.duration
        self.createdAt = metadata.createdAt
        self.modifiedAt = metadata.modifiedAt
        self.speakers = metadata.speakers
        self.transcript = metadata.transcript
        self.promptResults = metadata.promptResults
        self.tags = metadata.tags
        self.screenshots = metadata.screenshots
        self.userNotes = metadata.userNotes
    }
}
