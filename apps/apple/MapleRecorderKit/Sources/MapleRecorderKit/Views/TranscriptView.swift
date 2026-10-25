import SwiftUI

struct TranscriptView: View {
    let transcript: [TranscriptSegment]
    let speakers: [Speaker]
    @Bindable var syncEngine: PlaybackSyncEngine
    var searchQuery: String = ""
    var onSeekToWord: ((WordTiming) -> Void)?
    var onRenameSpeaker: ((Speaker) -> Void)?

    @State private var isUserScrolling = false

    private var speakerDict: [String: Speaker] {
        Dictionary(uniqueKeysWithValues: speakers.map { ($0.id, $0) })
    }

    private var filteredTranscript: [TranscriptSegment] {
        if searchQuery.isEmpty { return transcript }
        return transcript.filter {
            $0.text.localizedCaseInsensitiveContains(searchQuery)
        }
    }

    var body: some View {
        let dict = speakerDict
        ScrollViewReader { proxy in
            LazyVStack(alignment: .leading, spacing: 4) {
                ForEach(filteredTranscript) { segment in
                    let speaker = dict[segment.speakerId]
                    TranscriptRowView(
                        segment: segment,
                        speaker: speaker,
                        isActive: syncEngine.activeSegmentId == segment.id,
                        activeWordId: syncEngine.activeSegmentId == segment.id ? syncEngine.activeWordId : nil,
                        onTapWord: { word in
                            onSeekToWord?(word)
                        },
                        onTapSpeaker: {
                            if let speaker {
                                onRenameSpeaker?(speaker)
                            }
                        }
                    )
                    .id(segment.id)
                }
            }
            .onChange(of: syncEngine.activeSegmentId) { _, newId in
                if syncEngine.shouldAutoScroll, let id = newId {
                    withAnimation(.easeInOut(duration: 0.3)) {
                        proxy.scrollTo(id, anchor: .center)
                    }
                }
            }
        }

        // "Scroll to now" button
        if !syncEngine.shouldAutoScroll, syncEngine.activeSegmentId != nil {
            Button {
                syncEngine.shouldAutoScroll = true
            } label: {
                Label("Scroll to now", systemImage: "arrow.down.circle.fill")
                    .font(.caption)
                    .fontWeight(.medium)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(MapleTheme.surface, in: .capsule)
                    .shadow(color: .black.opacity(0.1), radius: 4, y: 2)
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.top, 4)
        }
    }

}
