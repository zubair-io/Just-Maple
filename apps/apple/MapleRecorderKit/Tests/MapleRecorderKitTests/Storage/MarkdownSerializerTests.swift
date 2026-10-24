import Testing
import Foundation
@testable import MapleRecorderKit

struct MarkdownSerializerTests {

    private let fixedDate = Date(timeIntervalSince1970: 1700000000)

    private func makeSampleRecording() -> MapleRecording {
        MapleRecording(
            title: "Team Standup",
            summary: "Discussion about Q4 goals and sprint planning.",
            notes: "Alice: Good morning, everyone.",
            audioFiles: ["abc123.m4a"],
            duration: 300.0,
            createdAt: fixedDate,
            modifiedAt: fixedDate,
            speakers: [
                Speaker(id: "s0", displayName: "Alice", color: "speaker0", embedding: nil),
                Speaker(id: "s1", displayName: "Bob", color: "speaker1", embedding: nil),
            ],
            transcript: [
                TranscriptSegment(
                    speakerId: "s0",
                    start: 0.0,
                    end: 3.0,
                    text: "Good morning everyone",
                    words: [
                        WordTiming(word: "Good", start: 0.0, end: 0.3),
                        WordTiming(word: "morning", start: 0.4, end: 0.8),
                        WordTiming(word: "everyone", start: 0.9, end: 1.5),
                    ]
                ),
            ],
            promptResults: []
        )
    }

    @Test func roundTrip() throws {
        let original = makeSampleRecording()
        let markdown = MarkdownSerializer.serialize(original)
        let deserialized = MarkdownSerializer.deserialize(markdown)

        #expect(deserialized != nil)
        let result = deserialized!

        #expect(result.id == original.id)
        #expect(result.title == "Team Standup")
        #expect(result.summary == "Discussion about Q4 goals and sprint planning.")
        #expect(result.notes == "Alice: Good morning, everyone.")
        #expect(result.audioFiles == ["abc123.m4a"])
        #expect(result.duration == 300.0)
        #expect(result.speakers.count == 2)
        #expect(result.speakers[0].displayName == "Alice")
        #expect(result.transcript.count == 1)
        #expect(result.transcript[0].text == "Good morning everyone")
        #expect(result.transcript[0].words.count == 3)

        // Verify new section format
        #expect(markdown.contains("## Summary"))
        #expect(markdown.contains("## Notes"))
        #expect(markdown.contains("## Details"))
        #expect(markdown.contains("## Transcript"))
    }

    @Test func emptyTranscript() throws {
        let recording = MapleRecording(
            title: "Silent Recording",
            summary: "",
            audioFiles: ["empty.m4a"],
            duration: 10.0,
            createdAt: fixedDate,
            modifiedAt: fixedDate
        )

        let markdown = MarkdownSerializer.serialize(recording)
        let result = MarkdownSerializer.deserialize(markdown)

        #expect(result != nil)
        #expect(result!.transcript.isEmpty)
        #expect(result!.speakers.isEmpty)
    }

    @Test func multiPartAudio() throws {
        let recording = MapleRecording(
            title: "Long Meeting",
            summary: "A very long meeting.",
            audioFiles: ["part1.m4a", "part2.m4a", "part3.m4a"],
            duration: 5400.0,
            createdAt: fixedDate,
            modifiedAt: fixedDate
        )

        let markdown = MarkdownSerializer.serialize(recording)
        let result = MarkdownSerializer.deserialize(markdown)

        #expect(result != nil)
        #expect(result!.audioFiles.count == 3)
        #expect(result!.audioFiles == ["part1.m4a", "part2.m4a", "part3.m4a"])
    }

    @Test func promptResults() throws {
        let recording = MapleRecording(
            title: "Meeting",
            summary: "Summary here.",
            audioFiles: ["test.m4a"],
            duration: 60.0,
            createdAt: fixedDate,
            modifiedAt: fixedDate,
            promptResults: [
                PromptResult(
                    id: UUID(),
                    promptName: "Action Items",
                    promptBody: "List action items",
                    llmProvider: .appleFoundationModels,
                    result: "1. Review PR\n2. Update docs",
                    createdAt: fixedDate
                )
            ]
        )

        let markdown = MarkdownSerializer.serialize(recording)

        #expect(markdown.contains("## AI Insights"))
        #expect(markdown.contains("### Action Items"))
        #expect(markdown.contains("Apple Foundation Models"))
        #expect(markdown.contains("1. Review PR"))

        // Deserialize should still work (prompt results come from JSON metadata)
        let result = MarkdownSerializer.deserialize(markdown)
        #expect(result != nil)
        #expect(result!.promptResults.count == 1)
        #expect(result!.promptResults[0].promptName == "Action Items")
    }

    @Test func emptySummary() throws {
        let recording = MapleRecording(
            title: "Quick Note",
            summary: "",
            audioFiles: ["note.m4a"],
            duration: 5.0,
            createdAt: fixedDate,
            modifiedAt: fixedDate
        )

        let markdown = MarkdownSerializer.serialize(recording)
        let result = MarkdownSerializer.deserialize(markdown)

        #expect(result != nil)
        #expect(result!.title == "Quick Note")
        #expect(result!.summary == "")
        // No Summary section when summary is empty
        #expect(!markdown.contains("## Summary"))
    }

    @Test func notesAndTimelineScreenshotsRoundTrip() throws {
        let recording = MapleRecording(
            title: "Presentation",
            audioFiles: ["presentation.m4a"],
            duration: 90,
            createdAt: fixedDate,
            modifiedAt: fixedDate,
            screenshots: [
                TimelineScreenshot(fileName: "frame-1.jpg", timestamp: 5),
                TimelineScreenshot(fileName: "frame-2.jpg", timestamp: 42),
            ],
            userNotes: "Follow up with the design team."
        )

        let markdown = MarkdownSerializer.serialize(recording)
        let result = MarkdownSerializer.deserialize(markdown)

        #expect(markdown.contains("## Presenter Notes"))
        #expect(markdown.contains("## Timeline Screenshots"))
        #expect(markdown.contains("[0:42](frame-2.jpg)"))
        #expect(result?.userNotes == "Follow up with the design team.")
        #expect(result?.screenshots.map(\.fileName) == ["frame-1.jpg", "frame-2.jpg"])
        #expect(result?.screenshots.map(\.timestamp) == [5, 42])
    }

    @Test func specialCharactersInTitle() throws {
        let recording = MapleRecording(
            title: "Meeting — Q4 \"Goals\" & Plans",
            summary: "Important discussion.",
            audioFiles: ["test.m4a"],
            duration: 60.0,
            createdAt: fixedDate,
            modifiedAt: fixedDate
        )

        let markdown = MarkdownSerializer.serialize(recording)
        let result = MarkdownSerializer.deserialize(markdown)

        #expect(result != nil)
        #expect(result!.title == "Meeting — Q4 \"Goals\" & Plans")
    }

    @Test func datePreservesISO8601() throws {
        let recording = MapleRecording(
            title: "Date Test",
            audioFiles: ["test.m4a"],
            createdAt: fixedDate,
            modifiedAt: fixedDate
        )

        let markdown = MarkdownSerializer.serialize(recording)
        #expect(markdown.contains("2023-11-14"))

        let result = MarkdownSerializer.deserialize(markdown)
        #expect(result != nil)
        #expect(abs(result!.createdAt.timeIntervalSince1970 - fixedDate.timeIntervalSince1970) < 1)
    }

    // MARK: - New Format Tests

    @Test func detailsSectionSerialization() throws {
        let recording = makeSampleRecording()
        let markdown = MarkdownSerializer.serialize(recording)

        #expect(markdown.contains("## Details"))
        #expect(markdown.contains("- **Duration**: 5:00"))
        #expect(markdown.contains("- **Speakers**: 2"))
        #expect(markdown.contains("- **Date**:"))
    }

    @Test func tagsSectionSerialization() throws {
        let recording = MapleRecording(
            title: "Tagged Recording",
            summary: "Has tags.",
            audioFiles: ["test.m4a"],
            duration: 60.0,
            createdAt: fixedDate,
            modifiedAt: fixedDate,
            tags: ["planning", "quarterly-review"]
        )

        let markdown = MarkdownSerializer.serialize(recording)

        #expect(markdown.contains("## Tags"))
        #expect(markdown.contains("#planning"))
        #expect(markdown.contains("#quarterly-review"))

        // Round-trip: tags come from JSON, not from ## Tags section
        let result = MarkdownSerializer.deserialize(markdown)
        #expect(result != nil)
        #expect(result!.tags == ["planning", "quarterly-review"])
    }

    @Test func noTagsSectionWhenEmpty() throws {
        let recording = MapleRecording(
            title: "No Tags",
            audioFiles: ["test.m4a"],
            createdAt: fixedDate,
            modifiedAt: fixedDate
        )

        let markdown = MarkdownSerializer.serialize(recording)
        #expect(!markdown.contains("## Tags"))
    }

    @Test func transcriptSectionSerialization() throws {
        let recording = makeSampleRecording()
        let markdown = MarkdownSerializer.serialize(recording)

        #expect(markdown.contains("## Transcript"))
        #expect(markdown.contains("**Alice** (0:00): Good morning everyone"))
    }

    @Test func noTranscriptSectionWhenEmpty() throws {
        let recording = MapleRecording(
            title: "No Transcript",
            audioFiles: ["test.m4a"],
            createdAt: fixedDate,
            modifiedAt: fixedDate
        )

        let markdown = MarkdownSerializer.serialize(recording)
        #expect(!markdown.contains("## Transcript"))
    }

    @Test func fullRoundTripAllSections() throws {
        let recording = MapleRecording(
            title: "Full Meeting",
            summary: "Complete meeting with all sections.",
            notes: "Alice: Hello, team.\n\nBob: Hi, everyone.",
            audioFiles: ["full.m4a"],
            duration: 600.0,
            createdAt: fixedDate,
            modifiedAt: fixedDate,
            speakers: [
                Speaker(id: "s0", displayName: "Alice", color: "speaker0", embedding: nil),
                Speaker(id: "s1", displayName: "Bob", color: "speaker1", embedding: nil),
            ],
            transcript: [
                TranscriptSegment(
                    speakerId: "s0",
                    start: 0.0,
                    end: 3.0,
                    text: "Hello team",
                    words: [
                        WordTiming(word: "Hello", start: 0.0, end: 0.5),
                        WordTiming(word: "team", start: 0.6, end: 1.0),
                    ]
                ),
                TranscriptSegment(
                    speakerId: "s1",
                    start: 3.5,
                    end: 6.0,
                    text: "Hi everyone",
                    words: [
                        WordTiming(word: "Hi", start: 3.5, end: 3.8),
                        WordTiming(word: "everyone", start: 3.9, end: 4.5),
                    ]
                ),
            ],
            promptResults: [
                PromptResult(
                    id: UUID(),
                    promptName: "Action Items",
                    promptBody: "List action items",
                    llmProvider: .claude,
                    result: "1. Follow up on design\n2. Schedule review",
                    createdAt: fixedDate
                ),
            ],
            tags: ["standup", "engineering"]
        )

        let markdown = MarkdownSerializer.serialize(recording)

        // Verify all sections present
        #expect(markdown.contains("# Full Meeting"))
        #expect(markdown.contains("## Summary"))
        #expect(markdown.contains("## Notes"))
        #expect(markdown.contains("## Details"))
        #expect(markdown.contains("## Tags"))
        #expect(markdown.contains("## Transcript"))
        #expect(markdown.contains("## AI Insights"))
        #expect(markdown.contains("### Action Items"))

        // Round-trip
        let result = MarkdownSerializer.deserialize(markdown)
        #expect(result != nil)
        let r = result!
        #expect(r.title == "Full Meeting")
        #expect(r.summary == "Complete meeting with all sections.")
        #expect(r.notes == "Alice: Hello, team.\n\nBob: Hi, everyone.")
        #expect(r.tags == ["standup", "engineering"])
        #expect(r.speakers.count == 2)
        #expect(r.transcript.count == 2)
        #expect(r.promptResults.count == 1)
        #expect(r.duration == 600.0)
    }

    @Test func legacyMeetingOverviewStillDeserializes() throws {
        let recording = makeSampleRecording()
        let legacyMarkdown = MarkdownSerializer.serialize(recording)
            .replacingOccurrences(of: "## Summary", with: "## Meeting Overview")

        #expect(MarkdownSerializer.deserialize(legacyMarkdown)?.summary == recording.summary)
    }

    @Test func notesSidecarRoundTrip() {
        let recording = makeSampleRecording()
        let markdown = MarkdownSerializer.serializeNotes(recording)

        #expect(markdown.hasPrefix("# Team Standup — Notes"))
        #expect(MarkdownSerializer.deserializeNotes(markdown) == recording.notes)
    }
}
