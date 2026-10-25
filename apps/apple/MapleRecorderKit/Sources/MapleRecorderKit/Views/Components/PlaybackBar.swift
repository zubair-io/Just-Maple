import SwiftUI

struct PlaybackBar: View {
    @Bindable var player: AudioPlayer
    var onToggle: () -> Void
    var onSeek: (TimeInterval) -> Void

    var body: some View {
        VStack(spacing: 8) {
            // Progress bar
            if player.duration > 0 {
                VStack(spacing: 2) {
                    ProgressView(value: player.currentTime, total: player.duration)
                        .tint(MapleTheme.primary)

                    HStack {
                        Text(formatTime(player.currentTime))
                        Spacer()
                        Text(formatTime(player.duration))
                    }
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(MapleTheme.textSecondary)
                }
            }

            // Controls
            HStack(spacing: 20) {
                // Speed button
                Button {
                    player.cycleSpeed()
                } label: {
                    Text(player.speed.label)
                        .font(.system(.caption, design: .monospaced, weight: .semibold))
                        .foregroundStyle(MapleTheme.textSecondary)
                        .frame(width: 40)
                }
                .buttonStyle(.plain)

                // Skip back 10s
                Button { player.skipBack(10) } label: {
                    Image(systemName: "gobackward.10")
                        .font(.title3)
                        .foregroundStyle(MapleTheme.textPrimary)
                }
                .buttonStyle(.plain)

                // Play/Pause
                Button {
                    onToggle()
                } label: {
                    Image(systemName: player.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                        .font(.system(size: 48))
                        .foregroundStyle(MapleTheme.primary)
                }
                .buttonStyle(.plain)

                // Skip forward 10s
                Button { player.skipForward(10) } label: {
                    Image(systemName: "goforward.10")
                        .font(.title3)
                        .foregroundStyle(MapleTheme.textPrimary)
                }
                .buttonStyle(.plain)

                Spacer()
                    .frame(width: 40)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background {
            VStack(spacing: 0) {
                Rectangle()
                    .fill(MapleTheme.border.opacity(0.15))
                    .frame(height: 1)
                MapleTheme.surface
            }
        }
    }

    private func formatTime(_ time: TimeInterval) -> String {
        let minutes = Int(time) / 60
        let seconds = Int(time) % 60
        return String(format: "%d:%02d", minutes, seconds)
    }
}
