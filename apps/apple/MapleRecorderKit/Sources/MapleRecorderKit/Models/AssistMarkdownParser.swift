import Foundation

enum AssistMarkdownBlock: Equatable {
    case heading(level: Int, text: String)
    case paragraph(String)
    case orderedListItem(number: Int, text: String)
    case unorderedListItem(String)
    case blockQuote(String)
    case code(language: String?, content: String)
    case divider
}

enum AssistMarkdownParser {
    static func parse(_ markdown: String) -> [AssistMarkdownBlock] {
        let normalized = markdown.replacingOccurrences(of: "\r\n", with: "\n")
        let lines = normalized.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)

        var blocks: [AssistMarkdownBlock] = []
        var paragraphLines: [String] = []
        var codeLines: [String] = []
        var codeFence: String?
        var codeLanguage: String?

        func flushParagraph() {
            guard !paragraphLines.isEmpty else { return }
            blocks.append(.paragraph(paragraphLines.joined(separator: "\n")))
            paragraphLines.removeAll(keepingCapacity: true)
        }

        func flushCode() {
            blocks.append(
                .code(
                    language: codeLanguage?.isEmpty == false ? codeLanguage : nil,
                    content: codeLines.joined(separator: "\n")
                )
            )
            codeLines.removeAll(keepingCapacity: true)
            codeFence = nil
            codeLanguage = nil
        }

        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            if let codeFence {
                if trimmed.hasPrefix(codeFence) {
                    flushCode()
                } else {
                    codeLines.append(line)
                }
                continue
            }

            if let fence = fenceOpening(from: trimmed) {
                flushParagraph()
                codeFence = fence.marker
                codeLanguage = fence.language
                continue
            }

            if trimmed.isEmpty {
                flushParagraph()
                continue
            }

            if let heading = heading(from: trimmed) {
                flushParagraph()
                blocks.append(.heading(level: heading.level, text: heading.text))
            } else if let item = orderedListItem(from: trimmed) {
                flushParagraph()
                blocks.append(.orderedListItem(number: item.number, text: item.text))
            } else if let item = unorderedListItem(from: trimmed) {
                flushParagraph()
                blocks.append(.unorderedListItem(item))
            } else if trimmed.hasPrefix("> ") {
                flushParagraph()
                blocks.append(.blockQuote(String(trimmed.dropFirst(2))))
            } else if isDivider(trimmed) {
                flushParagraph()
                blocks.append(.divider)
            } else {
                paragraphLines.append(line)
            }
        }

        flushParagraph()
        if codeFence != nil {
            flushCode()
        }
        return blocks
    }

    private static func fenceOpening(from line: String) -> (marker: String, language: String?)? {
        let marker: String
        if line.hasPrefix("```") {
            marker = "```"
        } else if line.hasPrefix("~~~") {
            marker = "~~~"
        } else {
            return nil
        }

        let language = line.dropFirst(marker.count).trimmingCharacters(in: .whitespaces)
        return (marker, language.isEmpty ? nil : language)
    }

    private static func heading(from line: String) -> (level: Int, text: String)? {
        let level = line.prefix(while: { $0 == "#" }).count
        guard (1...6).contains(level) else { return nil }
        let remainder = line.dropFirst(level)
        guard remainder.first == " " else { return nil }
        return (level, String(remainder.dropFirst()))
    }

    private static func orderedListItem(from line: String) -> (number: Int, text: String)? {
        let digits = line.prefix(while: { $0.isNumber })
        guard !digits.isEmpty, let number = Int(digits) else { return nil }

        let remainder = line.dropFirst(digits.count)
        guard let punctuation = remainder.first, punctuation == "." || punctuation == ")" else { return nil }
        let item = remainder.dropFirst()
        guard item.first == " " else { return nil }
        return (number, String(item.dropFirst()))
    }

    private static func unorderedListItem(from line: String) -> String? {
        guard line.count >= 2 else { return nil }
        let marker = line.first
        guard marker == "-" || marker == "*" || marker == "+" else { return nil }
        let remainder = line.dropFirst()
        guard remainder.first == " " else { return nil }
        return String(remainder.dropFirst())
    }

    private static func isDivider(_ line: String) -> Bool {
        guard line.count >= 3, let marker = line.first, marker == "-" || marker == "*" || marker == "_" else {
            return false
        }
        return line.allSatisfy { $0 == marker }
    }
}
