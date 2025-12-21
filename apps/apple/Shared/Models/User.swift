//
//  User.swift
//  Shared Models
//
//  User data model matching API schema
//

import Foundation

/// User model
struct User: Codable, Identifiable {
    let id: String
    let email: String
    let displayName: String?
    let profilePictureUrl: String?
    let createdAt: String
    let updatedAt: String

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case email
        case displayName
        case profilePictureUrl
        case createdAt
        case updatedAt
    }

    /// Get display name or fallback to email
    var effectiveDisplayName: String {
        displayName ?? email
    }

    /// Get initials for avatar fallback
    var initials: String {
        if let displayName = displayName, !displayName.isEmpty {
            let components = displayName.split(separator: " ")
            if components.count >= 2 {
                return String(components[0].prefix(1) + components[1].prefix(1))
                    .uppercased()
            } else {
                return String(displayName.prefix(2)).uppercased()
            }
        }
        return String(email.prefix(2)).uppercased()
    }
}

/// User response model (lighter version without timestamps)
struct UserResponse: Codable, Identifiable {
    let id: String
    let email: String
    let displayName: String?
    let profilePictureUrl: String?

    enum CodingKeys: String, CodingKey {
        case id = "_id"
        case email
        case displayName
        case profilePictureUrl
    }
}
