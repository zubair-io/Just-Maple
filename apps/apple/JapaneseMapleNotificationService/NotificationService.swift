//
//  NotificationService.swift
//  JapaneseMapleNotificationService
//
//  Created by Zubair Lawrence on 12/20/25.
//

import UserNotifications

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

        // Extract profile picture URL from notification payload
        guard let profilePictureUrl = bestAttemptContent.userInfo["senderProfilePictureUrl"] as? String,
              !profilePictureUrl.isEmpty,
              let imageUrl = URL(string: profilePictureUrl) else {
            print("[NotificationService] No profile picture URL found, delivering notification as-is")
            contentHandler(bestAttemptContent)
            return
        }

        print("[NotificationService] Downloading profile picture from: \(imageUrl)")

        // Download and attach profile picture
        Task {
            do {
                let attachment = try await downloadImageAttachment(from: imageUrl)
                bestAttemptContent.attachments = [attachment]
                print("[NotificationService] ✅ Profile picture attached successfully")
                contentHandler(bestAttemptContent)
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

    private func downloadImageAttachment(from url: URL) async throws -> UNNotificationAttachment {
        // Download image data
        let (data, response) = try await URLSession.shared.data(from: url)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw NotificationServiceError.downloadFailed
        }

        print("[NotificationService] Downloaded \(data.count) bytes")

        // Determine file extension from URL or content type
        var fileExtension = url.pathExtension
        if fileExtension.isEmpty {
            // Try to get from content type
            if let mimeType = httpResponse.mimeType {
                fileExtension = mimeType.components(separatedBy: "/").last ?? "jpg"
            } else {
                fileExtension = "jpg"
            }
        }

        // Save to temporary file
        let tempDirectory = FileManager.default.temporaryDirectory
        let fileName = "\(UUID().uuidString).\(fileExtension)"
        let fileURL = tempDirectory.appendingPathComponent(fileName)

        try data.write(to: fileURL)
        print("[NotificationService] Saved to: \(fileURL)")

        // Determine type hint based on extension
        let typeHint: String
        switch fileExtension.lowercased() {
        case "jpg", "jpeg":
            typeHint = "public.jpeg"
        case "png":
            typeHint = "public.png"
        case "gif":
            typeHint = "public.gif"
        default:
            typeHint = "public.jpeg"
        }

        // Create attachment
        let attachment = try UNNotificationAttachment(
            identifier: "profile-picture",
            url: fileURL,
            options: [UNNotificationAttachmentOptionsTypeHintKey: typeHint]
        )

        return attachment
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
