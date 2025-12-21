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
            await viewModel.connectSignalR()
        }
        .onDisappear {
            viewModel.disconnectSignalR()
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
                ForEach(groupedMessages, id: \.id) { group in
                    MessageGroupView(group: group)
                        .id(group.id)
                }
            }
            .refreshable {
                await viewModel.refresh()
            }
            .onAppear {
                // Scroll to last message group
                if let lastGroup = groupedMessages.last {
                    proxy.scrollTo(lastGroup.id, anchor: .bottom)
                }
            }
        }
    }

    private var groupedMessages: [MessageGroup] {
        var groups: [MessageGroup] = []
        var currentGroup: [Message] = []
        var currentUserId: String?

        for message in viewModel.messages {
            if currentUserId == message.userId {
                // Same user, add to current group
                currentGroup.append(message)
            } else {
                // Different user, save current group and start new one
                if !currentGroup.isEmpty {
                    groups.append(MessageGroup(messages: currentGroup))
                }
                currentGroup = [message]
                currentUserId = message.userId
            }
        }

        // Add final group
        if !currentGroup.isEmpty {
            groups.append(MessageGroup(messages: currentGroup))
        }

        return groups
    }
}

// MARK: - Message Group Model

struct MessageGroup: Identifiable {
    let id: String
    let messages: [Message]
    let userId: String
    let senderName: String

    init(messages: [Message]) {
        self.messages = messages
        self.id = messages.map(\.id).joined(separator: "-")
        self.userId = messages.first?.userId ?? ""
        self.senderName = messages.first?.effectiveSenderName ?? "Unknown"
    }
}

// MARK: - Message Group View

struct MessageGroupView: View {
    let group: MessageGroup

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            // Sender name
            Text(group.senderName)
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundColor(.secondary)

            // All messages stacked (no bubble)
            VStack(alignment: .leading, spacing: 6) {
                ForEach(group.messages) { message in
                    VStack(alignment: .leading, spacing: 2) {
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
                }
            }
        }
        .padding(.vertical, 4)
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
