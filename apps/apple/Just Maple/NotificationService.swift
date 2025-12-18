//
//  NotificationService.swift
//  JapaneseMaple Notification Service Extension
//
//  Created on 12/18/25.
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

        print("[NotificationService] 📥 Received notification: \(request.identifier)")
        print("[NotificationService] 📋 User Info: \(request.content.userInfo)")

        // Extract notification data
        let userInfo = request.content.userInfo

        // Handle media attachments if present
        if let imageUrlString = userInfo["imageUrl"] as? String,
           let imageUrl = URL(string: imageUrlString) {
            print("[NotificationService] 🖼️ Downloading image: \(imageUrlString)")
            downloadAndAttachMedia(url: imageUrl, to: bestAttemptContent) { [weak self] in
                self?.deliverNotification(bestAttemptContent)
            }
            return
        }

        // Handle video attachments if present
        if let videoUrlString = userInfo["videoUrl"] as? String,
           let videoUrl = URL(string: videoUrlString) {
            print("[NotificationService] 🎥 Downloading video: \(videoUrlString)")
            downloadAndAttachMedia(url: videoUrl, to: bestAttemptContent) { [weak self] in
                self?.deliverNotification(bestAttemptContent)
            }
            return
        }

        // Handle audio attachments if present
        if let audioUrlString = userInfo["audioUrl"] as? String,
           let audioUrl = URL(string: audioUrlString) {
            print("[NotificationService] 🔊 Downloading audio: \(audioUrlString)")
            downloadAndAttachMedia(url: audioUrl, to: bestAttemptContent) { [weak self] in
                self?.deliverNotification(bestAttemptContent)
            }
            return
        }

        // Enhance notification with server data if needed
        if let notificationId = userInfo["notificationId"] as? String,
           let serverKey = userInfo["serverKey"] as? String {
            print("[NotificationService] 🔄 Fetching notification details from server")
            fetchAndEnhanceNotification(notificationId: notificationId, serverKey: serverKey, content: bestAttemptContent) { [weak self] enhancedContent in
                self?.deliverNotification(enhancedContent)
            }
            return
        }

        // No special processing needed
        print("[NotificationService] ✅ Delivering notification without modifications")
        deliverNotification(bestAttemptContent)
    }

    override func serviceExtensionTimeWillExpire() {
        // Called just before the extension will be terminated by the system.
        // Use this as an opportunity to deliver your "best attempt" at modified content,
        // otherwise the original push payload will be used.
        print("[NotificationService] ⏰ Time expiring, delivering best attempt")
        if let contentHandler = contentHandler, let bestAttemptContent = bestAttemptContent {
            contentHandler(bestAttemptContent)
        }
    }

    // MARK: - Private Helpers

    private func deliverNotification(_ content: UNMutableNotificationContent) {
        print("[NotificationService] 📤 Delivering notification")
        contentHandler?(content)
        contentHandler = nil
    }

    private func downloadAndAttachMedia(url: URL, to content: UNMutableNotificationContent, completion: @escaping () -> Void) {
        let task = URLSession.shared.downloadTask(with: url) { [weak self] localURL, response, error in
            defer { completion() }

            guard let self = self,
                  let localURL = localURL,
                  error == nil else {
                print("[NotificationService] ❌ Failed to download media: \(error?.localizedDescription ?? "unknown error")")
                return
            }

            // Determine file extension from URL or MIME type
            let fileExtension = self.getFileExtension(from: url, response: response)

            // Create a unique filename with proper extension
            let tempDirectory = NSTemporaryDirectory()
            let filename = url.lastPathComponent.isEmpty ? "attachment" : url.lastPathComponent
            let destinationURL = URL(fileURLWithPath: tempDirectory).appendingPathComponent(filename).appendingPathExtension(fileExtension)

            do {
                // Move the downloaded file to a proper location
                try FileManager.default.moveItem(at: localURL, to: destinationURL)

                // Create attachment
                let attachment = try UNNotificationAttachment(identifier: UUID().uuidString, url: destinationURL, options: nil)
                content.attachments = [attachment]

                print("[NotificationService] ✅ Successfully attached media: \(filename)")
            } catch {
                print("[NotificationService] ❌ Failed to create attachment: \(error.localizedDescription)")
            }
        }

        task.resume()
    }

    private func getFileExtension(from url: URL, response: URLResponse?) -> String {
        // Try to get extension from URL first
        let urlExtension = url.pathExtension
        if !urlExtension.isEmpty {
            return urlExtension
        }

        // Fallback to MIME type
        if let mimeType = response?.mimeType {
            switch mimeType {
            case "image/jpeg", "image/jpg":
                return "jpg"
            case "image/png":
                return "png"
            case "image/gif":
                return "gif"
            case "video/mp4":
                return "mp4"
            case "video/quicktime":
                return "mov"
            case "audio/mpeg":
                return "mp3"
            case "audio/wav":
                return "wav"
            default:
                break
            }
        }

        // Default to jpg for images
        return "jpg"
    }

    private func fetchAndEnhanceNotification(notificationId: String, serverKey: String, content: UNMutableNotificationContent, completion: @escaping (UNMutableNotificationContent) -> Void) {
        // Look up serverId from serverKey using shared app group
        guard let sharedDefaults = UserDefaults(suiteName: "group.com.just.maple.JapaneseMaple"),
              let serverKeyMapData = sharedDefaults.data(forKey: "push_server_key_map"),
              let serverKeyMap = try? JSONDecoder().decode([String: String].self, from: serverKeyMapData),
              let serverId = serverKeyMap[serverKey] else {
            print("[NotificationService] ⚠️ Could not resolve serverId from serverKey")
            completion(content)
            return
        }

        // Get server configuration from shared app group
        guard let savedServersData = sharedDefaults.data(forKey: "saved_servers_shared"),
              let servers = try? JSONDecoder().decode([ServerConfig].self, from: savedServersData),
              let server = servers.first(where: { $0.id == serverId }) else {
            print("[NotificationService] ⚠️ Could not find server configuration")
            completion(content)
            return
        }

        let apiUrl = server.getAPIUrl()

        // Get auth token from shared keychain
        guard let token = getSharedToken(for: serverId) else {
            print("[NotificationService] ⚠️ No auth token found in shared keychain")
            completion(content)
            return
        }

        // Fetch notification details
        guard let url = URL(string: "\(apiUrl)/api/notifications/\(notificationId)") else {
            print("[NotificationService] ❌ Invalid API URL")
            completion(content)
            return
        }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 10

        let task = URLSession.shared.dataTask(with: request) { data, response, error in
            defer { completion(content) }

            guard let data = data,
                  error == nil,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                print("[NotificationService] ❌ Failed to fetch notification details: \(error?.localizedDescription ?? "unknown error")")
                return
            }

            print("[NotificationService] ✅ Fetched notification details: \(json)")

            // Enhance content with additional data
            if let title = json["title"] as? String {
                content.title = title
            }

            if let body = json["body"] as? String {
                content.body = body
            }

            if let badge = json["badge"] as? Int {
                content.badge = NSNumber(value: badge)
            }

            // Add any additional user info
            var userInfo = content.userInfo
            if let additionalData = json["data"] as? [String: Any] {
                for (key, value) in additionalData {
                    userInfo[key] = value
                }
            }
            content.userInfo = userInfo
        }

        task.resume()
    }

    private func getSharedToken(for serverId: String) -> String? {
        let keychainService = "com.just.maple.JapaneseMaple"
        let account = "bearer_token:\(serverId)"

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
            kSecAttrAccessGroup as String: "group.com.just.maple.JapaneseMaple" // Shared keychain access group
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess,
              let data = result as? Data,
              let token = String(data: data, encoding: .utf8) else {
            return nil
        }

        return token
    }

    // MARK: - Server Config Model (must match main app)

    struct ServerConfig: Codable {
        let id: String
        let name: String
        let url: String
        let apiUrl: String?
        let isCustom: Bool

        func getAPIUrl() -> String {
            return apiUrl ?? url
        }
    }
}
