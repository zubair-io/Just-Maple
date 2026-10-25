//
//  MailReader.swift
//  JapaneseMaple
//
//  Reads the Mail app's local store: the "Envelope Index" database for
//  sender, subject, date and preview, and the per-message `.emlx` files
//  for full text. Covers every account added to Mail. Requires Full
//  Disk Access. Read-only.
//

#if os(macOS)
import Foundation

nonisolated final class MailReader: @unchecked Sendable {
    struct Checkpoint: Codable {
        var lastRowId: Int64
        /// Messages imported with only Mail's preview because their `.emlx` file
        /// wasn't found yet (Mail can write it after the index row). Retried each pass.
        var awaitingBody: [Int64]?
    }

    static let maxAwaitingBody = 500

    let mailRoot: URL
    /// Message row id → `.emlx` file, built lazily because the store can hold
    /// hundreds of thousands of files.
    private var emlxIndex: [Int64: URL] = [:]
    private var emlxIndexBuiltAt: Date?

    init(mailRoot: URL = MacDataPaths.mailRoot) {
        self.mailRoot = mailRoot
    }

    /// The newest "V<n>" folder, e.g. ~/Library/Mail/V10.
    func versionFolder() throws -> URL {
        let entries: [URL]
        do {
            entries = try FileManager.default.contentsOfDirectory(
                at: mailRoot, includingPropertiesForKeys: nil)
        } catch {
            throw MacDataError.accessDenied("Maple can't read Mail's folder: \(error.localizedDescription)")
        }
        let versions = entries.compactMap { url -> (Int, URL)? in
            let name = url.lastPathComponent
            guard name.hasPrefix("V"), let number = Int(name.dropFirst()) else { return nil }
            return (number, url)
        }
        guard let newest = versions.max(by: { $0.0 < $1.0 }) else {
            throw MacDataError.unsupported("Mail hasn't been set up on this Mac.")
        }
        return newest.1
    }

    /// `names` replaces sender names with the matching contact's name.
    func read(checkpoint: String?, now: Date = Date(), names: MacDataContactNames = .empty) throws
        -> MacDataReadResult
    {
        let version = try versionFolder()
        let indexURL = version.appendingPathComponent("MailData/Envelope Index")
        let db = try MacDataSQLite(path: indexURL.path, readOnly: true)
        try checkSchema(db)

        var state =
            checkpoint.flatMap { try? JSONDecoder().decode(Checkpoint.self, from: Data($0.utf8)) }
            ?? Checkpoint(lastRowId: 0)
        let windowStart = now.addingTimeInterval(-macDataInitialWindow).timeIntervalSince1970
        let messageColumns = try db.columns("messages")
        let prefix = messageColumns.contains("subject_prefix") ? "m.subject_prefix" : "NULL"
        let hidden = Self.hiddenMailboxFilter
        // `IN ()` is invalid SQL, so an empty list matches nothing via a sentinel.
        let awaiting = state.awaitingBody?.isEmpty == false ? state.awaitingBody! : [-1]

        let rows = try db.rows(
            """
            SELECT m.ROWID AS rowid, m.date_received, m.read, \(prefix) AS subject_prefix,
                   a.address, a.comment AS sender_name, s.subject, mb.url AS mailbox, su.summary
            FROM messages m
            LEFT JOIN addresses a ON a.ROWID = m.sender
            LEFT JOIN subjects s ON s.ROWID = m.subject
            LEFT JOIN mailboxes mb ON mb.ROWID = m.mailbox
            LEFT JOIN summaries su ON su.ROWID = m.summary
            WHERE (m.ROWID > ? OR m.ROWID IN (\(awaiting.map { _ in "?" }.joined(separator: ",")))) AND m.date_received >= ? AND m.deleted = 0 AND \(hidden)
            ORDER BY m.ROWID
            LIMIT 20000
            """, [state.lastRowId] + awaiting.map { $0 as Any? } + [windowStart])

        let hasRecipients = try db.tableExists("recipients")
        let previousLastRowId = state.lastRowId
        var items: [MacDataItem] = []
        var stillAwaiting: [Int64] = []
        for row in rows {
            guard let rowid = row["rowid"]?.int else { continue }
            state.lastRowId = max(state.lastRowId, rowid)
            let (item, hasFullBody) = try makeItem(
                row, rowid: rowid, db: db, hasRecipients: hasRecipients,
                isNew: rowid > previousLastRowId, names: names)
            items.append(item)
            if !hasFullBody { stillAwaiting.append(rowid) }
        }
        // Newest first, so a backlog of bodiless mail can't crowd out recent arrivals.
        state.awaitingBody = Array(stillAwaiting.sorted(by: >).prefix(Self.maxAwaitingBody))

        // Anything in the window that Mail deleted, or moved to Junk or Trash, drops out.
        let present = Set(
            try db.rows(
                "SELECT m.ROWID AS rowid FROM messages m LEFT JOIN mailboxes mb ON mb.ROWID = m.mailbox WHERE m.date_received >= ? AND m.deleted = 0 AND \(hidden)",
                [windowStart]
            ).compactMap { $0["rowid"]?.int.map { "mail:\($0)" } })

        let encoded = String(decoding: try JSONEncoder().encode(state), as: UTF8.self)
        return MacDataReadResult(
            items: items, removedIds: [], presentIds: present,
            reconcileWindow: windowStart...now.timeIntervalSince1970.nextUp, checkpoint: encoded)
    }

    /// Junk, Trash and Spam mailboxes are left out. Mailbox URLs are percent-encoded paths.
    static let hiddenMailboxFilter = """
        (mb.url IS NULL OR (lower(mb.url) NOT LIKE '%junk%' AND lower(mb.url) NOT LIKE '%trash%'
         AND lower(mb.url) NOT LIKE '%spam%' AND lower(mb.url) NOT LIKE '%deleted%20messages%'))
        """

    private func checkSchema(_ db: MacDataSQLite) throws {
        let required: [String: [String]] = [
            "messages": ["ROWID", "sender", "subject", "summary", "date_received", "mailbox", "read", "deleted"],
            "addresses": ["ROWID", "address", "comment"],
            "subjects": ["ROWID", "subject"],
            "mailboxes": ["ROWID", "url"],
            "summaries": ["ROWID", "summary"],
        ]
        for (table, columns) in required {
            guard try db.tableExists(table) else {
                throw MacDataError.unsupported(
                    "This version of Mail stores messages in a format Maple doesn't recognize yet.")
            }
            let present = try db.columns(table)
            guard columns.allSatisfy(present.contains) else {
                throw MacDataError.unsupported(
                    "This version of Mail stores messages in a format Maple doesn't recognize yet.")
            }
        }
    }

    private func makeItem(
        _ row: MacDataSQLite.Row, rowid: Int64, db: MacDataSQLite, hasRecipients: Bool,
        isNew: Bool, names: MacDataContactNames
    ) throws -> (MacDataItem, hasFullBody: Bool) {
        let subject = [row["subject_prefix"]?.string, row["subject"]?.string]
            .compactMap { $0?.isEmpty == false ? $0 : nil }.joined()
        let address = row["address"]?.string
        let name = address.flatMap(names.name(for:)) ?? row["sender_name"]?.string
        let sender =
            if let name, !name.isEmpty, let address { "\(name) <\(address)>" } else { address ?? name }
        let summary = row["summary"]?.string ?? ""
        let fullBody = emlxURL(rowid: rowid, rescanAfter: isNew ? 60 : 600).flatMap { url in
            (try? Data(contentsOf: url)).flatMap(MailMessageParser.bodyText(emlx:))
        }
        let body = fullBody ?? summary

        var recipients: [String] = []
        if hasRecipients {
            recipients = try db.rows(
                """
                SELECT a.address, a.comment FROM recipients r JOIN addresses a ON a.ROWID = r.address
                WHERE r.message = ? ORDER BY r.type, r.position LIMIT 50
                """, [rowid]
            ).compactMap { $0["address"]?.string }
        }

        let mailbox = row["mailbox"]?.string.map(Self.mailboxName)
        let item = MacDataItem(
            id: "mail:\(rowid)",
            source: .mail,
            revision: macDataStableHash("\(subject)|\(body.count)|\(mailbox ?? "")"),
            occurredAt: row["date_received"]?.double ?? 0,
            endAt: nil,
            title: subject.isEmpty ? "(no subject)" : subject,
            sender: sender,
            participants: recipients,
            thread: nil,
            body: body,
            isFromMe: nil,
            location: nil,
            calendar: nil,
            allDay: nil,
            mailbox: mailbox,
            isRead: (row["read"]?.int ?? 0) != 0)
        return (item, fullBody != nil)
    }

    static func mailboxName(_ url: String) -> String {
        let last = url.split(separator: "/").last.map(String.init) ?? url
        return last.removingPercentEncoding ?? last
    }

    // MARK: - .emlx lookup

    /// Files are named "<rowid>.emlx" (or ".partial.emlx" when attachments
    /// weren't downloaded) somewhere under the version folder.
    /// Rescanning walks the whole mail store, so it's rate-limited: new arrivals may
    /// trigger it once a minute, retries of older mail only every 10 minutes.
    private func emlxURL(rowid: Int64, rescanAfter interval: TimeInterval) -> URL? {
        if let url = emlxIndex[rowid] { return url }
        if let builtAt = emlxIndexBuiltAt, Date().timeIntervalSince(builtAt) < interval {
            return nil
        }
        rebuildEmlxIndex()
        return emlxIndex[rowid]
    }

    private func rebuildEmlxIndex() {
        emlxIndexBuiltAt = Date()
        guard let version = try? versionFolder(),
            let enumerator = FileManager.default.enumerator(
                at: version, includingPropertiesForKeys: nil,
                // ".mbox" folders count as packages, so package contents must be included.
                options: [.skipsHiddenFiles])
        else { return }
        var index: [Int64: URL] = [:]
        for case let url as URL in enumerator where url.pathExtension == "emlx" {
            let name = url.lastPathComponent
            guard let id = name.split(separator: ".").first.flatMap({ Int64($0) }) else { continue }
            // Prefer the complete file over a partial one.
            if index[id] == nil || !name.contains(".partial.") { index[id] = url }
        }
        emlxIndex = index
    }
}
#endif
