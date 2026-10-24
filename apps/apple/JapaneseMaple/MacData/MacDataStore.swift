//
//  MacDataStore.swift
//  JapaneseMaple
//
//  The Mac's private database of imported messages, emails and events,
//  plus the registry of local-only pages. Nothing here is uploaded.
//

#if os(macOS)
import Foundation

nonisolated final class MacDataStore: @unchecked Sendable {
    private let db: MacDataSQLite
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(path: String) throws {
        try FileManager.default.createDirectory(
            at: URL(fileURLWithPath: path).deletingLastPathComponent(),
            withIntermediateDirectories: true)
        db = try MacDataSQLite(path: path, readOnly: false)
        try db.execute("PRAGMA journal_mode=WAL")
        try migrate()
    }

    private func migrate() throws {
        let version = try db.rows("PRAGMA user_version").first?["user_version"]?.int ?? 0
        guard version < 1 else { return }
        try db.transaction {
            try db.execute(
                """
                CREATE TABLE IF NOT EXISTS items(
                    id TEXT PRIMARY KEY,
                    source TEXT NOT NULL,
                    revision TEXT NOT NULL,
                    occurred_at REAL NOT NULL,
                    title TEXT,
                    sender TEXT,
                    body TEXT NOT NULL DEFAULT '',
                    json TEXT NOT NULL,
                    updated_at REAL NOT NULL)
                """)
            try db.execute(
                "CREATE INDEX IF NOT EXISTS items_source_time ON items(source, occurred_at)")
            // Read by the proactive batcher in a later phase.
            try db.execute(
                """
                CREATE TABLE IF NOT EXISTS change_log(
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    item_id TEXT NOT NULL,
                    source TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    at REAL NOT NULL)
                """)
            try db.execute(
                """
                CREATE TABLE IF NOT EXISTS checkpoints(
                    source TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    scanned_at REAL)
                """)
            try db.execute(
                """
                CREATE TABLE IF NOT EXISTS pages(
                    id TEXT PRIMARY KEY,
                    notebook_id TEXT NOT NULL,
                    source TEXT NOT NULL,
                    title TEXT NOT NULL,
                    created_at REAL NOT NULL)
                """)
            try db.execute("PRAGMA user_version = 1")
        }
    }

    // MARK: - Sources

    /// A source is enabled once any page asks for it; disabled sources are never read.
    func enabledSources() throws -> [MacDataSource] {
        try db.rows("SELECT source FROM checkpoints").compactMap {
            $0["source"]?.string.flatMap(MacDataSource.init(rawValue:))
        }
    }

    func enable(_ source: MacDataSource) throws {
        try db.execute(
            "INSERT OR IGNORE INTO checkpoints(source, value) VALUES (?, '')", [source.rawValue])
    }

    func checkpoint(_ source: MacDataSource) throws -> String? {
        try db.rows("SELECT value FROM checkpoints WHERE source=?", [source.rawValue])
            .first?["value"]?.string
    }

    func lastSync(_ source: MacDataSource) throws -> Double? {
        try db.rows("SELECT scanned_at FROM checkpoints WHERE source=?", [source.rawValue])
            .first?["scanned_at"]?.double
    }

    func itemCount(_ source: MacDataSource) throws -> Int {
        Int(
            try db.rows("SELECT COUNT(*) AS n FROM items WHERE source=?", [source.rawValue])
                .first?["n"]?.int ?? 0)
    }

    /// Applies one reader pass atomically. The checkpoint only advances when every
    /// item was written, so a failed pass is retried from the same place.
    /// Returns the number of items added, changed or removed.
    @discardableResult
    func apply(_ result: MacDataReadResult, source: MacDataSource, now: Date = Date()) throws -> Int
    {
        let at = now.timeIntervalSince1970
        return try db.transaction {
            var changes = 0
            for item in result.items {
                guard item.source == source else {
                    throw MacDataError.invalid("A \(source.rawValue) pass returned a \(item.source.rawValue) item.")
                }
                let existing = try db.rows("SELECT revision FROM items WHERE id=?", [item.id])
                    .first?["revision"]?.string
                if existing == item.revision { continue }
                let json = String(decoding: try encoder.encode(item), as: UTF8.self)
                try db.execute(
                    """
                    INSERT INTO items(id, source, revision, occurred_at, title, sender, body, json, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        revision=excluded.revision, occurred_at=excluded.occurred_at,
                        title=excluded.title, sender=excluded.sender, body=excluded.body,
                        json=excluded.json, updated_at=excluded.updated_at
                    """,
                    [
                        item.id, source.rawValue, item.revision, item.occurredAt, item.title,
                        item.sender, item.body, json, at,
                    ])
                try log(item.id, source, existing == nil ? "added" : "changed", at)
                changes += 1
            }

            var removed = Set(result.removedIds)
            if let present = result.presentIds, let window = result.reconcileWindow {
                let stored = try db.rows(
                    "SELECT id FROM items WHERE source=? AND occurred_at BETWEEN ? AND ?",
                    [source.rawValue, window.lowerBound, window.upperBound]
                ).compactMap { $0["id"]?.string }
                removed.formUnion(stored.filter { !present.contains($0) })
            }
            for id in removed {
                let exists = !(try db.rows("SELECT 1 FROM items WHERE id=?", [id])).isEmpty
                guard exists else { continue }
                try db.execute("DELETE FROM items WHERE id=?", [id])
                try log(id, source, "removed", at)
                changes += 1
            }

            try db.execute(
                "UPDATE checkpoints SET value=?, scanned_at=? WHERE source=?",
                [result.checkpoint, at, source.rawValue])
            return changes
        }
    }

    private func log(_ id: String, _ source: MacDataSource, _ kind: String, _ at: Double) throws {
        try db.execute(
            "INSERT INTO change_log(item_id, source, kind, at) VALUES (?, ?, ?, ?)",
            [id, source.rawValue, kind, at])
    }

    // MARK: - Queries

    func query(_ query: MacDataQuery) throws -> MacDataQueryResult {
        var clauses = ["source = ?"]
        var bindings: [Any?] = [query.source.rawValue]
        if let from = query.from {
            clauses.append("occurred_at >= ?")
            bindings.append(from)
        }
        if let to = query.to {
            clauses.append("occurred_at <= ?")
            bindings.append(to)
        }
        let terms = (query.search ?? "").split(whereSeparator: \.isWhitespace).prefix(8)
        for term in terms {
            // Each word must appear somewhere; LIKE is case-insensitive for ASCII.
            let pattern = "%" + escapeLike(String(term)) + "%"
            clauses.append(
                "(title LIKE ? ESCAPE '\\' OR sender LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR json LIKE ? ESCAPE '\\')"
            )
            bindings.append(contentsOf: [pattern, pattern, pattern, pattern])
        }
        let whereSQL = clauses.joined(separator: " AND ")
        let order = query.order == "asc" ? "ASC" : "DESC"
        let limit = min(max(query.limit ?? 100, 1), 500)
        let offset = max(query.offset ?? 0, 0)

        let total = Int(
            try db.rows("SELECT COUNT(*) AS n FROM items WHERE \(whereSQL)", bindings)
                .first?["n"]?.int ?? 0)
        let rows = try db.rows(
            "SELECT json FROM items WHERE \(whereSQL) ORDER BY occurred_at \(order) LIMIT ? OFFSET ?",
            bindings + [limit, offset])
        let items = try rows.compactMap { row -> MacDataItem? in
            guard let json = row["json"]?.string else { return nil }
            return try decoder.decode(MacDataItem.self, from: Data(json.utf8))
        }
        return MacDataQueryResult(items: items, total: total)
    }

    private func escapeLike(_ value: String) -> String {
        value.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "%", with: "\\%")
            .replacingOccurrences(of: "_", with: "\\_")
    }

    // MARK: - Pages

    func pages(notebookId: String?) throws -> [MacDataPage] {
        guard let notebookId else {
            return try db.rows("SELECT * FROM pages ORDER BY created_at").compactMap(page(from:))
        }
        return try db.rows(
            "SELECT * FROM pages WHERE notebook_id=? ORDER BY created_at", [notebookId]
        ).compactMap(page(from:))
    }

    func page(id: String) throws -> MacDataPage? {
        try db.rows("SELECT * FROM pages WHERE id=?", [id]).first.flatMap(page(from:))
    }

    func insert(_ page: MacDataPage) throws {
        try db.execute(
            "INSERT INTO pages(id, notebook_id, source, title, created_at) VALUES (?, ?, ?, ?, ?)",
            [page.id, page.notebookId, page.source.rawValue, page.title, page.createdAt])
    }

    func rename(pageId: String, title: String) throws {
        try db.execute("UPDATE pages SET title=? WHERE id=?", [title, pageId])
    }

    /// Removes the page only. Imported data stays, since other pages and bots may use it.
    func delete(pageId: String) throws {
        try db.execute("DELETE FROM pages WHERE id=?", [pageId])
    }

    private func page(from row: MacDataSQLite.Row) -> MacDataPage? {
        guard let id = row["id"]?.string, let notebookId = row["notebook_id"]?.string,
            let source = row["source"]?.string.flatMap(MacDataSource.init(rawValue:)),
            let title = row["title"]?.string, let createdAt = row["created_at"]?.double
        else { return nil }
        return MacDataPage(
            id: id, notebookId: notebookId, source: source, title: title, createdAt: createdAt)
    }
}
#endif
