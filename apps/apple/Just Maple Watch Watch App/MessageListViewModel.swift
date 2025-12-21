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
    private let signalR = SignalRManager.shared
    private var notificationObserver: AnyCancellable?
    private var signalRSubscription: AnyCancellable?

    init(tag: Tag) {
        self.tag = tag
        setupNotificationObserver()
        setupSignalRObserver()
    }

    deinit {
        notificationObserver?.cancel()
        signalRSubscription?.cancel()

        // Unsubscribe from SignalR on background thread
        let tagId = tag.id
        Task { @MainActor in
            SignalRManager.shared.unsubscribe(from: tagId)
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

    /// Setup SignalR observer for instant real-time updates (when app is open)
    private func setupSignalRObserver() {
        print("[MessageList] 🎧 Setting up SignalR observer for tag: \(tag.id)")
        signalRSubscription = signalR.eventsForTag(tag.id)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in
                guard let self = self else { return }

                print("[MessageList] ⚡⚡⚡ SignalR event received! Action: \(event.action), Tag: \(event.tagId), User: \(event.userId)")

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
        print("[MessageList] ✅ SignalR observer setup complete")
    }

    /// Connect to SignalR and subscribe to this tag
    func connectSignalR() async {
        print("[MessageList] 🔌 Connecting to SignalR for tag: \(tag.id)")

        // Connect to SignalR if not already connected
        if signalR.connectionStatus == .disconnected {
            print("[MessageList] 📡 SignalR is disconnected, connecting...")
            await signalR.connect()
            print("[MessageList] ✅ SignalR connection attempt complete, status: \(signalR.connectionStatus)")
        } else {
            print("[MessageList] ℹ️ SignalR already connected, status: \(signalR.connectionStatus)")
        }

        // Subscribe to this tag
        print("[MessageList] 📥 Subscribing to tag: \(tag.id)")
        signalR.subscribe(to: tag.id)
        print("[MessageList] ✅ Subscribe request sent")
    }

    /// Disconnect from SignalR when leaving
    func disconnectSignalR() {
        signalR.unsubscribe(from: tag.id)
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
