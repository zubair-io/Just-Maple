import Foundation

/// Pure comparison logic kept separate from ScreenCaptureKit so duplicate filtering
/// can be covered by unit tests on every platform.
enum VisualFrameDiffer {
    nonisolated static func isMeaningfullyDifferent(
        _ current: [UInt8],
        from previous: [UInt8]?,
        windowChanged: Bool,
        minimumMeanDifference: Double = 6,
        minimumChangedPixelRatio: Double = 0.04
    ) -> Bool {
        guard !windowChanged, let previous, previous.count == current.count else { return true }
        guard !current.isEmpty else { return false }

        var totalDifference = 0
        var changedPixels = 0
        for (old, new) in zip(previous, current) {
            let difference = abs(Int(old) - Int(new))
            totalDifference += difference
            if difference >= 18 { changedPixels += 1 }
        }

        let meanDifference = Double(totalDifference) / Double(current.count)
        let changedRatio = Double(changedPixels) / Double(current.count)
        return meanDifference >= minimumMeanDifference && changedRatio >= minimumChangedPixelRatio
    }
}
