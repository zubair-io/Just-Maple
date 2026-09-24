import CryptoKit
import Foundation

/// One-shot local file connector. It does not own an editor or infer facts from prose.
public enum NoteConnector {
    public static func read(url: URL, subjects: [String]) throws -> Event {
        let file = url.standardizedFileURL.resolvingSymlinksInPath()
        guard ["md", "markdown", "txt"].contains(file.pathExtension.lowercased()) else {
            throw MapleError.invalid("The note connector accepts .md, .markdown and .txt files.")
        }
        let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
        guard attributes[.type] as? FileAttributeType == .typeRegular,
              let size = attributes[.size] as? NSNumber, size.intValue <= 256_000 else {
            throw MapleError.invalid("Choose a regular note file smaller than 256 KB.")
        }
        let data = try Data(contentsOf: file)
        guard let content = String(data: data, encoding: .utf8) else { throw MapleError.invalid("Note must be UTF-8.") }
        let revision = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        let pathID = SHA256.hash(data: Data(file.path.utf8)).map { String(format: "%02x", $0) }.joined()
        let modified = attributes[.modificationDate] as? Date ?? Date()
        // File mtime is not part of source identity: preserve occurrence for identical content
        // through the caller's dedup check. A file revision carries its original observed mtime.
        return Event(type: "note.updated", source: Source(connector: "notes", account: "local", externalID: pathID, revision: revision),
                     occurredAt: modified, subjects: subjects, content: content)
    }
}
