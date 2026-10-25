import SwiftUI

/// Organic pulsing blob shapes that react to audio level.
/// Used around the stop button during recording for a lively waveform effect.
struct PulsingWaveform: View {
    var audioLevel: Float

    private static let ringCount = 4
    private static let baseSize: CGFloat = 160

    var body: some View {
        TimelineView(.animation) { timeline in
            PulsingWaveformCanvas(
                time: timeline.date.timeIntervalSinceReferenceDate,
                audioLevel: audioLevel
            )
        }
        .frame(width: Self.baseSize, height: Self.baseSize)
        .allowsHitTesting(false)
    }
}

/// Extracted Canvas rendering to help the type-checker.
private struct PulsingWaveformCanvas: View {
    let time: Double
    let audioLevel: Float

    private static let ringCount = 4
    private static let baseSize: CGFloat = 160

    var body: some View {
        let level = CGFloat(min(max(audioLevel, 0), 1))
        let glowColor = MapleTheme.primary.opacity(Double(level))

        Canvas { context, size in
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            drawRings(context: context, center: center, level: level)
        }
        .compositingGroup()
        .shadow(color: glowColor, radius: 8 + 16 * level)
    }

    private func drawRings(context: GraphicsContext, center: CGPoint, level: CGFloat) {
        for i in (0..<Self.ringCount).reversed() {
            let ring = CGFloat(i)
            let fraction = ring / CGFloat(Self.ringCount - 1)
            drawSingleRing(
                context: context,
                center: center,
                level: level,
                ring: ring,
                fraction: fraction
            )
        }
    }

    private func drawSingleRing(
        context: GraphicsContext,
        center: CGPoint,
        level: CGFloat,
        ring: CGFloat,
        fraction: CGFloat
    ) {
        let boosted = sqrt(level)

        let phase = Double(ring * 1.3)
        // Idle: rings visible around the button; sound makes them bloom outward
        let breatheWave = 1.0 + 0.4 * CGFloat(sin(time * 5.0 + phase))
        let growAmount = boosted * (0.7 + fraction * 0.5)
        let scale = 0.5 + growAmount * breatheWave
        let baseRadius = (Self.baseSize / 2) * (0.35 + fraction * 0.45)
        let radius = baseRadius * scale

        // Distortion increases with level for organic shapes when loud
        let distortion = Double(boosted) * (0.35 + Double(fraction) * 0.6)
        let path = organicBlobPath(
            center: center,
            radius: radius,
            time: time,
            phase: phase,
            distortion: distortion
        )

        // Always visible — brighter with more sound
        let ringOpacity = (0.35 + 0.65 * Double(boosted)) * (1.0 - Double(fraction) * 0.15)
        let lineWidth: CGFloat = 3.5 - fraction

        let fillColor = MapleTheme.primary.opacity(ringOpacity * 0.45)
        let strokeColor = MapleTheme.primary.opacity(ringOpacity * 0.85)

        context.fill(path, with: .color(fillColor))
        context.stroke(path, with: .color(strokeColor), lineWidth: lineWidth)
    }

    private func organicBlobPath(
        center: CGPoint,
        radius: CGFloat,
        time: Double,
        phase: Double,
        distortion: Double
    ) -> Path {
        let points = 120
        var path = Path()

        for i in 0...points {
            let angle = Double(i) / Double(points) * .pi * 2.0

            let wave1 = sin(angle * 2 + time * 1.8 + phase) * 0.4
            let wave2 = sin(angle * 3 - time * 1.2 + phase * 0.7) * 0.3
            let wave3 = sin(angle * 5 + time * 2.3 + phase * 1.4) * 0.15
            let wave4 = cos(angle * 4 - time * 0.9 + phase * 2.0) * 0.15
            let wave5 = sin(angle * 7 - time * 2.8 + phase * 1.1) * 0.2
            let wave6 = cos(angle * 6 + time * 1.5 + phase * 0.5) * 0.15
            let wave7 = sin(angle * 9 + time * 3.2 - phase * 1.8) * 0.1
            let wave8 = cos(angle * 8 - time * 2.1 + phase * 2.3) * 0.1

            let wobble = 1.0 + distortion * (wave1 + wave2 + wave3 + wave4 + wave5 + wave6 + wave7 + wave8)
            let r = radius * CGFloat(wobble)

            let x = center.x + CGFloat(cos(angle)) * r
            let y = center.y + CGFloat(sin(angle)) * r

            if i == 0 {
                path.move(to: CGPoint(x: x, y: y))
            } else {
                path.addLine(to: CGPoint(x: x, y: y))
            }
        }

        path.closeSubpath()
        return path
    }
}
