//
//  MacDataEngine+Relay.swift
//  JapaneseMaple
//
//  What the server can ask this Mac for: search, single items, and batches
//  of recent changes for proactive bots. Every request is scoped to a
//  notebook, and only sources with a Mac page in that notebook are visible.
//

#if os(macOS)
import Foundation

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

nonisolated struct MacDataChangeEntry: Codable, Sendable {
    var kind: String  // "added" or "changed"
    var item: MacDataSearchHit
}

nonisolated struct MacDataChangeBatch: Codable, Sendable {
    var notebookId: String
    var entries: [MacDataChangeEntry]
}

extension MacDataEngine {
    static let proactiveCursorKey = "proactive_seq"
    /// Older items are backlog (first import, catch-up after sleep), not news.
    static let proactiveFreshness: TimeInterval = 24 * 60 * 60
    static let proactiveBatchLimit = 40

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
            // The model runs off the actor so searches aren't blocked behind it.
            let vectors = await Task.detached(priority: .utility) {
                batch.map { item in
                    MacDataEmbedding.chunks(MacDataEmbedding.text(for: item))
                        .compactMap(MacDataEmbedding.vector)
                }
            }.value
            for (item, itemVectors) in zip(batch, vectors) {
                try? store.saveEmbedding(itemId: item.id, revision: item.revision, vectors: itemVectors)
                searchIndex.update(itemId: item.id, vectors: itemVectors)
            }
            embedded += batch.count
        }
        return embedded
    }

    // MARK: - Requests from the server

    func hostInfo() throws -> MacDataHostInfo {
        let store = try store()
        let notebooks = try store.sourcesByNotebook().map {
            MacDataHostInfo.NotebookSources(
                notebookId: $0.key, sources: $0.value.sorted { $0.rawValue < $1.rawValue })
        }
        return MacDataHostInfo(
            timeZone: TimeZone.current.identifier,
            now: Self.localISO(Date()),
            notebooks: notebooks.sorted { $0.notebookId < $1.notebookId },
            pendingEmbeddings: try store.pendingEmbeddingCount())
    }

    func search(_ request: MacDataSearchRequest) throws -> [MacDataSearchHit] {
        try searchIndex.search(request, store: store())
    }

    /// Any item, for this Mac's own pages (opening a cited item).
    func localItem(id: String) throws -> MacDataItem? {
        try store().item(id: id)
    }

    /// The full item, if its source is visible to `notebookId`.
    func item(id: String, notebookId: String) throws -> MacDataItem? {
        let store = try store()
        guard let item = try store.item(id: id),
            try store.sourcesByNotebook()[notebookId]?.contains(item.source) == true
        else { return nil }
        return item
    }

    // MARK: - Proactive batches

    /// New and changed items since the last batch, grouped for the notebooks that have a
    /// proactive bot. Returns the batches and the cursor to commit once they're delivered.
    /// Nothing is sent for notebooks without one, and removals, your own messages and
    /// stale backlog are left out.
    func proactiveBatches(for notebookIds: Set<String>, now: Date = Date()) throws
        -> (batches: [MacDataChangeBatch], cursor: Int64)
    {
        let store = try store()
        let since = Int64(try store.value(Self.proactiveCursorKey) ?? "") ?? 0
        let latest = try store.latestChangeSeq()
        // Without proactive notebooks, skip ahead so turning one on later doesn't
        // replay everything that happened in the meantime.
        guard !notebookIds.isEmpty else { return ([], latest) }

        let changes = try store.changes(after: since, limit: 2_000)
        let cursor = changes.last?.seq ?? since
        var latestKind: [String: String] = [:]
        for change in changes { latestKind[change.itemId] = change.kind }

        var entries: [MacDataChangeEntry] = []
        for (id, kind) in latestKind where kind != "removed" {
            guard let item = try store.item(id: id), Self.isNews(item, now: now) else { continue }
            entries.append(
                MacDataChangeEntry(
                    kind: kind, item: searchIndex.hit(item, score: 0, terms: [], timeZone: .current)))
        }
        entries.sort { $0.item.when > $1.item.when }
        entries = Array(entries.prefix(Self.proactiveBatchLimit))

        let sources = try store.sourcesByNotebook()
        let batches = notebookIds.sorted().compactMap { notebookId -> MacDataChangeBatch? in
            guard let allowed = sources[notebookId] else { return nil }
            let visible = entries.filter { allowed.contains($0.item.source) }
            return visible.isEmpty ? nil : MacDataChangeBatch(notebookId: notebookId, entries: visible)
        }
        return (batches, cursor)
    }

    func commitProactiveCursor(_ cursor: Int64) throws {
        try store().setValue(String(cursor), for: Self.proactiveCursorKey)
    }

    static func isNews(_ item: MacDataItem, now: Date) -> Bool {
        if item.isFromMe == true { return false }
        switch item.source {
        case .calendar:
            // An edit to a past event isn't actionable; upcoming ones are, however old the invite.
            return (item.endAt ?? item.occurredAt) >= now.timeIntervalSince1970
        case .imessage, .mail:
            return item.occurredAt >= now.timeIntervalSince1970 - proactiveFreshness
        }
    }

    static func localISO(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.timeZone = .current
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }
}
#endif
