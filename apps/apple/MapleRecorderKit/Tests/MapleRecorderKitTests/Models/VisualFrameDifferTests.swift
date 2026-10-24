import Testing
@testable import MapleRecorderKit

struct VisualFrameDifferTests {
    @Test func firstFrameIsRelevant() {
        #expect(VisualFrameDiffer.isMeaningfullyDifferent([40, 40, 40], from: nil, windowChanged: false))
    }

    @Test func identicalAndTinyChangesAreDropped() {
        let previous = [UInt8](repeating: 100, count: 100)
        var tinyChange = previous
        tinyChange[0] = 120

        #expect(!VisualFrameDiffer.isMeaningfullyDifferent(previous, from: previous, windowChanged: false))
        #expect(!VisualFrameDiffer.isMeaningfullyDifferent(tinyChange, from: previous, windowChanged: false))
    }

    @Test func broadVisualChangeIsKept() {
        let previous = [UInt8](repeating: 25, count: 100)
        let next = [UInt8](repeating: 180, count: 100)

        #expect(VisualFrameDiffer.isMeaningfullyDifferent(next, from: previous, windowChanged: false))
    }

    @Test func switchingWindowsAlwaysKeepsAFrame() {
        let frame = [UInt8](repeating: 80, count: 100)
        #expect(VisualFrameDiffer.isMeaningfullyDifferent(frame, from: frame, windowChanged: true))
    }
}
