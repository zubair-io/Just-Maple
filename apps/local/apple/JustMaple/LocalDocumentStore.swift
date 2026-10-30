import Foundation
import CryptoKit

/// Coordinates disk/iCloud access and detects a changed file before replacing it.
nonisolated final class LocalDocumentStore: @unchecked Sendable {
    private let lock = NSLock()
    private var roots: [URL] = []

    struct Snapshot: Sendable { let content: String; let version: String }
    enum StoreError: LocalizedError {
        case outsideFolder, conflict(String)
        var errorDescription: String? {
            switch self {
            case .outsideFolder: return "Choose a folder before accessing this file."
            case .conflict(let name): return "The file changed outside Just Maple. Your edits were saved as \(name); the original was kept. Reopen the original before editing it again."
            }
        }
    }

    func grant(_ root: URL) {
        let canonical = root.standardizedFileURL.resolvingSymlinksInPath()
        lock.withLock { if !roots.contains(canonical) { roots.append(canonical) } }
    }

    func resolve(_ path: String) throws -> URL {
        guard path.hasPrefix("/") else { throw StoreError.outsideFolder }
        var ancestor = URL(fileURLWithPath: path).standardizedFileURL
        var missing: [String] = []
        // Foundation does not resolve parent symlinks when the final file is absent.
        while !FileManager.default.fileExists(atPath: ancestor.path), ancestor.path != "/" {
            missing.insert(ancestor.lastPathComponent, at: 0)
            ancestor.deleteLastPathComponent()
        }
        let url = missing.reduce(ancestor.resolvingSymlinksInPath()) { $0.appendingPathComponent($1) }
        guard lock.withLock({ roots.contains { url.path == $0.path || url.path.hasPrefix($0.path + "/") } })
        else { throw StoreError.outsideFolder }
        return url
    }

    private func version(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    func read(_ path: String) throws -> Snapshot {
        let url = try resolve(path)
        var result: Result<Snapshot, Error>?
        var coordinationError: NSError?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { coordinated in
            result = Result {
                let data = try Data(contentsOf: coordinated)
                guard let content = String(data: data, encoding: .utf8) else { throw CocoaError(.fileReadInapplicableStringEncoding) }
                return Snapshot(content: content, version: version(data))
            }
        }
        if let coordinationError { throw coordinationError }
        guard let result else { throw CocoaError(.fileReadUnknown) }
        return try result.get()
    }

    @discardableResult
    func write(_ path: String, content: String, expectedVersion: String?) throws -> String {
        let url = try resolve(path)
        var result: Result<String, Error>?
        var coordinationError: NSError?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordinationError) { coordinated in
            result = Result {
                let exists = FileManager.default.fileExists(atPath: coordinated.path)
                let current = exists ? try Data(contentsOf: coordinated) : nil
                if (current.map(version) != expectedVersion) {
                    let recovery = coordinated.deletingPathExtension()
                        .appendingPathExtension("conflict-\(UUID().uuidString).md")
                    try Data(content.utf8).write(to: recovery, options: .withoutOverwriting)
                    throw StoreError.conflict(recovery.lastPathComponent)
                }
                let data = Data(content.utf8)
                try data.write(to: coordinated, options: .atomic)
                return version(data)
            }
        }
        if let coordinationError { throw coordinationError }
        guard let result else { throw CocoaError(.fileWriteUnknown) }
        return try result.get()
    }
}
