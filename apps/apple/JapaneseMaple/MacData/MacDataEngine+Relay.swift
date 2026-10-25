//
//  MacDataEngine+Relay.swift
//  JapaneseMaple
//
//  Embedding, and what the server can still ask this Mac over the realtime socket.
//  Bots read the cloud copy now, so the only request left is embedding a search
//  query with the same on-device model the items were embedded with.
//

#if os(macOS)
import Foundation
import os

/// Sent with register and every heartbeat. `notebooks` is always empty now that pages
/// live in the cloud; the server's schema still requires it.
nonisolated struct MacDataHostInfo: Codable, Sendable {
    struct NotebookSources: Codable, Sendable {
        var notebookId: String
        var sources: [MacDataSource]
    }

    var timeZone: String
    /// The Mac's current local time, ISO 8601 with offset.
    var now: String
    var notebooks: [NotebookSources]
    var pendingEmbeddings: Int
}

extension MacDataEngine {
    static let log = Logger(subsystem: "com.just.maple.JapaneseMaple", category: "MacData")

    // MARK: - Embedding

    /// Embeds items imported or changed since the last pass. Safe to call often: Mail
    /// triggers a sync every few seconds, and overlapping passes would each embed the
    /// same unfinished items, so later calls return at once and leave it to the running pass.
    @discardableResult
    func embedPending() async -> Int {
        guard MacDataEmbedding.isAvailable, !isEmbedding, let store = try? store() else { return 0 }
        isEmbedding = true
        defer { isEmbedding = false }
        var embedded = 0
        var attempted = Set<String>()
        while let batch = try? store.itemsNeedingEmbedding(limit: 64), !batch.isEmpty {
            // Items that failed to save would come back forever; stop instead of spinning.
            guard batch.contains(where: { !attempted.contains($0.id) }) else { break }
            attempted.formUnion(batch.map(\.id))
            let started = Date()
            // The model runs off the actor so status and uploads aren't blocked behind it.
            let vectors = await Task.detached(priority: .utility) {
                batch.map { item in
                    MacDataEmbedding.chunks(MacDataEmbedding.text(for: item))
                        .compactMap(MacDataEmbedding.vector)
                }
            }.value
            for (item, itemVectors) in zip(batch, vectors) {
                try? store.saveEmbedding(itemId: item.id, revision: item.revision, vectors: itemVectors)
            }
            embedded += batch.count
            let words = batch.reduce(0) { $0 + MacDataEmbedding.text(for: $1).split(whereSeparator: \.isWhitespace).count }
            Self.log.info(
                "Embedded \(batch.count) items (\(words) words) in \(Date().timeIntervalSince(started), format: .fixed(precision: 1))s; \((try? store.pendingEmbeddingCount()) ?? -1) pending"
            )
        }
        return embedded
    }

    // MARK: - Requests from the server

    func hostInfo() throws -> MacDataHostInfo {
        MacDataHostInfo(
            timeZone: TimeZone.current.identifier,
            now: Self.localISO(Date()),
            notebooks: [],
            pendingEmbeddings: try store().pendingEmbeddingCount())
    }

    /// Answers the server's `embed` request: the query's normalized vector, or nil when
    /// the model isn't available or the text has nothing to embed.
    nonisolated static func embedAnswer(text: String?) async -> [Float]? {
        guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        // The model can take a moment; keep it off the main actor.
        return await Task.detached(priority: .userInitiated) {
            MacDataEmbedding.vector(String(text.prefix(2_000)))
        }.value
    }

    static func localISO(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.timeZone = .current
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }
}
#endif
