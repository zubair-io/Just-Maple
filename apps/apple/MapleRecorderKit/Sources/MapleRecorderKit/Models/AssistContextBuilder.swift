#if !os(watchOS)
import Foundation

struct AssistTurnSnapshot: Sendable {
    let recognizedText: String
    let image: LLMImage?
    let response: String
}

struct AssistRequestContext: Sendable {
    let userMessage: String
    let images: [LLMImage]
}

enum AssistContextBuilder {
    static func build(
        currentScreenText: String,
        currentImage: LLMImage?,
        notes: String,
        previousTurns: [AssistTurnSnapshot],
        characterBudget: Int,
        includeImages: Bool
    ) -> AssistRequestContext {
        let hasHistory = !previousTurns.isEmpty
        let currentScreenBudget = Int(Double(characterBudget) * (hasHistory ? 0.45 : 0.7))
        let notesBudget = Int(Double(characterBudget) * (hasHistory ? 0.2 : 0.3))
        let visibleScreen = String(currentScreenText.prefix(currentScreenBudget))
        let recentNotes = String(notes.suffix(notesBudget))
        // Give history any space the current screen and notes did not use. This
        // normally lets cloud providers receive every prior turn verbatim.
        let historyBudget = max(0, characterBudget - visibleScreen.count - recentNotes.count)

        let previousContext = formattedHistory(previousTurns, characterBudget: historyBudget)

        var images: [LLMImage] = []
        if includeImages, let previousImage = previousTurns.last?.image {
            images.append(
                LLMImage(
                    data: previousImage.data,
                    mediaType: previousImage.mediaType,
                    label: "Most recent previous screen"
                )
            )
        }
        if includeImages, let currentImage {
            images.append(
                LLMImage(
                    data: currentImage.data,
                    mediaType: currentImage.mediaType,
                    label: "Current screen"
                )
            )
        }

        return AssistRequestContext(
            userMessage: """
                \(previousContext)Current visible screen text:
                ---
                \(visibleScreen)
                ---

                Presenter's current notes:
                ---
                \(recentNotes.isEmpty ? "No notes yet." : recentNotes)
                ---
                """,
            images: images
        )
    }

    /// Includes every completed Assist turn. When a provider's context window is
    /// tight, each turn is compacted evenly rather than dropping older turns, so
    /// the model retains continuity across the whole recording session.
    private static func formattedHistory(
        _ turns: [AssistTurnSnapshot],
        characterBudget: Int
    ) -> String {
        guard !turns.isEmpty else { return "" }

        let header = """
            Use the complete previous Assist history for continuity. Prioritize the current screen and notes.

            Previous Assist history (oldest to newest):

            """
        let fullHistory = header + turns.enumerated().map { index, turn in
            formattedTurn(
                index: index,
                total: turns.count,
                screenText: turn.recognizedText,
                response: turn.response
            )
        }.joined(separator: "\n\n") + "\n\n"
        guard fullHistory.count > characterBudget else { return fullHistory }

        let turnHeaders = turns.indices.map { index in
            "Previous turn \(index + 1) of \(turns.count):\nVisible screen OCR:\n---\n\n---\nAI response:\n---\n\n---\n"
        }
        let structuralCount = header.count + turnHeaders.reduce(0) { $0 + $1.count }
        let availableContent = max(0, characterBudget - structuralCount)
        let perTurnBudget = turns.isEmpty ? 0 : availableContent / turns.count
        let screenBudget = perTurnBudget / 2
        let responseBudget = perTurnBudget - screenBudget

        let history = turns.enumerated().map { index, turn in
            formattedTurn(
                index: index,
                total: turns.count,
                screenText: String(turn.recognizedText.prefix(screenBudget)),
                response: String(turn.response.prefix(responseBudget))
            )
        }.joined(separator: "\n\n")

        return header + history + "\n\n"
    }

    private static func formattedTurn(
        index: Int,
        total: Int,
        screenText: String,
        response: String
    ) -> String {
        """
        Previous turn \(index + 1) of \(total):
        Visible screen OCR:
        ---
        \(screenText)
        ---
        AI response:
        ---
        \(response)
        ---
        """
    }
}
#endif
