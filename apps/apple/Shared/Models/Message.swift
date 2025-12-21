//
//  Message.swift
//  Shared Models
//
//  Chat message data model matching API schema
//

import Foundation

/// Chat message model
struct Message: Codable, Identifiable {
    let id: String
    let tagId: String
    let userId: String
    let senderEmail: String?
    let senderDisplayName: String?
    let senderProfilePictureUrl: String?
    let content: NoteContent
    let createdAt: String
    let updatedAt: String?
    let editedAt: String?
    let deletedAt: String?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case tagId
        case userId
        case senderEmail
        case senderDisplayName
        case senderProfilePictureUrl
        case content
        case createdAt
        case updatedAt
        case editedAt
        case deletedAt
    }

    /// Check if message has been edited
    var isEdited: Bool {
        editedAt != nil
    }

    /// Check if message has been deleted
    var isDeleted: Bool {
        deletedAt != nil
    }

    /// Get sender display name or fallback to email
    var effectiveSenderName: String {
        senderDisplayName ?? senderEmail ?? "Unknown"
    }

    /// Extract plain text preview from content
    var textPreview: String {
        content.extractPlainText()
    }
}

/// Input for creating a message
struct CreateMessageInput: Codable {
    let content: NoteContent
}

/// Input for updating a message
struct UpdateMessageInput: Codable {
    let content: NoteContent
}

/// Unread count per tag
struct UnreadCount: Codable {
    let tagId: String
    let count: Int
}
