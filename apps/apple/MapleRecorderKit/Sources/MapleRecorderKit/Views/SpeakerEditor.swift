import SwiftUI

struct SpeakerEditor: ViewModifier {
    @Binding var recording: MapleRecording
    @Binding var editingSpeaker: Speaker?
    var onSave: (MapleRecording) -> Void

    @State private var newName: String = ""

    func body(content: Content) -> some View {
        content
            .alert("Rename Speaker", isPresented: showingAlert) {
                TextField("Speaker name", text: $newName)
                Button("Cancel", role: .cancel) {
                    editingSpeaker = nil
                }
                Button("Save") {
                    renameSpeaker()
                }
            } message: {
                if let speaker = editingSpeaker {
                    Text("Enter a new name for \(speaker.displayName)")
                }
            }
            .onChange(of: editingSpeaker) { _, newSpeaker in
                if let speaker = newSpeaker {
                    newName = speaker.displayName
                }
            }
    }

    private var showingAlert: Binding<Bool> {
        Binding(
            get: { editingSpeaker != nil },
            set: { if !$0 { editingSpeaker = nil } }
        )
    }

    private func renameSpeaker() {
        guard let speaker = editingSpeaker else { return }
        let trimmed = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        // Update speaker display name
        if let speakerIndex = recording.speakers.firstIndex(where: { $0.id == speaker.id }) {
            recording.speakers[speakerIndex].displayName = trimmed
        }

        onSave(recording)
        editingSpeaker = nil
    }
}

extension View {
    func speakerEditor(
        recording: Binding<MapleRecording>,
        editingSpeaker: Binding<Speaker?>,
        onSave: @escaping (MapleRecording) -> Void
    ) -> some View {
        modifier(SpeakerEditor(recording: recording, editingSpeaker: editingSpeaker, onSave: onSave))
    }
}
