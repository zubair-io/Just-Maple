//
//  APIResponse.swift
//  Shared Models
//
//  Generic API response wrappers
//

import Foundation

/// Generic API response wrapper
struct APIResponse<T: Codable>: Codable {
    let data: T?
    let error: String?
    let message: String?

    var isSuccess: Bool {
        error == nil
    }

    var isError: Bool {
        error != nil
    }
}

/// API response for lists/arrays
struct APIListResponse<T: Codable>: Codable {
    let data: [T]?
    let error: String?
    let message: String?

    var isSuccess: Bool {
        error == nil
    }

    var isError: Bool {
        error != nil
    }

    var items: [T] {
        data ?? []
    }
}

/// API error response
struct APIError: Codable, Error {
    let error: String
    let message: String?

    var localizedDescription: String {
        message ?? error
    }
}

/// Tags API response (matches API format)
struct TagsResponse: Codable {
    let tags: [Tag]
}

/// Messages API response (matches API format)
struct MessagesResponse: Codable {
    let messages: [Message]
}

/// Single message API response
struct MessageResponse: Codable {
    let message: Message
}

/// Current user API response
struct MeResponse: Codable {
    let user: User
}
