//
//  MailMessageParser.swift
//  JapaneseMaple
//
//  Extracts readable text from a Mail `.emlx` file: a byte count line,
//  then a standard email message. Prefers text/plain, falls back to
//  text/html with tags stripped.
//

#if os(macOS)
import Foundation

nonisolated enum MailMessageParser {
    static let maxBodyLength = 20_000

    /// Returns the readable body of an `.emlx` file, or nil when it has no text part.
    static func bodyText(emlx data: Data) -> String? {
        guard let newline = data.firstIndex(of: 0x0A) else { return nil }
        let countText = String(decoding: data[data.startIndex..<newline], as: UTF8.self)
            .trimmingCharacters(in: .whitespaces)
        let start = data.index(after: newline)
        var message = data[start...]
        if let count = Int(countText), count <= message.count {
            message = message.prefix(count)
        }
        return bodyText(message: Data(message))
    }

    /// Returns the readable body of a raw email message.
    static func bodyText(message: Data) -> String? {
        guard let text = text(of: Part(raw: message), depth: 0) else { return nil }
        let collapsed =
            text
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "[ \\t]+\\n", with: "\n", options: .regularExpression)
            .replacingOccurrences(of: "\\n{3,}", with: "\n\n", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return collapsed.isEmpty ? nil : String(collapsed.prefix(maxBodyLength))
    }

    // MARK: - Parts

    struct Part {
        var headers: [String: String]
        var body: Data

        init(raw: Data) {
            let (headerData, body) = Self.split(raw)
            self.headers = Self.parseHeaders(String(decoding: headerData, as: UTF8.self))
            self.body = body
        }

        var contentType: String {
            (headers["content-type"] ?? "text/plain").lowercased()
        }

        var mimeType: String {
            contentType.split(separator: ";").first.map {
                $0.trimmingCharacters(in: .whitespaces)
            } ?? "text/plain"
        }

        func parameter(_ name: String) -> String? {
            MailMessageParser.parameter(name, in: headers["content-type"] ?? "")
        }

        /// Splits at the first blank line (CRLF or LF).
        static func split(_ data: Data) -> (Data, Data) {
            let bytes = [UInt8](data)
            var index = 0
            while index < bytes.count {
                if bytes[index] == 0x0A {
                    if index + 1 < bytes.count, bytes[index + 1] == 0x0A {
                        return (Data(bytes[0..<index]), Data(bytes[(index + 2)...]))
                    }
                    if index + 2 < bytes.count, bytes[index + 1] == 0x0D, bytes[index + 2] == 0x0A
                    {
                        return (Data(bytes[0..<index]), Data(bytes[(index + 3)...]))
                    }
                }
                index += 1
            }
            return (data, Data())
        }

        static func parseHeaders(_ text: String) -> [String: String] {
            var headers: [String: String] = [:]
            var current: (String, String)?
            // The header block can end in a bare "\r" when the blank line was CRLF.
            for line in text.replacingOccurrences(of: "\r", with: "").split(
                separator: "\n", omittingEmptySubsequences: false)
            {
                if line.first == " " || line.first == "\t", let (name, value) = current {
                    current = (name, value + " " + line.trimmingCharacters(in: .whitespaces))
                    continue
                }
                if let (name, value) = current, headers[name] == nil { headers[name] = value }
                guard let colon = line.firstIndex(of: ":") else {
                    current = nil
                    continue
                }
                current = (
                    line[..<colon].trimmingCharacters(in: .whitespaces).lowercased(),
                    line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
                )
            }
            if let (name, value) = current, headers[name] == nil { headers[name] = value }
            return headers
        }
    }

    private static func text(of part: Part, depth: Int) -> String? {
        guard depth < 8 else { return nil }
        let mime = part.mimeType
        if mime.hasPrefix("multipart/") {
            guard let boundary = part.parameter("boundary") else { return nil }
            let children = split(part.body, boundary: boundary).map(Part.init(raw:))
            // Within multipart/alternative, plain text is the cleanest choice.
            let ordered =
                children.filter { $0.mimeType == "text/plain" }
                + children.filter { $0.mimeType != "text/plain" }
            for child in ordered where !isAttachment(child) {
                if let text = text(of: child, depth: depth + 1), !text.isEmpty { return text }
            }
            return nil
        }
        guard mime == "text/plain" || mime == "text/html", !isAttachment(part) else { return nil }
        let decoded = decodeTransfer(part.body, encoding: part.headers["content-transfer-encoding"])
        let text = decodeCharset(decoded, charset: part.parameter("charset"))
        return mime == "text/html" ? stripHTML(text) : text
    }

    private static func isAttachment(_ part: Part) -> Bool {
        (part.headers["content-disposition"] ?? "").lowercased().hasPrefix("attachment")
    }

    static func split(_ body: Data, boundary: String) -> [Data] {
        let text = String(decoding: body, as: UTF8.self)
        let delimiter = "--" + boundary
        var parts = text.components(separatedBy: delimiter).dropFirst()
        if let last = parts.last, last.hasPrefix("--") { parts = parts.dropLast() }
        return parts.map { chunk in
            var part = chunk
            if part.hasPrefix("\r\n") {
                part.removeFirst(2)
            } else if part.hasPrefix("\n") {
                part.removeFirst()
            }
            return Data(part.utf8)
        }
    }

    // MARK: - Decoding

    static func parameter(_ name: String, in header: String) -> String? {
        for piece in header.split(separator: ";").dropFirst() {
            let pair = piece.split(separator: "=", maxSplits: 1)
            guard pair.count == 2,
                pair[0].trimmingCharacters(in: .whitespaces).lowercased() == name
            else { continue }
            return pair[1].trimmingCharacters(in: .whitespaces)
                .trimmingCharacters(in: CharacterSet(charactersIn: "\""))
        }
        return nil
    }

    static func decodeTransfer(_ data: Data, encoding: String?) -> Data {
        switch encoding?.lowercased().trimmingCharacters(in: .whitespaces) {
        case "base64":
            let compact = String(decoding: data, as: UTF8.self).filter { !$0.isWhitespace }
            return Data(base64Encoded: compact, options: .ignoreUnknownCharacters) ?? data
        case "quoted-printable":
            return decodeQuotedPrintable(data)
        default:
            return data
        }
    }

    static func decodeQuotedPrintable(_ data: Data) -> Data {
        let bytes = [UInt8](data)
        var output: [UInt8] = []
        output.reserveCapacity(bytes.count)
        var index = 0
        while index < bytes.count {
            let byte = bytes[index]
            guard byte == 0x3D else {  // "="
                output.append(byte)
                index += 1
                continue
            }
            // Soft line break: "=" at end of line.
            if index + 1 < bytes.count, bytes[index + 1] == 0x0A {
                index += 2
                continue
            }
            if index + 2 < bytes.count, bytes[index + 1] == 0x0D, bytes[index + 2] == 0x0A {
                index += 3
                continue
            }
            if index + 2 < bytes.count,
                let value = UInt8(String(bytes: bytes[(index + 1)...(index + 2)], encoding: .ascii) ?? "", radix: 16)
            {
                output.append(value)
                index += 3
                continue
            }
            output.append(byte)
            index += 1
        }
        return Data(output)
    }

    static func decodeCharset(_ data: Data, charset: String?) -> String {
        if let charset {
            let cfEncoding = CFStringConvertIANACharSetNameToEncoding(charset as CFString)
            if cfEncoding != kCFStringEncodingInvalidId {
                let encoding = String.Encoding(
                    rawValue: CFStringConvertEncodingToNSStringEncoding(cfEncoding))
                if let text = String(data: data, encoding: encoding) { return text }
            }
        }
        return String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self)
    }

    static func stripHTML(_ html: String) -> String {
        var text = html.replacingOccurrences(
            of: "(?is)<(style|script|head)[^>]*>.*?</\\1>", with: " ", options: .regularExpression)
        text = text.replacingOccurrences(
            of: "(?i)<(br|/p|/div|/tr|/li|/h[1-6])[^>]*>", with: "\n", options: .regularExpression)
        text = text.replacingOccurrences(of: "<[^>]+>", with: " ", options: .regularExpression)
        let entities = [
            "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'",
            "&apos;": "'", "&rsquo;": "\u{2019}", "&lsquo;": "\u{2018}", "&ldquo;": "\u{201C}",
            "&rdquo;": "\u{201D}", "&ndash;": "\u{2013}", "&mdash;": "\u{2014}", "&hellip;": "\u{2026}",
        ]
        for (entity, value) in entities {
            text = text.replacingOccurrences(of: entity, with: value, options: .caseInsensitive)
        }
        text = decodeNumericEntities(text)
        return
            text
            .replacingOccurrences(of: "[ \\t\\u00A0]+", with: " ", options: .regularExpression)
            .replacingOccurrences(of: " *\\n *", with: "\n", options: .regularExpression)
    }

    private static func decodeNumericEntities(_ text: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: "&#(x?)([0-9a-fA-F]+);") else {
            return text
        }
        let ns = text as NSString
        var result = ""
        var last = 0
        for match in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            result += ns.substring(with: NSRange(location: last, length: match.range.location - last))
            let isHex = match.range(at: 1).length > 0
            let digits = ns.substring(with: match.range(at: 2))
            if let value = UInt32(digits, radix: isHex ? 16 : 10), let scalar = Unicode.Scalar(value) {
                result.unicodeScalars.append(scalar)
            }
            last = match.range.location + match.range.length
        }
        result += ns.substring(from: last)
        return result
    }
}
#endif
