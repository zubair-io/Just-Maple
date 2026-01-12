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
    private let webSocket = WebSocketManager.shared
    private var notificationObserver: AnyCancellable?
    private var webSocketSubscription: AnyCancellable?

    init(tag: Tag) {
        self.tag = tag
        setupNotificationObserver()
        setupWebSocketObserver()
    }

    deinit {
        notificationObserver?.cancel()
        webSocketSubscription?.cancel()

        // Unsubscribe from WebSocket on background thread
        let tagId = tag.id
        Task { @MainActor in
            WebSocketManager.shared.unsubscribe(from: tagId)
        }
    }

    /// Setup notification observer for real-time updates (fallback when app is closed)
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

            print("[MessageList] 📬 Push notification received for current tag, refreshing...")

            Task { @MainActor in
                await self.refresh()
            }
        }
    }

    /// Setup WebSocket observer for instant real-time updates (when app is open)
    private func setupWebSocketObserver() {
        print("[MessageList] 🎧 Setting up WebSocket observer for tag: \(tag.id)")
        webSocketSubscription = webSocket.eventsForTag(tag.id)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                guard let self = self else { return }

                print("[MessageList] ⚡⚡⚡ WebSocket event received! Action: \(event.action), Tag: \(event.tagId), User: \(event.userId)")

                switch event.action {
                case "message":
                    // New message - refresh list
                    print("[MessageList] 🔄 New message action - refreshing message list...")
                    Task {
                        await self.refresh()
                    }

                case "edited", "deleted":
                    // Message changed - refresh list
                    print("[MessageList] 🔄 Message \(event.action) - refreshing message list...")
                    Task {
                        await self.refresh()
                    }

                default:
                    print("[MessageList] ⚠️ Unknown action: \(event.action)")
                    break
                }
            }
        print("[MessageList] ✅ WebSocket observer setup complete")
    }

    /// Connect to WebSocket and subscribe to this tag
    func connectWebSocket() async {
        print("[MessageList] 🔌 Connecting to WebSocket for tag: \(tag.id)")

        // Connect to WebSocket if not already connected
        if webSocket.connectionStatus == .disconnected {
            print("[MessageList] 📡 WebSocket is disconnected, connecting...")
            await webSocket.connect()
            print("[MessageList] ✅ WebSocket connection attempt complete, status: \(webSocket.connectionStatus)")
        } else {
            print("[MessageList] ℹ️ WebSocket already connected, status: \(webSocket.connectionStatus)")
        }

        // Subscribe to this tag
        print("[MessageList] 📥 Subscribing to tag: \(tag.id)")
        webSocket.subscribe(to: tag.id)
        print("[MessageList] ✅ Subscribe request sent")
    }

    /// Disconnect from WebSocket when leaving
    func disconnectWebSocket() {
        webSocket.unsubscribe(from: tag.id)
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
