import Testing
@testable import MapleRecorderKit

struct ScreenTextDifferTests {
    @Test func ignoresCasePunctuationOrderAndNumericCounters() {
        let previous = "Deploy the Maple recorder now. 00:10"
        let current = "00:15 RECORDER, maple the deploy now!"

        #expect(!ScreenTextDiffer.isMeaningfullyDifferent(current, from: previous, windowChanged: false))
    }

    @Test func oneChangedWordIsNotEnough() {
        let previous = "Review the current product roadmap with the engineering team"
        let current = "Review the updated product roadmap with the engineering team"

        #expect(!ScreenTextDiffer.isMeaningfullyDifferent(current, from: previous, windowChanged: false))
    }

    @Test func twoChangedWordsTriggerOnShortText() {
        let previous = "What is the current launch plan for customers"
        let current = "What is the revised rollout plan for customers"

        #expect(ScreenTextDiffer.isMeaningfullyDifferent(current, from: previous, windowChanged: false))
    }

    @Test func largeAbsoluteChangeTriggersOnDenseText() {
        let stableWords = (1...100).map { "stableword\($0)" }.joined(separator: " ")
        let previous = stableWords + " alpha bravo charlie delta echo foxtrot golf hotel"
        let current = stableWords + " india juliet kilo lima mike november oscar papa"

        #expect(ScreenTextDiffer.isMeaningfullyDifferent(current, from: previous, windowChanged: false))
    }

    @Test func firstFrameAndWindowSwitchAlwaysTrigger() {
        let text = "No visible text change"

        #expect(ScreenTextDiffer.isMeaningfullyDifferent(text, from: nil, windowChanged: false))
        #expect(ScreenTextDiffer.isMeaningfullyDifferent(text, from: text, windowChanged: true))
    }
}
