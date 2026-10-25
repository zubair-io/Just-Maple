import Foundation
import Testing
@testable import MapleRecorderKit

struct AssistContextBuilderTests {
    @Test func includesAllPreviousAndCurrentTurnsInChronologicalOrder() {
        let firstImage = LLMImage(data: Data([0x01]), mediaType: "image/jpeg")
        let secondImage = LLMImage(data: Data([0x02]), mediaType: "image/jpeg")
        let currentImage = LLMImage(data: Data([0x02]), mediaType: "image/jpeg")
        let previousTurns = [
            AssistTurnSnapshot(
                recognizedText: "First previous question",
                image: firstImage,
                response: "First previous answer"
            ),
            AssistTurnSnapshot(
                recognizedText: "Second previous question",
                image: secondImage,
                response: "Second previous answer"
            ),
        ]

        let context = AssistContextBuilder.build(
            currentScreenText: "Current question",
            currentImage: currentImage,
            notes: "Current notes",
            previousTurns: previousTurns,
            characterBudget: 4_000,
            includeImages: true
        )

        #expect(context.userMessage.contains("First previous question"))
        #expect(context.userMessage.contains("First previous answer"))
        #expect(context.userMessage.contains("Second previous question"))
        #expect(context.userMessage.contains("Second previous answer"))
        #expect(context.userMessage.contains("Current question"))
        #expect(context.userMessage.contains("Current notes"))
        if let firstRange = context.userMessage.range(of: "First previous question"),
           let secondRange = context.userMessage.range(of: "Second previous question"),
           let currentRange = context.userMessage.range(of: "Current question") {
            #expect(firstRange.lowerBound < secondRange.lowerBound)
            #expect(secondRange.lowerBound < currentRange.lowerBound)
        }
        #expect(context.images.map(\.label) == ["Most recent previous screen", "Current screen"])
        #expect(context.images.map(\.data) == [secondImage.data, currentImage.data])
    }

    @Test func cloudImageOptOutStillKeepsTextContinuity() {
        let previousTurn = AssistTurnSnapshot(
            recognizedText: "Previous question",
            image: LLMImage(data: Data([0x01]), mediaType: "image/jpeg"),
            response: "Previous answer"
        )

        let context = AssistContextBuilder.build(
            currentScreenText: "Current question",
            currentImage: LLMImage(data: Data([0x02]), mediaType: "image/jpeg"),
            notes: "",
            previousTurns: [previousTurn],
            characterBudget: 4_000,
            includeImages: false
        )

        #expect(context.images.isEmpty)
        #expect(context.userMessage.contains("Previous question"))
        #expect(context.userMessage.contains("Previous answer"))
        #expect(context.userMessage.contains("No notes yet."))
    }

    @Test func tightContextKeepsEveryTurnRepresented() {
        let previousTurns = (1...12).map { number in
            AssistTurnSnapshot(
                recognizedText: "Screen \(number) " + String(repeating: "visible text ", count: 20),
                image: nil,
                response: "Answer \(number) " + String(repeating: "helpful response ", count: 20)
            )
        }

        let context = AssistContextBuilder.build(
            currentScreenText: "Current question",
            currentImage: nil,
            notes: "",
            previousTurns: previousTurns,
            characterBudget: 2_000,
            includeImages: false
        )

        for number in 1...12 {
            #expect(context.userMessage.contains("Previous turn \(number) of 12"))
        }
    }
}
