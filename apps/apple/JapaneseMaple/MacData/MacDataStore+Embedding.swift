//
//  MacDataStore+Embedding.swift
//  JapaneseMaple
//
//  Embedding vectors per item, small key/value state, and the change log. Items are
//  embedded on this Mac with Apple's built-in sentence model (no network) and the
//  vectors are uploaded with them, so the server can rank by meaning.
//

#if os(macOS)
import Foundation

/// The Mac's items are embedded with the shared on-device model (see DeviceEmbedding).
typealias MacDataEmbedding = DeviceEmbedding

nonisolated extension DeviceEmbedding {
    /// Text that represents an item for embedding: who, what, and the body.
    static func text(for item: MacDataItem) -> String {
        [item.title, item.sender, item.location, item.calendar, item.body]
            .compactMap { $0?.isEmpty == false ? $0 : nil }
            .joined(separator: "\n")
    }
}

nonisolated extension MacDataStore {
    // MARK: - Embedding bookkeeping

    func itemsNeedingEmbedding(limit: Int) throws -> [MacDataItem] {
        try decodeItems(
            db.rows(
                """
                SELECT json FROM items
                WHERE (embedded_revision IS NULL OR embedded_revision != revision)
                AND source != 'home'
                ORDER BY occurred_at DESC LIMIT ?
                """, [limit]))
    }

    func pendingEmbeddingCount() throws -> Int {
        Int(
            try db.rows(
                "SELECT COUNT(*) AS n FROM items WHERE (embedded_revision IS NULL OR embedded_revision != revision) AND source != 'home'"
            ).first?["n"]?.int ?? 0)
    }

    func saveEmbedding(itemId: String, revision: String, vectors: [[Float]]) throws {
        try db.transaction {
            try db.execute("DELETE FROM chunks WHERE item_id=?", [itemId])
            for (ordinal, vector) in vectors.enumerated() {
                try db.execute(
                    "INSERT INTO chunks(item_id, ordinal, vector) VALUES (?, ?, ?)",
                    [itemId, ordinal, MacDataEmbedding.encode(vector)])
            }
            try db.execute(
                "UPDATE items SET embedded_revision=? WHERE id=? AND revision=?",
                [revision, itemId, revision])
        }
    }

    /// One item's chunk vectors, in order.
    func vectors(itemId: String) throws -> [[Float]] {
        try db.rows("SELECT vector FROM chunks WHERE item_id=? ORDER BY ordinal", [itemId])
            .compactMap { $0["vector"]?.data.map(MacDataEmbedding.decode) }
    }

    // MARK: - Items

    func item(id: String) throws -> MacDataItem? {
        try decodeItems(db.rows("SELECT json FROM items WHERE id=?", [id])).first
    }

    func items(source: MacDataSource) throws -> [MacDataItem] {
        try decodeItems(db.rows("SELECT json FROM items WHERE source=?", [source.rawValue]))
    }

    func decodeItems(_ rows: [MacDataSQLite.Row]) -> [MacDataItem] {
        let decoder = JSONDecoder()
        return rows.compactMap { row in
            row["json"]?.string.flatMap { try? decoder.decode(MacDataItem.self, from: Data($0.utf8)) }
        }
    }

    // MARK: - Small persistent state

    func value(_ key: String) throws -> String? {
        try db.rows("SELECT value FROM kv WHERE key=?", [key]).first?["value"]?.string
    }

    func setValue(_ value: String, for key: String) throws {
        try db.execute(
            "INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            [key, value])
    }

    // MARK: - Change log

    struct Change {
        var seq: Int64
        var itemId: String
        var source: MacDataSource
        var kind: String
        var at: Double
    }

    func changes(after seq: Int64, limit: Int) throws -> [Change] {
        try db.rows(
            "SELECT seq, item_id, source, kind, at FROM change_log WHERE seq > ? ORDER BY seq LIMIT ?",
            [seq, limit]
        ).compactMap { row in
            guard let seq = row["seq"]?.int, let id = row["item_id"]?.string,
                let source = row["source"]?.string.flatMap(MacDataSource.init(rawValue:)),
                let kind = row["kind"]?.string, let at = row["at"]?.double
            else { return nil }
            return Change(seq: seq, itemId: id, source: source, kind: kind, at: at)
        }
    }

    func latestChangeSeq() throws -> Int64 {
        try db.rows("SELECT MAX(seq) AS seq FROM change_log").first?["seq"]?.int ?? 0
    }
}
#endif
