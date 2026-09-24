import CryptoKit
import Foundation

public struct IMessageCheckpoint: Sendable {
    public let activatedAt: Date
    public let scannedAt: Date
}

extension KnowledgeStore {
    public func beginIMessage(now: Date = Date()) throws -> IMessageCheckpoint {
        try db.execute("INSERT OR IGNORE INTO connector_checkpoints VALUES ('imessage',?,?)",
                       [String(now.timeIntervalSince1970), String(now.timeIntervalSince1970)])
        let row = try db.rows("SELECT * FROM connector_checkpoints WHERE id='imessage'")[0]
        return IMessageCheckpoint(activatedAt: Date(timeIntervalSince1970: Double(row["activated_at"]!)!),
                                  scannedAt: Date(timeIntervalSince1970: Double(row["scanned_at"]!)!))
    }

    /// A failed import cannot move its checkpoint past missing events.
    public func ingestIMessageBatch(_ events: [Event], scannedAt: Date) throws -> Int {
        guard events.count <= 10_000, scannedAt.timeIntervalSince1970.isFinite else {
            throw MapleError.invalid("iMessage import exceeded the batch limit.")
        }
        return try db.transaction {
            guard !(try db.rows("SELECT id FROM connector_checkpoints WHERE id='imessage'")).isEmpty else {
                throw MapleError.invalid("Initialize the iMessage connector first.")
            }
            var count = 0
            for event in events {
                try event.validate()
                guard event.source.connector == "imessage", ["message.received", "message.sent", "message.history"].contains(event.type) else {
                    throw MapleError.invalid("Invalid iMessage event batch.")
                }
                let existing = try db.rows("SELECT json FROM events WHERE connector=? AND account=? AND external_id=? AND revision=?",
                                          ["imessage", event.source.account, event.source.externalID, event.source.revision])
                // Overlapping exports retain the first observation's historical/live classification.
                if let json = existing.first?["json"] {
                    let prior = try JSONCodec.decode(Event.self, from: Data(json.utf8))
                    guard prior.content == event.content, prior.subjects == event.subjects, prior.occurredAt == event.occurredAt else {
                        throw MapleError.invalid("An iMessage source identity was reused with different data.")
                    }
                } else { _ = try insert(event, enqueue: true); count += 1 }
            }
            try db.execute("UPDATE connector_checkpoints SET scanned_at=MAX(scanned_at,?) WHERE id='imessage'", [String(scannedAt.timeIntervalSince1970)])
            return count
        }
    }
}

public enum IMessageTextParser {
    public static func parse(_ text: String, thread: String, activatedAt: Date, timeZone: TimeZone = .current) throws -> [Event] {
        let pattern = try NSRegularExpression(pattern: "^[A-Z][a-z]{2} [0-9]{1,2}, [0-9]{4}\\s+[0-9]{1,2}:[0-9]{2}:[0-9]{2}\\s+[AP]M")
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = "MMM d, yyyy h:mm:ss a"
        formatter.isLenient = false
        var date: Date?
        var sender: String?
        var body: [String] = []
        var events: [Event] = []
        let threadID = "thread:imessage:" + hash(thread)
        func flush() throws {
            defer { body = []; sender = nil }
            guard let date, let sender else { return }
            let content = body.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !content.isEmpty else { return }
            let reactions = ["Edited ", "Tapbacks:", "Loved by ", "Liked by ", "Laughed at ", "Emphasized ", "Questioned ", "Disliked ", "Reacted "]
            guard !reactions.contains(where: { sender.hasPrefix($0) }) else { return }
            let outgoing = sender == "Me"
            let person = outgoing ? "person:self" : "person:imessage:" + hash(sender)
            let externalID = hash([thread, String(date.timeIntervalSince1970), sender, content].joined(separator: "\u{0}"))
            let event = Event(type: date <= activatedAt ? "message.history" : outgoing ? "message.sent" : "message.received",
                              source: Source(connector: "imessage", account: "local", externalID: externalID, revision: "export-v1", timeZone:timeZone.identifier),
                              occurredAt: date, subjects: Array(Set([threadID, person, "person:self"])).sorted(),
                              content: "Thread: \(thread)\nSender: \(sender)\nDirection: \(outgoing ? "outgoing" : "incoming")\n\n\(content)")
            try event.validate()
            events.append(event)
        }
        var headers = 0
        for line in text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n") {
            let line = line.trimmingCharacters(in: .whitespaces)
            let range = NSRange(line.startIndex..., in: line)
            if let match = pattern.firstMatch(in: line, range: range), let dateRange = Range(match.range, in: line) {
                headers += 1
                try flush()
                let normalized = String(line[dateRange]).split(whereSeparator: \.isWhitespace).joined(separator: " ")
                guard let parsed = formatter.date(from: normalized) else { throw MapleError.invalid("An iMessage timestamp could not be parsed.") }
                date = parsed
            } else if date != nil && sender == nil {
                if !line.isEmpty { sender = line }
            } else if sender != nil { body.append(line) }
        }
        try flush()
        if headers == 0 && !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw MapleError.invalid("Unrecognized iMessage export format; checkpoint was not advanced.")
        }
        return events
    }

    static func hash(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

/// Local export adapter. No attachment copies, servers, MongoDB or search daemon.
public enum IMessageConnector {
    public static func poll(store: KnowledgeStore, historyDays:Int? = nil, executable: URL = URL(fileURLWithPath: "/opt/homebrew/bin/imessage-exporter")) async throws -> Int {
        let saved = try await store.beginIMessage()
        guard historyDays == nil || (1...90).contains(historyDays!) else {throw MapleError.invalid("Choose 1–90 days of Messages history.")}
        let checkpoint = IMessageCheckpoint(activatedAt:saved.activatedAt,scannedAt:historyDays.map{Date().addingTimeInterval(-Double($0-1)*86400)} ?? saved.scannedAt)
        let started = Date()
        // Isolate synchronous process/file work from the app's main actor.
        let events = try await Task.detached(priority: .utility) {
            try export(executable: executable, checkpoint: checkpoint, started: started)
        }.value
        return try await store.ingestIMessageBatch(events, scannedAt: started)
    }

    static func export(executable: URL, checkpoint: IMessageCheckpoint, started: Date) throws -> [Event] {
        guard FileManager.default.isExecutableFile(atPath: executable.path) else {
            throw MapleError.invalid("Install imessage-exporter at /opt/homebrew/bin/imessage-exporter to connect Messages.")
        }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("just-maple-imessage-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        defer { try? FileManager.default.removeItem(at: directory) }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        let start = checkpoint.scannedAt.addingTimeInterval(-86_400)
        let process = Process()
        process.executableURL = executable
        process.arguments = ["-f", "txt", "-c", "disabled", "-o", directory.path, "-s", formatter.string(from: start), "--no-progress"]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do { try process.run() } catch { throw MapleError.invalid("Could not start the iMessage exporter.") }
        let timeout = DispatchWorkItem { if process.isRunning { process.terminate() } }
        DispatchQueue.global().asyncAfter(deadline: .now() + 60, execute: timeout)
        process.waitUntilExit()
        timeout.cancel()
        guard process.terminationStatus == 0 else {
            throw MapleError.invalid("Messages import failed or timed out. Check Full Disk Access for Just Maple and imessage-exporter in System Settings, then retry.")
        }
        var events: [Event] = []
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey])
        for file in files.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) where file.pathExtension == "txt" {
            guard (try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) <= 20_000_000 else {
                throw MapleError.invalid("One iMessage export exceeded 20 MB; checkpoint was not advanced.")
            }
            let parsed = try IMessageTextParser.parse(String(contentsOf: file, encoding: .utf8), thread: file.deletingPathExtension().lastPathComponent, activatedAt: checkpoint.activatedAt)
            events += parsed.filter { $0.occurredAt >= start && $0.occurredAt <= started }
            guard events.count <= 10_000 else { throw MapleError.invalid("iMessage import exceeded 10,000 messages; checkpoint was not advanced.") }
        }
        return events.sorted { ($0.occurredAt, $0.source.externalID) < ($1.occurredAt, $1.source.externalID) }
    }
}
