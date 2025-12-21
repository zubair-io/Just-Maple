//
//  TipTapParser.swift
//  Shared Services
//
//  Parser for TipTap/ProseMirror JSON to AttributedString
//

import Foundation
import SwiftUI

#if os(iOS)
    import UIKit
#elseif os(watchOS)
    import WatchKit
#endif

/// Parser to convert TipTap/ProseMirror JSON to AttributedString
class TipTapParser {
    /// Parse TipTap content to AttributedString with basic formatting
    static func parse(_ content: NoteContent) -> AttributedString {
        var result = AttributedString()
        parseNode(content, into: &result, marks: [])
        return result
    }

    /// Parse TipTap content to plain text (no formatting)
    static func toPlainText(_ content: NoteContent) -> String {
        content.extractPlainText()
    }

    /// Create a simple text NoteContent from plain text
    static func fromPlainText(_ text: String) -> NoteContent {
        NoteContent(
            type: "doc",
            content: [
                NoteContent(
                    type: "paragraph",
                    content: [
                        NoteContent(
                            type: "text",
                            content: nil,
                            attrs: nil,
                            text: text
                        ),
                    ],
                    attrs: nil,
                    text: nil
                ),
            ],
            attrs: nil,
            text: nil
        )
    }

    // MARK: - Private Parsing

    private static func parseNode(
        _ node: NoteContent,
        into result: inout AttributedString,
        marks: [String]
    ) {
        switch node.type {
        case "doc":
            // Root node - parse children
            if let children = node.content {
                for child in children {
                    parseNode(child, into: &result, marks: marks)
                }
            }

        case "paragraph":
            // Paragraph - parse children and add newline
            if let children = node.content {
                for child in children {
                    parseNode(child, into: &result, marks: marks)
                }
            }
            result.append(AttributedString("\n"))

        case "heading":
            // Heading - parse children with bold and add newline
            if let children = node.content {
                var headingMarks = marks
                headingMarks.append("bold")
                for child in children {
                    parseNode(child, into: &result, marks: headingMarks)
                }
            }
            result.append(AttributedString("\n"))

        case "text":
            // Text node - apply marks
            if let text = node.text {
                var attributedText = AttributedString(text)

                // Apply formatting based on marks
                if marks.contains("bold") {
                    #if os(iOS)
                        attributedText.font = .boldSystemFont(ofSize: 16)
                    #elseif os(watchOS)
                        attributedText.font = .system(.body, design: .default, weight: .bold)
                    #endif
                }

                if marks.contains("italic") {
                    #if os(iOS)
                        attributedText.font = .italicSystemFont(ofSize: 16)
                    #elseif os(watchOS)
                        attributedText.font = .system(.body, design: .default, weight: .regular)
                        // Note: WatchOS doesn't have direct italic support
                    #endif
                }

                if marks.contains("code") {
                    #if os(iOS)
                        attributedText.font = .monospacedSystemFont(ofSize: 14, weight: .regular)
                        attributedText.backgroundColor = UIColor.systemGray5
                    #elseif os(watchOS)
                        attributedText.font = .system(.body, design: .monospaced)
                    #endif
                }

                result.append(attributedText)
            }

        case "hardBreak":
            result.append(AttributedString("\n"))

        case "codeBlock":
            // Code block - parse children with monospace font
            if let children = node.content {
                var codeMarks = marks
                codeMarks.append("code")
                for child in children {
                    parseNode(child, into: &result, marks: codeMarks)
                }
            }
            result.append(AttributedString("\n"))

        case "bulletList", "orderedList":
            // List - parse children
            if let children = node.content {
                for child in children {
                    parseNode(child, into: &result, marks: marks)
                }
            }

        case "listItem":
            // List item - add bullet and parse children
            result.append(AttributedString("• "))
            if let children = node.content {
                for child in children {
                    parseNode(child, into: &result, marks: marks)
                }
            }

        default:
            // Unknown node type - try to parse children
            if let children = node.content {
                for child in children {
                    parseNode(child, into: &result, marks: marks)
                }
            }
        }
    }
}

// MARK: - Convenience Extensions

extension NoteContent {
    /// Get an AttributedString with formatting
    var attributedText: AttributedString {
        TipTapParser.parse(self)
    }

    /// Get plain text without formatting
    var plainText: String {
        TipTapParser.toPlainText(self)
    }
}
