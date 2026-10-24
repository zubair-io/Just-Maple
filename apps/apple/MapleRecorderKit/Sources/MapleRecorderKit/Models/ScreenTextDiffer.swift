import Foundation

/// Compares OCR output as a bag of normalized words so line wrapping and reading
/// order changes do not create false positives. Numeric-only tokens are ignored to
/// prevent clocks, timers, and progress counters from constantly triggering Assist.
enum ScreenTextDiffer {
    nonisolated static func isMeaningfullyDifferent(
        _ current: String,
        from previous: String?,
        windowChanged: Bool,
        minimumChangedWordCount: Int = 2,
        minimumChangedWordRatio: Double = 0.15,
        largeAbsoluteWordChange: Int = 8
    ) -> Bool {
        guard !windowChanged, let previous else { return true }

        let currentWords = wordCounts(in: current)
        let previousWords = wordCounts(in: previous)
        let currentCount = currentWords.values.reduce(0, +)
        let previousCount = previousWords.values.reduce(0, +)
        let maximumWordCount = max(currentCount, previousCount)
        guard maximumWordCount > 0 else { return false }

        let sharedWordCount = currentWords.reduce(into: 0) { result, entry in
            result += min(entry.value, previousWords[entry.key, default: 0])
        }
        let changedWordCount = maximumWordCount - sharedWordCount
        let changedWordRatio = Double(changedWordCount) / Double(maximumWordCount)

        return changedWordCount >= largeAbsoluteWordChange
            || (changedWordCount >= minimumChangedWordCount
                && changedWordRatio >= minimumChangedWordRatio)
    }

    private nonisolated static func wordCounts(in text: String) -> [String: Int] {
        let tokens = text.lowercased().split { character in
            !character.isLetter && !character.isNumber
        }

        return tokens.reduce(into: [:]) { result, token in
            // Ignore tokens such as "12" and "00", which commonly come from timers.
            guard token.contains(where: \.isLetter) else { return }
            result[String(token), default: 0] += 1
        }
    }
}
