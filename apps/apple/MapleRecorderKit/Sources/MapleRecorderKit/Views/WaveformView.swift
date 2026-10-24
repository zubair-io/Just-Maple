import SwiftUI

struct WaveformView: View {
    let samples: [Float]

    var body: some View {
        GeometryReader { geometry in
            let barWidth: CGFloat = 3
            let spacing: CGFloat = 2
            let totalBarWidth = barWidth + spacing
            let barCount = max(1, Int(geometry.size.width / totalBarWidth))
            let displaySamples = recentSamples(count: barCount)
            let recentThreshold = Int(Double(displaySamples.count) * 0.8)

            HStack(alignment: .center, spacing: spacing) {
                ForEach(Array(displaySamples.enumerated()), id: \.offset) { index, amplitude in
                    let isRecent = index >= recentThreshold
                    RoundedRectangle(cornerRadius: 2)
                        .fill(isRecent ? MapleTheme.primary : MapleTheme.primaryLight)
                        .frame(
                            width: barWidth,
                            height: max(4, CGFloat(amplitude) * geometry.size.height)
                        )
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
        }
    }

    private func recentSamples(count: Int) -> [Float] {
        guard !samples.isEmpty else { return [] }
        let startIndex = max(0, samples.count - count)
        return Array(samples[startIndex...])
    }
}
