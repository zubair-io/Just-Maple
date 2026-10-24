//
//  MacDataSearch.swift
//  JapaneseMaple
//
//  On-device semantic search over the Mac's local data. Items are embedded
//  with Apple's built-in English sentence model (no network) and ranked by
//  meaning plus keyword matches. Used by bots through the server relay.
//

#if os(macOS)
import Foundation
import NaturalLanguage

/// Apple's on-device sentence embeddings, normalized so a dot product is cosine similarity.
nonisolated enum MacDataEmbedding {
    static let maxChunks = 4
    static let wordsPerChunk = 160

    private static let model = NLEmbedding.sentenceEmbedding(for: .english)
    /// NLEmbedding crashes when two threads use it at once (a search during background
    /// embedding), so every call goes through this lock.
    private static let lock = NSLock()

    static var isAvailable: Bool { model != nil }

    static func vector(_ text: String) -> [Float]? {
        guard let model else { return nil }
        let raw = lock.withLock { model.vector(for: text) }
        guard let raw, !raw.isEmpty else { return nil }
        let norm = sqrt(raw.reduce(0) { $0 + $1 * $1 })
        guard norm.isFinite, norm > 0 else { return nil }
        return raw.map { Float($0 / norm) }
    }

    /// Overlapping word windows so long emails are searchable past their first lines.
    static func chunks(_ text: String) -> [String] {
        let words = text.split(whereSeparator: \.isWhitespace)
        guard !words.isEmpty else { return [] }
        let step = wordsPerChunk - 30
        return stride(from: 0, to: words.count, by: step).prefix(maxChunks).map {
            words[$0..<min($0 + wordsPerChunk, words.count)].joined(separator: " ")
        }
    }

    static func encode(_ vector: [Float]) -> Data {
        vector.withUnsafeBufferPointer { Data(buffer: $0) }
    }

    static func decode(_ data: Data) -> [Float] {
        guard data.count % MemoryLayout<Float>.size == 0 else { return [] }
        return data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
    }

    /// Text that represents an item for embedding: who, what, and the body.
    static func text(for item: MacDataItem) -> String {
        [item.title, item.sender, item.location, item.calendar, item.body]
            .compactMap { $0?.isEmpty == false ? $0 : nil }
            .joined(separator: "\n")
    }
}

nonisolated struct MacDataSearchRequest: Codable, Sendable {
    var notebookId: String
    var query: String?
    var sources: [MacDataSource]?
    var from: Double?
    var to: Double?
    var limit: Int?
}

/// What a bot sees for one result: enough to answer or cite, never the whole body.
nonisolated struct MacDataSearchHit: Codable, Sendable {
    var id: String
    var source: MacDataSource
    /// ISO 8601 in the Mac's time zone, so the model reads local times.
    var when: String
    var end: String?
    var allDay: Bool?
    var title: String?
    var sender: String?
    var participants: [String]?
    var location: String?
    var calendar: String?
    var mailbox: String?
    var snippet: String
    var score: Double
}

nonisolated enum MacDataRanking {
    static let snippetLength = 500

    static func keywordTerms(_ query: String) -> [String] {
        let stop: Set<String> = [
            "the", "a", "an", "is", "are", "was", "what", "when", "where", "who", "how", "does",
            "do", "did", "for", "to", "of", "in", "on", "at", "and", "or", "my", "me", "i",
            "any", "there", "this", "that", "with", "about", "it", "be", "time",
        ]
        return query.lowercased()
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { $0.count > 1 && !stop.contains($0) }
    }

    /// Fraction of query terms that appear in the item's text.
    static func keywordScore(terms: [String], text: String) -> Double {
        guard !terms.isEmpty else { return 0 }
        let haystack = text.lowercased()
        return Double(terms.filter { haystack.contains($0) }.count) / Double(terms.count)
    }

    /// A window of the body around the first matching term, or its start.
    static func snippet(_ body: String, terms: [String]) -> String {
        let flat = body.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        guard flat.count > snippetLength else { return flat }
        let lower = flat.lowercased()
        let start: String.Index
        if let term = terms.first(where: { lower.contains($0) }),
            let range = lower.range(of: term)
        {
            let offset = max(0, lower.distance(from: lower.startIndex, to: range.lowerBound) - 120)
            start = flat.index(flat.startIndex, offsetBy: offset)
        } else {
            start = flat.startIndex
        }
        let end = flat.index(start, offsetBy: snippetLength, limitedBy: flat.endIndex) ?? flat.endIndex
        return (start == flat.startIndex ? "" : "…") + flat[start..<end] + (end == flat.endIndex ? "" : "…")
    }
}

extension MacDataStore {
    // MARK: - Embedding bookkeeping

    func itemsNeedingEmbedding(limit: Int) throws -> [MacDataItem] {
        try db.rows(
            """
            SELECT json FROM items
            WHERE embedded_revision IS NULL OR embedded_revision != revision
            ORDER BY occurred_at DESC LIMIT ?
            """, [limit]
        ).compactMap { row in
            row["json"]?.string.flatMap { try? JSONDecoder().decode(MacDataItem.self, from: Data($0.utf8)) }
        }
    }

    func pendingEmbeddingCount() throws -> Int {
        Int(
            try db.rows(
                "SELECT COUNT(*) AS n FROM items WHERE embedded_revision IS NULL OR embedded_revision != revision"
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

    func allVectors() throws -> [String: [[Float]]] {
        var result: [String: [[Float]]] = [:]
        for row in try db.rows("SELECT item_id, vector FROM chunks ORDER BY item_id, ordinal") {
            guard let id = row["item_id"]?.string, let data = row["vector"]?.data else { continue }
            result[id, default: []].append(MacDataEmbedding.decode(data))
        }
        return result
    }

    func items(sources: [MacDataSource], from: Double?, to: Double?) throws -> [MacDataItem] {
        guard !sources.isEmpty else { return [] }
        var sql =
            "SELECT json FROM items WHERE source IN (\(sources.map { _ in "?" }.joined(separator: ",")))"
        var bindings: [Any?] = sources.map(\.rawValue)
        if let from {
            sql += " AND occurred_at >= ?"
            bindings.append(from)
        }
        if let to {
            sql += " AND occurred_at <= ?"
            bindings.append(to)
        }
        return try db.rows(sql, bindings).compactMap { row in
            row["json"]?.string.flatMap { try? JSONDecoder().decode(MacDataItem.self, from: Data($0.utf8)) }
        }
    }

    func item(id: String) throws -> MacDataItem? {
        try db.rows("SELECT json FROM items WHERE id=?", [id]).first?["json"]?.string.flatMap {
            try? JSONDecoder().decode(MacDataItem.self, from: Data($0.utf8))
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

    /// Notebook id → the sources it has Mac pages for.
    func sourcesByNotebook() throws -> [String: Set<MacDataSource>] {
        var result: [String: Set<MacDataSource>] = [:]
        for page in try pages(notebookId: nil) {
            result[page.notebookId, default: []].insert(page.source)
        }
        return result
    }
}

/// Keeps every item's vectors in memory for fast ranking (tens of MB for a month of data).
nonisolated final class MacDataSearchIndex: @unchecked Sendable {
    private var vectors: [String: [[Float]]]?

    func invalidate() { vectors = nil }

    func update(itemId: String, vectors newVectors: [[Float]]) {
        vectors?[itemId] = newVectors
    }

    func search(
        _ request: MacDataSearchRequest, store: MacDataStore, timeZone: TimeZone = .current
    ) throws -> [MacDataSearchHit] {
        let allowed = try store.sourcesByNotebook()[request.notebookId] ?? []
        let sources = (request.sources ?? MacDataSource.allCases).filter(allowed.contains)
        let limit = min(max(request.limit ?? 12, 1), 25)
        let candidates = try store.items(sources: sources, from: request.from, to: request.to)
        let query = request.query?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let terms = MacDataRanking.keywordTerms(query)

        // No query: list what falls in the date range, soonest first.
        guard !query.isEmpty else {
            return
                candidates
                .sorted { $0.occurredAt < $1.occurredAt }
                .prefix(limit)
                .map { hit($0, score: 0, terms: [], timeZone: timeZone) }
        }

        if vectors == nil { vectors = try store.allVectors() }
        let queryVector = MacDataEmbedding.vector(query)
        var scored: [(MacDataItem, Double)] = []
        for item in candidates {
            let keyword = MacDataRanking.keywordScore(
                terms: terms,
                text: MacDataEmbedding.text(for: item) + " " + item.participants.joined(separator: " "))
            var semantic = 0.0
            if let queryVector, let itemVectors = vectors?[item.id] {
                for vector in itemVectors where vector.count == queryVector.count {
                    var dot: Float = 0
                    for index in 0..<vector.count { dot += vector[index] * queryVector[index] }
                    semantic = max(semantic, Double(dot))
                }
            }
            // Keywords dominate for names and numbers; meaning catches paraphrases.
            let score = semantic + keyword * 0.6
            guard keyword > 0 || semantic >= 0.45 else { continue }
            scored.append((item, score))
        }
        return
            scored
            .sorted { $0.1 == $1.1 ? $0.0.occurredAt > $1.0.occurredAt : $0.1 > $1.1 }
            .prefix(limit)
            .map { hit($0.0, score: $0.1, terms: terms, timeZone: timeZone) }
    }

    func hit(_ item: MacDataItem, score: Double, terms: [String], timeZone: TimeZone)
        -> MacDataSearchHit
    {
        let formatter = ISO8601DateFormatter()
        formatter.timeZone = timeZone
        formatter.formatOptions = [.withInternetDateTime]
        return MacDataSearchHit(
            id: item.id,
            source: item.source,
            when: formatter.string(from: Date(timeIntervalSince1970: item.occurredAt)),
            end: item.endAt.map { formatter.string(from: Date(timeIntervalSince1970: $0)) },
            allDay: item.allDay,
            title: item.title,
            sender: item.sender,
            participants: item.participants.isEmpty ? nil : Array(item.participants.prefix(10)),
            location: item.location,
            calendar: item.calendar,
            mailbox: item.mailbox,
            snippet: MacDataRanking.snippet(item.body, terms: terms),
            score: (score * 1000).rounded() / 1000)
    }
}
#endif
