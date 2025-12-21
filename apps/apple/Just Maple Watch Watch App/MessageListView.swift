//
//  MessageListView.swift
//  Just Maple Watch App
//
//  View showing messages in a tag with reply functionality
//

import SwiftUI

struct MessageListView: View {
    let tag: Tag

    @StateObject private var viewModel: MessageListViewModel
    @State private var showComposer = false

    init(tag: Tag) {
        self.tag = tag
        self._viewModel = StateObject(wrappedValue: MessageListViewModel(tag: tag))
    }

    var body: some View {
        VStack {
            if viewModel.isLoading && viewModel.messages.isEmpty {
                loadingView
            } else if let errorMessage = viewModel.errorMessage, viewModel.messages.isEmpty {
                errorView(errorMessage)
            } else if viewModel.messages.isEmpty {
                emptyView
            } else {
                messageListView
            }
        }
        .navigationTitle(tag.label)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .bottomBar) {
                Button {
                    showComposer = true
                } label: {
                    Label("Reply", systemImage: "plus.message")
                }
                .disabled(viewModel.isSending)
            }
        }
        .sheet(isPresented: $showComposer) {
            MessageComposerView { text in
                await viewModel.sendMessage(text: text)
            }
        }
        .task {
            await viewModel.loadMessages()
        }
    }

    // MARK: - Subviews

    private var loadingView: some View {
        VStack(spacing: 16) {
            ProgressView()
            Text("Loading messages...")
                .font(.caption)
                .foregroundColor(.secondary)
        }
    }

    private func errorView(_ message: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 36))
                .foregroundColor(.red)

            Text(message)
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)

            Button("Retry") {
                Task {
                    await viewModel.refresh()
                }
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
    }

    private var emptyView: some View {
        VStack(spacing: 16) {
            Image(systemName: "message")
                .font(.system(size: 48))
                .foregroundColor(.secondary)

            Text("No Messages")
                .font(.headline)

            Text("Send the first message")
                .font(.caption)
                .foregroundColor(.secondary)

            Button {
                showComposer = true
            } label: {
                Label("New Message", systemImage: "plus.message")
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
    }

    private var messageListView: some View {
        ScrollViewReader { proxy in
            List {
                ForEach(viewModel.messages) { message in
                    MessageRowView(message: message)
                        .id(message.id)
                }
            }
            .refreshable {
                await viewModel.refresh()
            }
            .onAppear {
                // Scroll to last message
                if let lastMessage = viewModel.messages.last {
                    proxy.scrollTo(lastMessage.id, anchor: .bottom)
                }
            }
        }
    }
}

// MARK: - Message Row View

struct MessageRowView: View {
    let message: Message

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Sender info
            HStack(spacing: 4) {
                Text(message.effectiveSenderName)
                    .font(.caption)
                    .fontWeight(.semibold)

                Spacer()

                Text(formattedDate)
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }

            // Message content
            Text(message.content.plainText)
                .font(.body)

            // Edit indicator
            if message.isEdited {
                Text("Edited")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .italic()
            }
        }
        .padding(.vertical, 4)
    }

    private var formattedDate: String {
        guard let date = ISO8601DateFormatter().date(from: message.createdAt) else {
            return message.createdAt
        }

        let now = Date()
        let calendar = Calendar.current

        if calendar.isDateInToday(date) {
            return date.formatted(date: .omitted, time: .shortened)
        } else if calendar.isDateInYesterday(date) {
            return "Yesterday"
        } else {
            return date.formatted(date: .abbreviated, time: .omitted)
        }
    }
}

// MARK: - Preview

#Preview {
    NavigationStack {
        MessageListView(
            tag: Tag(
                id: "1",
                type: "folder",
                value: .notes,
                label: "General",
                sharing: TagSharing(sharedWith: [], isPublic: false),
                createdAt: ISO8601DateFormatter().string(from: Date()),
                updatedAt: ISO8601DateFormatter().string(from: Date())
            )
        )
    }
}
