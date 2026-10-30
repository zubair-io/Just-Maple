//
//  IMessageReader.swift
//  JapaneseMaple
//
//  Reads the Messages app's local history (chat.db) without modifying it.
//  Requires Full Disk Access. The schema is undocumented, so required
//  columns are checked before every pass.
//

#if os(macOS)
import Foundation

nonisolated struct IMessageReader {
    /// Messages stores dates as nanoseconds since 2001-01-01 (older rows: seconds).
    static let appleEpochOffset: Double = 978_307_200
    static let batchSize = 2_000

    struct Checkpoint: Codable {
        var lastRowId: Int64
        /// Apple-epoch nanoseconds of the previous pass, used to pick up edits and unsends.
        var lastScan: Int64
        /// Rewind legacy window/type-filter checkpoints once, never Mail.
        var historyVersion: Int? = nil
        var editCursor: Int64? = nil
        var editUntil: Int64? = nil
        var editMaxRowId: Int64? = nil
        var backfilling: Bool? = nil
    }

    let databaseURL: URL
    /// The Mac's region, for writing numbers without a country code (see `displayHandle`).
    let region: String?

    init(
        databaseURL: URL = MacDataPaths.messagesDatabase,
        region: String? = Locale.current.region?.identifier
    ) {
        self.databaseURL = databaseURL
        self.region = region
    }

    /// `names` turns phone numbers and emails into contact names for senders and thread titles.
    func read(checkpoint: String?, now: Date = Date(), names: MacDataContactNames = .empty) throws
        -> MacDataReadResult
    {
        let db = try MacDataSQLite(path: databaseURL.path, readOnly: true)
        let columns = try db.columns("message")
        for required in ["ROWID", "guid", "text", "date", "is_from_me", "handle_id"]
        where !columns.contains(required) {
            throw MacDataError.unsupported(
                "This version of Messages stores history in a format Maple doesn't recognize yet.")
        }

        var state =
            checkpoint.flatMap { try? JSONDecoder().decode(Checkpoint.self, from: Data($0.utf8)) }
            ?? Checkpoint(lastRowId: 0, lastScan: 0)
        if state.historyVersion != 3 {
            state = Checkpoint(lastRowId: 0, lastScan: 0, historyVersion: 3, backfilling: true)
        }
        let scanStart = Self.appleNanos(now)

        var optional: [String] = []
        for column in ["attributedBody", "service", "cache_has_attachments"]
        where columns.contains(column) {
            optional.append("m.\(column)")
        }
        // The chat's own id, so a page can share one chat even if it's renamed.
        if try db.columns("chat").contains("guid") { optional.append("c.guid AS chat_guid") }
        let editColumns = ["date_edited", "date_retracted"].filter(columns.contains)
        optional += editColumns.map { "m.\($0)" }
        // Normal/app messages use 0, 2 or 3 (legacy rows can be NULL). Stickers,
        // Tapbacks and poll votes have other types and are not separate message text.
        // See imessage-exporter's Message::variant, which documents this distinction:
        // https://github.com/ReagentX/imessage-exporter/blob/develop/imessage-database/src/tables/messages/message.rs
        let reactionFilter =
            columns.contains("associated_message_type")
            ? "AND (m.associated_message_type IS NULL OR m.associated_message_type IN (0, 2, 3))" : ""
        let select = """
            SELECT m.ROWID AS rowid, m.guid, m.text, m.date, m.is_from_me,
                   h.id AS handle, c.ROWID AS chat_id, c.chat_identifier, c.display_name
                   \(optional.isEmpty ? "" : ", " + optional.joined(separator: ", "))
            FROM message m
            LEFT JOIN handle h ON h.ROWID = m.handle_id
            LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
            LEFT JOIN chat c ON c.ROWID = cmj.chat_id
            WHERE 1 = 1 \(reactionFilter)
            """

        var items: [MacDataItem] = []
        var participantsByChat: [Int64: [String]] = [:]

        // Edits are paged too. Freeze the scan bounds until every page is committed;
        // an interruption or more than 2,000 edits must not lose the remaining edits.
        var moreEdits = false
        if state.lastScan > 0, !editColumns.isEmpty {
            let upper = state.editUntil ?? scanStart
            let maxRow = state.editMaxRowId ?? state.lastRowId
            let edited = editColumns.map { "(m.\($0) > ? AND m.\($0) <= ?)" }.joined(separator: " OR ")
            var bindings: [Any?] = [state.editCursor ?? 0, maxRow]
            for _ in editColumns { bindings.append(contentsOf: [state.lastScan, upper]) }
            let rows = try db.rows(
                "\(select) AND m.ROWID > ? AND m.ROWID <= ? AND (\(edited)) ORDER BY m.ROWID LIMIT \(Self.batchSize)",
                bindings)
            for row in rows {
                if let item = try makeItem(row, db: db, names: names, participantsByChat: &participantsByChat) {
                    items.append(item)
                }
            }
            moreEdits = rows.count == Self.batchSize
            state.editCursor = moreEdits ? rows.last?["rowid"]?.int : nil
            state.editUntil = moreEdits ? upper : nil
            state.editMaxRowId = moreEdits ? maxRow : nil
            if !moreEdits { state.lastScan = upper }
        } else {
            state.lastScan = scanStart
        }

        // One bounded history page per transaction. The engine uploads between pages;
        // the durable cursor resumes the complete history after a quit or interruption.
        let rows = try db.rows(
            "\(select) AND m.ROWID > ? ORDER BY m.ROWID LIMIT \(Self.batchSize)",
            [state.lastRowId])
        for row in rows {
            guard let rowid = row["rowid"]?.int else { continue }
            state.lastRowId = max(state.lastRowId, rowid)
            if let item = try makeItem(row, db: db, names: names, participantsByChat: &participantsByChat) {
                items.append(item)
            }
        }

        if state.backfilling == true {
            for index in items.indices {
                items[index].extra = items[index].extra ?? [:]
                items[index].extra?["historyBackfill"] = .bool(true)
            }
            state.backfilling = rows.count == Self.batchSize || moreEdits
        }
        let encoded = String(decoding: try JSONEncoder().encode(state), as: UTF8.self)
        return MacDataReadResult(
            items: items, removedIds: [], presentIds: nil, reconcileWindow: nil, checkpoint: encoded,
            hasMore: rows.count == Self.batchSize || moreEdits
        )
    }

    private func makeItem(
        _ row: MacDataSQLite.Row, db: MacDataSQLite, names: MacDataContactNames,
        participantsByChat: inout [Int64: [String]]
    ) throws -> MacDataItem? {
        guard let guid = row["guid"]?.string, let rawDate = row["date"]?.int else { return nil }
        let retracted = (row["date_retracted"]?.int ?? 0) > 0
        var text = row["text"]?.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if text.isEmpty, let blob = row["attributedBody"]?.data {
            text = Self.decodeAttributedBody(blob) ?? ""
        }
        text = text.replacingOccurrences(of: "\u{FFFC}", with: "").trimmingCharacters(
            in: .whitespacesAndNewlines)
        if retracted {
            text = "(unsent)"
        } else if text.isEmpty {
            guard (row["cache_has_attachments"]?.int ?? 0) != 0 else { return nil }
            text = "(attachment)"
        }

        var participants: [String] = []
        if let chatId = row["chat_id"]?.int {
            if let cached = participantsByChat[chatId] {
                participants = cached
            } else {
                participants = try db.rows(
                    """
                    SELECT h.id FROM chat_handle_join chj JOIN handle h ON h.ROWID = chj.handle_id
                    WHERE chj.chat_id = ? ORDER BY h.id
                    """, [chatId]
                ).compactMap { $0["id"]?.string }
                participantsByChat[chatId] = participants
            }
        }

        let isFromMe = (row["is_from_me"]?.int ?? 0) != 0
        let handle = row["handle"]?.string
        let displayName = row["display_name"]?.string?.trimmingCharacters(in: .whitespaces)
        let named = { (handle: String) in names.name(for: handle) ?? Self.displayHandle(handle, region: region) }
        let thread =
            (displayName?.isEmpty == false ? displayName : nil)
            ?? (participants.isEmpty
                ? (row["chat_identifier"]?.string ?? handle).map(named)
                : participants.map(named).joined(separator: ", "))
        let edited = row["date_edited"]?.int ?? 0
        let revision = "history2-\(edited)-\(retracted ? 1 : 0)-\(macDataStableHash(text))"

        return MacDataItem(
            id: "imessage:\(guid)",
            source: .imessage,
            revision: revision,
            occurredAt: Self.unixSeconds(rawDate),
            endAt: nil,
            title: thread,
            sender: isFromMe ? "Me" : handle.map(named),
            participants: participants,
            thread: thread,
            body: String(text.prefix(20_000)),
            isFromMe: isFromMe,
            location: nil,
            calendar: nil,
            allDay: nil,
            mailbox: row["service"]?.string,
            isRead: nil,
            extra: {
                var values: [String: JSONValue] = [:]
                if let chat = row["chat_guid"]?.string { values["chatId"] = .string(chat) }
                if !isFromMe, let handle { values["senderHandle"] = .string(handle) }
                return values.isEmpty ? nil : values
            }())
    }

    // MARK: - Handles

    /// Regions that dial with North American numbers (+1).
    static let northAmericanRegions: Set<String> = [
        "US", "CA", "PR", "VI", "GU", "AS", "MP", "AG", "AI", "BB", "BM", "BS", "DM", "DO", "GD",
        "JM", "KN", "KY", "LC", "MS", "SX", "TC", "TT", "VC", "VG",
    ]

    /// One form for a handle with no contact card, so the same person's SMS, RCS and
    /// iMessage chats get one thread name. A number with a country code becomes "+" and its
    /// digits; one without gets "+1" only on a Mac set to a North American region, and only
    /// if it looks like a North American number. Anything else stays as Messages has it.
    static func displayHandle(
        _ handle: String, region: String? = Locale.current.region?.identifier
    ) -> String {
        let value = handle.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.contains("@") { return value.lowercased() }
        let digits = value.unicodeScalars.filter { ("0"..."9").contains($0) }.map(String.init).joined()
        guard digits.count >= 7 else { return value }
        if value.hasPrefix("+") { return "+" + digits }
        guard let region, northAmericanRegions.contains(region) else { return value }
        let national = digits.count == 11 && digits.hasPrefix("1") ? String(digits.dropFirst()) : digits
        guard national.count == 10,
            let area = national.first, ("2"..."9").contains(area),
            let exchange = national.dropFirst(3).first, ("2"..."9").contains(exchange)
        else { return value }
        return "+1" + national
    }

    // MARK: - Dates

    static func unixSeconds(_ raw: Int64) -> Double {
        // Values above ~1e12 are nanoseconds; older databases used seconds.
        let seconds = raw > 1_000_000_000_000 ? Double(raw) / 1_000_000_000 : Double(raw)
        return seconds + appleEpochOffset
    }

    static func appleNanos(_ date: Date) -> Int64 {
        Int64((date.timeIntervalSince1970 - appleEpochOffset) * 1_000_000_000)
    }

    // MARK: - attributedBody

    /// Newer macOS versions often leave `text` empty and keep the message in
    /// `attributedBody`, an NSAttributedString in the legacy typedstream format.
    static func decodeAttributedBody(_ data: Data) -> String? {
        if let string = typedStreamString(data), !string.isEmpty {
            return string
        }
        if let unarchived = NSUnarchiver.unarchiveObject(with: data) as? NSAttributedString {
            return unarchived.string
        }
        return nil
    }

    /// Extracts the first NSString payload from a typedstream without unarchiving it.
    /// Layout after the class name: 0x01 0x94 0x84 0x01 '+' <length> <utf8 bytes>,
    /// where length is one byte, or 0x81 followed by a little-endian UInt16,
    /// or 0x82 followed by a little-endian UInt32.
    static func typedStreamString(_ data: Data) -> String? {
        let bytes = [UInt8](data)
        let marker = Array("NSString".utf8)
        guard let start = bytes.firstRange(of: marker)?.upperBound else { return nil }
        guard let plus = bytes[start...].prefix(16).firstIndex(of: 0x2B) else { return nil }
        var index = plus + 1
        guard index < bytes.count else { return nil }
        var length = 0
        switch bytes[index] {
        case 0x81:
            guard index + 2 < bytes.count else { return nil }
            length = Int(bytes[index + 1]) | Int(bytes[index + 2]) << 8
            index += 3
        case 0x82:
            guard index + 4 < bytes.count else { return nil }
            length =
                Int(bytes[index + 1]) | Int(bytes[index + 2]) << 8 | Int(bytes[index + 3]) << 16
                | Int(bytes[index + 4]) << 24
            index += 5
        default:
            length = Int(bytes[index])
            index += 1
        }
        guard length > 0, index + length <= bytes.count else { return nil }
        return String(bytes: bytes[index..<(index + length)], encoding: .utf8)
    }
}
#endif
