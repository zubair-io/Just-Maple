import Testing
import Foundation
@testable import MapleRecorderKit

/// Locks the `MapleRecording` equality contract that the recording list relies on.
/// SwiftUI uses `==` to decide whether a row's input changed; if equality ignored
/// the displayed fields, a row would not re-render after processing updated its
/// title (the stale-sidebar-title bug).
struct MapleRecordingEqualityTests {

    private func make(title: String = "Recording", summary: String = "", tags: [String] = [], modifiedAt: Date = Date(timeIntervalSince1970: 1000), id: UUID) -> MapleRecording {
        MapleRecording(id: id, title: title, summary: summary, modifiedAt: modifiedAt, tags: tags)
    }

    @Test func differsWhenTitleChanges() {
        let id = UUID()
        let a = make(title: "Recording Jun 1", id: id)
        let b = make(title: "Q4 Planning Sync", id: id)
        #expect(a != b)
    }

    @Test func differsWhenSummaryOrTagsOrModifiedAtChange() {
        let id = UUID()
        let base = make(id: id)
        #expect(base != make(summary: "new summary", id: id))
        #expect(base != make(tags: ["MEETING"], id: id))
        #expect(base != make(modifiedAt: Date(timeIntervalSince1970: 2000), id: id))
    }

    @Test func equalWhenAllDisplayedFieldsMatch() {
        let id = UUID()
        let when = Date(timeIntervalSince1970: 1234)
        let a = make(title: "Same", summary: "s", tags: ["A"], modifiedAt: when, id: id)
        let b = make(title: "Same", summary: "s", tags: ["A"], modifiedAt: when, id: id)
        #expect(a == b)
    }

    @Test func differentIdsAreNotEqual() {
        #expect(make(id: UUID()) != make(id: UUID()))
    }
}
