//
//  Tag.swift
//  Shared Models
//
//  Tag (folder) data model matching API schema
//

import Foundation

/// Access level for shared users
enum AccessLevel: String, Codable, Hashable {
    case read = "read"
    case write = "write"
    case owner = "owner"
}

/// Shared user entry
struct SharedWithEntry: Codable, Hashable {
    let userId: String
    let accessLevel: AccessLevel
}

/// Sharing configuration for a tag
struct TagSharing: Codable, Hashable {
    let sharedWith: [SharedWithEntry]
    let isPublic: Bool?
}

/// Tag value - metadata for folder content type
enum TagValue: String, Codable, Hashable {
    case mixed = "mixed"
    case recordings = "recordings"
    case notes = "notes"
}

/// Tag (folder) model
struct Tag: Codable, Identifiable, Hashable {
    let id: String
    let type: String
    let value: TagValue
    let label: String
    let sharing: TagSharing
    let createdAt: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case type
        case value
        case label
        case sharing
        case createdAt
        case updatedAt
    }

    /// Check if current user is owner
    func isOwner(userId: String) -> Bool {
        sharing.sharedWith.contains { $0.userId == userId && $0.accessLevel == .owner }
    }

    /// Check if current user has write access
    func canWrite(userId: String) -> Bool {
        sharing.sharedWith.contains {
            $0.userId == userId && ($0.accessLevel == .write || $0.accessLevel == .owner)
        }
    }

    /// Check if tag is shared
    var isShared: Bool {
        sharing.sharedWith.count > 1 || sharing.isPublic == true
    }
}

/// Tag member with full user data (for displaying member list)
struct TagMember: Codable, Identifiable {
    let userId: String
    let email: String
    let displayName: String?
    let profilePictureUrl: String?
    let accessLevel: AccessLevel

    var id: String { userId }

    /// Get display name or fallback to email
    var effectiveDisplayName: String {
        displayName ?? email
    }
}

/// Input for creating a tag
struct CreateTagInput: Codable {
    let label: String
    let value: TagValue?
}

/// Input for updating a tag
struct UpdateTagInput: Codable {
    let label: String?
    let value: TagValue?
}
