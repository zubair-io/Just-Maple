//
//  NotificationService.swift
//  JapaneseMapleNotificationService
//
//  Created by Zubair Lawrence on 12/20/25.
//

import UserNotifications
import Intents

class NotificationService: UNNotificationServiceExtension {

    var contentHandler: ((UNNotificationContent) -> Void)?
    var bestAttemptContent: UNMutableNotificationContent?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        self.contentHandler = contentHandler
        bestAttemptContent = (request.content.mutableCopy() as? UNMutableNotificationContent)

        guard let bestAttemptContent = bestAttemptContent else {
            contentHandler(request.content)
            return
        }

        print("[NotificationService] Received notification: \(request.identifier)")
        print("[NotificationService] User info: \(bestAttemptContent.userInfo)")

        // Extract sender info from notification payload
        guard let profilePictureUrl = bestAttemptContent.userInfo["senderProfilePictureUrl"] as? String,
              !profilePictureUrl.isEmpty,
              let imageUrl = URL(string: profilePictureUrl) else {
            print("[NotificationService] No profile picture URL found, delivering notification as-is")
            contentHandler(bestAttemptContent)
            return
        }

        // Get sender name from title or userInfo
        let senderName = bestAttemptContent.userInfo["senderName"] as? String ?? bestAttemptContent.title

        print("[NotificationService] Downloading profile picture from: \(imageUrl)")

        // Download and set as communication notification with sender avatar
        Task {
            do {
                // Download the image
                let avatarImage = try await downloadImage(from: imageUrl)

                // Create sender person with avatar
                let senderHandle = INPersonHandle(value: senderName, type: .unknown)
                let avatar = INImage(imageData: avatarImage)
                let sender = INPerson(
                    personHandle: senderHandle,
                    nameComponents: nil,
                    displayName: senderName,
                    image: avatar,
                    contactIdentifier: nil,
                    customIdentifier: nil
                )

                // Create communication intent (message)
                let intent = INSendMessageIntent(
                    recipients: nil,
                    outgoingMessageType: .outgoingMessageText,
                    content: bestAttemptContent.body,
                    speakableGroupName: nil,
                    conversationIdentifier: bestAttemptContent.threadIdentifier,
                    serviceName: nil,
                    sender: sender,
                    attachments: nil
                )

                // Donate the intent interaction for Siri suggestions
                let interaction = INInteraction(intent: intent, response: nil)
                interaction.direction = .incoming
                interaction.donate(completion: nil)

                // Update notification content to use the communication intent
                do {
                    let updatedContent = try bestAttemptContent.updating(from: intent)
                    print("[NotificationService] ✅ Profile picture set as sender avatar successfully")
                    contentHandler(updatedContent)
                } catch {
                    print("[NotificationService] ⚠️ Failed to update content from intent: \(error)")
                    // Fallback: deliver original notification
                    contentHandler(bestAttemptContent)
                }
            } catch {
                print("[NotificationService] ❌ Failed to download profile picture: \(error)")
                // Deliver notification without image
                contentHandler(bestAttemptContent)
            }
        }
    }

    override func serviceExtensionTimeWillExpire() {
        // Called just before the extension will be terminated by the system.
        print("[NotificationService] ⏰ Service extension time will expire")
        if let contentHandler = contentHandler, let bestAttemptContent = bestAttemptContent {
            contentHandler(bestAttemptContent)
        }
    }

    private func downloadImage(from url: URL) async throws -> Data {
        // Download image data
        let (data, response) = try await URLSession.shared.data(from: url)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw NotificationServiceError.downloadFailed
        }

        print("[NotificationService] Downloaded \(data.count) bytes")
        return data
    }

    enum NotificationServiceError: Error {
        case downloadFailed

        var localizedDescription: String {
            switch self {
            case .downloadFailed:
                return "Failed to download profile picture"
            }
        }
    }
}
