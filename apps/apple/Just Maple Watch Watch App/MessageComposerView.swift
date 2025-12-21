//
//  MessageComposerView.swift
//  Just Maple Watch App
//
//  Message composition view with dictation and scribble support
//

import SwiftUI

struct MessageComposerView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var messageText = ""
    @State private var isSending = false

    let onSend: (String) async -> Void

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                // Text input
                TextField("Message", text: $messageText, axis: .vertical)
                    .lineLimit(3...6)

                // Input method buttons
                HStack(spacing: 12) {
                    // Dictation button
                    Button {
                        // TextField automatically supports dictation
                        // User can tap microphone icon in keyboard
                    } label: {
                        VStack {
                            Image(systemName: "mic.fill")
                                .font(.title3)
                            Text("Dictate")
                                .font(.caption2)
                        }
                    }
                    .buttonStyle(.bordered)

                    // Scribble button
                    Button {
                        // On watchOS, scribble is automatic when user starts writing
                        // This is a hint for the user
                    } label: {
                        VStack {
                            Image(systemName: "scribble")
                                .font(.title3)
                            Text("Scribble")
                                .font(.caption2)
                        }
                    }
                    .buttonStyle(.bordered)
                }

                Spacer()

                // Send button
                Button {
                    sendMessage()
                } label: {
                    if isSending {
                        ProgressView()
                            .progressViewStyle(.circular)
                    } else {
                        Label("Send", systemImage: "paperplane.fill")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(messageText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                    isSending)
            }
            .padding()
            .navigationTitle("New Message")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .disabled(isSending)
                }
            }
        }
    }

    private func sendMessage() {
        guard !messageText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return
        }

        isSending = true

        Task {
            await onSend(messageText)
            isSending = false

            // Dismiss sheet on success
            await MainActor.run {
                dismiss()
            }
        }
    }
}

// MARK: - Preview

#Preview {
    MessageComposerView { text in
        print("Sending message: \(text)")
        try? await Task.sleep(nanoseconds: 1_000_000_000)
    }
}
