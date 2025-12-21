//
//  NoteContent.swift
//  Shared Models
//
//  TipTap/ProseMirror JSON content structure
//

import Foundation

/// Represents a TipTap/ProseMirror node
/// This is a recursive structure used for rich text content
struct NoteContent: Codable {
    let type: String
    let content: [NoteContent]?
    let attrs: [String: AnyCodable]?
    let text: String?

    /// Helper to check if this is a text node
    var isText: Bool {
        type == "text"
    }

    /// Helper to check if this is a paragraph
    var isParagraph: Bool {
        type == "paragraph"
    }

    /// Helper to extract plain text from content tree
    func extractPlainText() -> String {
        if let text = text {
            return text
        }

        guard let content = content else {
            return ""
        }

        return content.map { $0.extractPlainText() }.joined(separator: "")
    }
}

/// Type-erased wrapper for decoding arbitrary JSON values
/// Used for TipTap node attributes which can be any type
struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()

        if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.map { $0.value }
        } else if let dictionary = try? container.decode([String: AnyCodable].self) {
            value = dictionary.mapValues { $0.value }
        } else {
            value = NSNull()
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()

        switch value {
        case let bool as Bool:
            try container.encode(bool)
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let string as String:
            try container.encode(string)
        case let array as [Any]:
            try container.encode(array.map { AnyCodable($0) })
        case let dictionary as [String: Any]:
            try container.encode(dictionary.mapValues { AnyCodable($0) })
        default:
            try container.encodeNil()
        }
    }
}
