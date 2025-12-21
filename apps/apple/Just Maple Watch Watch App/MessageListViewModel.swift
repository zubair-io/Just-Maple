//
//  MessageListViewModel.swift
//  Just Maple Watch App
//
//  View model for message list
//

import Foundation
import Combine

@MainActor
class MessageListViewModel: ObservableObject {
    @Published var messages: [Message] = []
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var isSending = false

    let tag: Tag
    private let apiClient = APIClient.shared
    private var notificationObserver: AnyCancellable?

    init(tag: Tag) {
        self.tag = tag
        setupNotificationObserver()
    }

    deinit {
        notificationObserver?.cancel()
    }

    /// Setup notification observer for real-time updates
    private func setupNotificationObserver() {
        notificationObserver = NotificationCenter.default.publisher(
            for: NSNotification.Name("NewMessageReceived")
        )
        .sink { [weak self] notification in
            guard let self = self,
                  let userInfo = notification.userInfo,
                  let tagId = userInfo["tagId"] as? String,
                  tagId == self.tag.id else {
                return
            }

            print("[MessageList] 📬 Received notification for current tag, refreshing...")

            Task { @MainActor in
                await self.refresh()
            }
        }
    }

    /// Load messages for the tag
    func loadMessages() async {
        isLoading = true
        errorMessage = nil

        do {
            messages = try await apiClient.getMessages(tagId: tag.id, limit: 50)
            print("[MessageList] ✅ Loaded \(messages.count) messages for tag: \(tag.label)")
        } catch let error as APIClientError {
            errorMessage = error.localizedDescription
            print("[MessageList] ❌ Failed to load messages: \(error.localizedDescription)")
        } catch {
            errorMessage = "Failed to load messages"
            print("[MessageList] ❌ Failed to load messages: \(error)")
        }

        isLoading = false
    }

    /// Send a new message
    func sendMessage(text: String) async {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return
        }

        isSending = true

        do {
            // Convert plain text to TipTap content
            let content = TipTapParser.fromPlainText(text)

            // Send message
            let newMessage = try await apiClient.sendMessage(tagId: tag.id, content: content)

            // Add to list
            messages.append(newMessage)
            print("[MessageList] ✅ Message sent successfully")
        } catch let error as APIClientError {
            errorMessage = error.localizedDescription
            print("[MessageList] ❌ Failed to send message: \(error.localizedDescription)")
        } catch {
            errorMessage = "Failed to send message"
            print("[MessageList] ❌ Failed to send message: \(error)")
        }

        isSending = false
    }

    /// Refresh messages
    func refresh() async {
        await loadMessages()
    }
}
