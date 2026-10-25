import SwiftUI

struct TranscriptRowView: View {
    let segment: TranscriptSegment
    let speaker: Speaker?
    let isActive: Bool
    let activeWordId: UUID?
    var onTapWord: ((WordTiming) -> Void)?
    var onTapSpeaker: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Top row: speaker name + timestamp
            HStack {
                Button {
                    onTapSpeaker?()
                } label: {
                    Text(speaker?.displayName ?? segment.speakerId)
                        .font(.subheadline)
                        .fontWeight(.bold)
                        .foregroundStyle(speakerColor)
                }
                .buttonStyle(.plain)

                Spacer()

                Text(formatTimestamp(segment.start))
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(MapleTheme.textSecondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(MapleTheme.surfaceAlt, in: .capsule)
            }

            // Body: word-level text
            FlowLayout(spacing: 0) {
                ForEach(segment.words) { word in
                    Text(word.word + " ")
                        .font(.body)
                        .foregroundStyle(MapleTheme.textPrimary)
                        .padding(.vertical, 1)
                        .background(
                            word.id == activeWordId
                                ? MapleTheme.primary.opacity(0.25)
                                : Color.clear,
                            in: .rect(cornerRadius: 3)
                        )
                        .onTapGesture {
                            onTapWord?(word)
                        }
                }
            }
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 12)
        .padding(.leading, 4)
        .overlay(alignment: .leading) {
            if isActive {
                RoundedRectangle(cornerRadius: 2)
                    .fill(MapleTheme.primary)
                    .frame(width: 4)
            }
        }
        .background(
            isActive ? MapleTheme.primaryLight.opacity(0.1) : Color.clear,
            in: .rect(cornerRadius: 8)
        )
    }

    private var speakerColor: Color {
        if let speaker {
            Color(speaker.color)
        } else {
            MapleTheme.primary
        }
    }

    private func formatTimestamp(_ time: TimeInterval) -> String {
        let minutes = Int(time) / 60
        let seconds = Int(time) % 60
        return String(format: "%d:%02d", minutes, seconds)
    }
}
