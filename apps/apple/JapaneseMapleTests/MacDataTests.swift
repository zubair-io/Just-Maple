//
//  MacDataTests.swift
//  JapaneseMapleTests
//
//  Exercises the Mac data readers against small synthetic copies of the
//  Messages and Mail databases. No real user data is read.
//

#if os(macOS)
import Foundation
import Testing

@testable import JapaneseMaple

private func tempDirectory() throws -> URL {
    let url = FileManager.default.temporaryDirectory
        .appendingPathComponent("macdata-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

/// A typedstream-style attributedBody blob holding `text`.
private func attributedBody(_ text: String) -> Data {
    var bytes = Array("streamtyped\u{81}\u{e8}\u{03}\u{84}\u{01}@\u{84}\u{84}\u{84}\u{12}NSAttributedString\u{00}\u{84}\u{84}\u{08}NSObject\u{00}\u{85}\u{92}\u{84}\u{84}\u{84}\u{08}NSString".utf8)
    bytes += [0x01, 0x94, 0x84, 0x01, 0x2B]
    let utf8 = Array(text.utf8)
    if utf8.count < 0x80 {
        bytes.append(UInt8(utf8.count))
    } else {
        bytes += [0x81, UInt8(utf8.count & 0xFF), UInt8(utf8.count >> 8)]
    }
    bytes += utf8
    bytes += [0x86, 0x84]
    return Data(bytes)
}

// MARK: - iMessage

@Suite struct IMessageReaderTests {
    let now = Date(timeIntervalSince1970: 1_790_000_000)

    private func makeChatDB() throws -> (URL, MacDataSQLite) {
        let url = try tempDirectory().appendingPathComponent("chat.db")
        let db = try MacDataSQLite(path: url.path, readOnly: false)
        try db.execute("CREATE TABLE handle(ROWID INTEGER PRIMARY KEY, id TEXT)")
        try db.execute(
            "CREATE TABLE chat(ROWID INTEGER PRIMARY KEY, chat_identifier TEXT, display_name TEXT)")
        try db.execute("CREATE TABLE chat_message_join(chat_id INTEGER, message_id INTEGER)")
        try db.execute("CREATE TABLE chat_handle_join(chat_id INTEGER, handle_id INTEGER)")
        try db.execute(
            """
            CREATE TABLE message(ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, attributedBody BLOB,
                date INTEGER, date_edited INTEGER DEFAULT 0, date_retracted INTEGER DEFAULT 0,
                is_from_me INTEGER, handle_id INTEGER, service TEXT, cache_has_attachments INTEGER DEFAULT 0,
                associated_message_type INTEGER DEFAULT 0)
            """)
        try db.execute("INSERT INTO handle VALUES (1, '+15185550100'), (2, 'coach@example.com')")
        try db.execute("INSERT INTO chat VALUES (1, 'chat1', 'Soccer parents')")
        try db.execute("INSERT INTO chat_handle_join VALUES (1, 1), (1, 2)")
        return (url, db)
    }

    private func insert(
        _ db: MacDataSQLite, rowid: Int, text: String?, body: Data? = nil, at date: Date,
        fromMe: Bool = false, reaction: Bool = false
    ) throws {
        try db.execute(
            "INSERT INTO message(ROWID, guid, text, attributedBody, date, is_from_me, handle_id, service, associated_message_type) VALUES (?, ?, ?, ?, ?, ?, 2, 'iMessage', ?)",
            [rowid, "guid-\(rowid)", text, body, IMessageReader.appleNanos(date), fromMe, reaction ? 2000 : 0])
        try db.execute("INSERT INTO chat_message_join VALUES (1, ?)", [rowid])
    }

    @Test func importsRecentMessagesOnly() throws {
        let (url, db) = try makeChatDB()
        try insert(db, rowid: 1, text: "Too old", at: now.addingTimeInterval(-40 * 86_400))
        try insert(db, rowid: 2, text: "No practice Friday", at: now.addingTimeInterval(-3600))
        try insert(db, rowid: 3, text: nil, body: attributedBody("Purple socks tomorrow"), at: now.addingTimeInterval(-60))
        try insert(db, rowid: 4, text: "Loved “No practice Friday”", at: now, reaction: true)
        try insert(db, rowid: 5, text: "Thanks!", at: now, fromMe: true)

        let result = try IMessageReader(databaseURL: url).read(checkpoint: nil, now: now)
        #expect(result.items.map(\.body) == ["No practice Friday", "Purple socks tomorrow", "Thanks!"])
        let first = try #require(result.items.first)
        #expect(first.id == "imessage:guid-2")
        #expect(first.thread == "Soccer parents")
        #expect(first.sender == "coach@example.com")
        #expect(first.participants == ["+15185550100", "coach@example.com"])
        #expect(result.items.last?.sender == "Me")
        #expect(abs(first.occurredAt - now.addingTimeInterval(-3600).timeIntervalSince1970) < 0.001)
    }

    @Test func laterPassesReturnOnlyNewAndEditedMessages() throws {
        let (url, db) = try makeChatDB()
        let reader = IMessageReader(databaseURL: url)
        try insert(db, rowid: 1, text: "Game at 4:30", at: now.addingTimeInterval(-600))
        let first = try reader.read(checkpoint: nil, now: now)
        #expect(first.items.count == 1)

        let unchanged = try reader.read(checkpoint: first.checkpoint, now: now.addingTimeInterval(60))
        #expect(unchanged.items.isEmpty)

        try insert(db, rowid: 2, text: "Bus leaves at 3:30", at: now.addingTimeInterval(90))
        try db.execute(
            "UPDATE message SET text='Game at 5:00', date_edited=? WHERE ROWID=1",
            [IMessageReader.appleNanos(now.addingTimeInterval(100))])
        let later = try reader.read(checkpoint: unchanged.checkpoint, now: now.addingTimeInterval(120))
        #expect(Set(later.items.map(\.body)) == ["Game at 5:00", "Bus leaves at 3:30"])
        let edited = try #require(later.items.first { $0.id == "imessage:guid-1" })
        #expect(edited.revision != first.items[0].revision)
    }

    @Test func decodesLongAttributedBodies() {
        let text = String(repeating: "a", count: 300)
        #expect(IMessageReader.typedStreamString(attributedBody(text)) == text)
    }
}

// MARK: - Mail

@Suite struct MailReaderTests {
    let now = Date(timeIntervalSince1970: 1_790_000_000)

    private func makeMailRoot() throws -> (URL, MacDataSQLite) {
        let root = try tempDirectory()
        let data = root.appendingPathComponent("V10/MailData", isDirectory: true)
        try FileManager.default.createDirectory(at: data, withIntermediateDirectories: true)
        let db = try MacDataSQLite(path: data.appendingPathComponent("Envelope Index").path, readOnly: false)
        try db.execute("CREATE TABLE addresses(ROWID INTEGER PRIMARY KEY, address TEXT, comment TEXT)")
        try db.execute("CREATE TABLE subjects(ROWID INTEGER PRIMARY KEY, subject TEXT)")
        try db.execute("CREATE TABLE summaries(ROWID INTEGER PRIMARY KEY, summary TEXT)")
        try db.execute("CREATE TABLE mailboxes(ROWID INTEGER PRIMARY KEY, url TEXT)")
        try db.execute("CREATE TABLE recipients(ROWID INTEGER PRIMARY KEY, message INTEGER, address INTEGER, type INTEGER, position INTEGER)")
        try db.execute(
            """
            CREATE TABLE messages(ROWID INTEGER PRIMARY KEY, sender INTEGER, subject INTEGER, subject_prefix TEXT,
                summary INTEGER, date_received INTEGER, mailbox INTEGER, read INTEGER, deleted INTEGER)
            """)
        try db.execute("INSERT INTO addresses VALUES (1, 'mcinfo@ups.com', 'UPS'), (2, 'me@example.com', '')")
        try db.execute("INSERT INTO mailboxes VALUES (1, 'imap://abc/INBOX'), (2, 'imap://abc/Junk')")
        return (root, db)
    }

    private func insert(_ db: MacDataSQLite, rowid: Int, subject: String, at date: Date, mailbox: Int = 1) throws {
        try db.execute("INSERT INTO subjects VALUES (?, ?)", [rowid, subject])
        try db.execute("INSERT INTO summaries VALUES (?, ?)", [rowid, "Preview of \(subject)"])
        try db.execute(
            "INSERT INTO messages VALUES (?, 1, ?, '', ?, ?, ?, 0, 0)",
            [rowid, rowid, rowid, Int(date.timeIntervalSince1970), mailbox])
        try db.execute("INSERT INTO recipients(message, address, type, position) VALUES (?, 2, 0, 0)", [rowid])
    }

    @Test func readsEnvelopeIndexAndFullBodies() throws {
        let (root, db) = try makeMailRoot()
        try insert(db, rowid: 1, subject: "Your package is arriving today", at: now.addingTimeInterval(-3600))
        try insert(db, rowid: 2, subject: "You won a prize", at: now.addingTimeInterval(-60), mailbox: 2)
        try insert(db, rowid: 3, subject: "Old news", at: now.addingTimeInterval(-60 * 86_400))

        let messages = root.appendingPathComponent("V10/ACCOUNT/INBOX.mbox/STORE/Data/Messages", isDirectory: true)
        try FileManager.default.createDirectory(at: messages, withIntermediateDirectories: true)
        let raw = """
            Subject: Your package is arriving today\r
            Content-Type: multipart/alternative; boundary="b1"\r
            \r
            --b1\r
            Content-Type: text/plain; charset=utf-8\r
            Content-Transfer-Encoding: quoted-printable\r
            \r
            Expected by 5pm. A signature is re=\r
            quired =E2=80=94 bring ID.\r
            --b1\r
            Content-Type: text/html\r
            \r
            <p>HTML version</p>\r
            --b1--\r

            """
        let emlx = "\(raw.utf8.count)\n\(raw)<?xml version=\"1.0\"?><plist/>"
        try Data(emlx.utf8).write(to: messages.appendingPathComponent("1.emlx"))

        let result = try MailReader(mailRoot: root).read(checkpoint: nil, now: now)
        #expect(result.items.count == 1)
        let item = try #require(result.items.first)
        #expect(item.id == "mail:1")
        #expect(item.title == "Your package is arriving today")
        #expect(item.sender == "UPS <mcinfo@ups.com>")
        #expect(item.mailbox == "INBOX")
        #expect(item.participants == ["me@example.com"])
        #expect(item.body == "Expected by 5pm. A signature is required — bring ID.")
        #expect(result.presentIds == ["mail:1"])
    }

    @Test func fillsInFullTextOnceMailWritesTheFile() throws {
        let (root, db) = try makeMailRoot()
        try insert(db, rowid: 7, subject: "Pickup ready", at: now.addingTimeInterval(-60))
        let store = try MacDataStore(path: tempDirectory().appendingPathComponent("store.sqlite").path)
        try store.enable(.mail)

        let first = try MailReader(mailRoot: root).read(checkpoint: nil, now: now)
        try store.apply(first, source: .mail, now: now)
        #expect(try store.query(MacDataQuery(source: .mail)).items.first?.body == "Preview of Pickup ready")

        let messages = root.appendingPathComponent("V10/ACCOUNT/INBOX.mbox/Messages", isDirectory: true)
        try FileManager.default.createDirectory(at: messages, withIntermediateDirectories: true)
        let raw = "Subject: Pickup ready\n\nBring ID to The UPS Store by Wednesday.\n"
        try Data("\(raw.utf8.count)\n\(raw)".utf8).write(to: messages.appendingPathComponent("7.emlx"))

        // A later pass (here, after relaunch) retries the message even though its row id is old.
        let second = try MailReader(mailRoot: root).read(
            checkpoint: try store.checkpoint(.mail), now: now.addingTimeInterval(60))
        #expect(try store.apply(second, source: .mail, now: now) == 1)
        #expect(try store.query(MacDataQuery(source: .mail)).items.first?.body == "Bring ID to The UPS Store by Wednesday.")
        #expect(try store.checkpoint(.mail)?.contains("\"awaitingBody\":[]") == true)
    }

    @Test func storeDropsMailThatWasDeleted() throws {
        let (root, db) = try makeMailRoot()
        try insert(db, rowid: 1, subject: "Keep", at: now.addingTimeInterval(-3600))
        try insert(db, rowid: 2, subject: "Delete me", at: now.addingTimeInterval(-1800))
        let store = try MacDataStore(path: tempDirectory().appendingPathComponent("store.sqlite").path)
        try store.enable(.mail)
        let reader = MailReader(mailRoot: root)

        let first = try reader.read(checkpoint: nil, now: now)
        #expect(try store.apply(first, source: .mail, now: now) == 2)
        // Mail has no body file here, so the preview text stands in.
        #expect(try store.query(MacDataQuery(source: .mail, search: "delete")).items.first?.body == "Preview of Delete me")

        try db.execute("UPDATE messages SET deleted = 1 WHERE ROWID = 2")
        let second = try reader.read(checkpoint: try store.checkpoint(.mail), now: now.addingTimeInterval(60))
        #expect(try store.apply(second, source: .mail, now: now) == 1)
        #expect(try store.query(MacDataQuery(source: .mail)).items.map(\.title) == ["Keep"])
    }
}

// MARK: - Store

@Suite struct MacDataStoreTests {
    private func item(_ id: String, _ body: String, at time: Double, revision: String = "1") -> MacDataItem {
        MacDataItem(
            id: id, source: .imessage, revision: revision, occurredAt: time, endAt: nil,
            title: "Thread", sender: "Coach", participants: [], thread: "Thread", body: body,
            isFromMe: false, location: nil, calendar: nil, allDay: nil, mailbox: nil, isRead: nil)
    }

    private func result(_ items: [MacDataItem]) -> MacDataReadResult {
        MacDataReadResult(items: items, removedIds: [], presentIds: nil, reconcileWindow: nil, checkpoint: "cp")
    }

    @Test func skipsUnchangedItemsAndSearchesEveryWord() throws {
        let store = try MacDataStore(path: tempDirectory().appendingPathComponent("store.sqlite").path)
        try store.enable(.imessage)
        let items = [item("a", "Lacrosse practice at DiCaprio Park", at: 10), item("b", "Soccer at 4:30pm", at: 20)]
        #expect(try store.apply(result(items), source: .imessage) == 2)
        #expect(try store.apply(result(items), source: .imessage) == 0)
        #expect(try store.apply(result([item("a", "Practice moved", at: 10, revision: "2")]), source: .imessage) == 1)

        #expect(try store.query(MacDataQuery(source: .imessage, search: "soccer 4:30")).items.map(\.id) == ["b"])
        #expect(try store.query(MacDataQuery(source: .imessage, search: "100%")).total == 0)
        let newestFirst = try store.query(MacDataQuery(source: .imessage))
        #expect(newestFirst.items.map(\.id) == ["b", "a"])
        #expect(try store.checkpoint(.imessage) == "cp")
    }

    @Test func pagesAreScopedToNotebooks() throws {
        let store = try MacDataStore(path: tempDirectory().appendingPathComponent("store.sqlite").path)
        try store.insert(MacDataPage(id: "p1", notebookId: "n1", source: .mail, title: "Email", createdAt: 1))
        try store.insert(MacDataPage(id: "p2", notebookId: "n2", source: .calendar, title: "Calendar", createdAt: 2))
        #expect(try store.pages(notebookId: "n1").map(\.id) == ["p1"])
        try store.rename(pageId: "p1", title: "Inbox")
        #expect(try store.page(id: "p1")?.title == "Inbox")
        try store.delete(pageId: "p1")
        #expect(try store.pages(notebookId: nil).map(\.id) == ["p2"])
    }
}

// MARK: - Mail parsing

@Suite struct MailMessageParserTests {
    @Test func decodesBase64HTMLWhenThereIsNoPlainText() {
        let html = "<html><style>p{}</style><p>Pickup at <b>The UPS Store</b>&nbsp;&amp; bring ID</p><p>Thanks &#8212; UPS</p></html>"
        let raw = "Content-Type: text/html; charset=utf-8\nContent-Transfer-Encoding: base64\n\n"
            + Data(html.utf8).base64EncodedString(options: .lineLength76Characters)
        #expect(MailMessageParser.bodyText(message: Data(raw.utf8)) == "Pickup at The UPS Store & bring ID\nThanks — UPS")
    }

    @Test func skipsAttachments() {
        let raw = """
            Content-Type: multipart/mixed; boundary=xyz

            --xyz
            Content-Type: text/plain
            Content-Disposition: attachment; filename=notes.txt

            attachment text
            --xyz
            Content-Type: text/plain

            The real body
            --xyz--
            """
        #expect(MailMessageParser.bodyText(message: Data(raw.utf8)) == "The real body")
    }
}
#endif

// MARK: - Search and proactive batches

#if os(macOS)
@Suite struct MacDataRelayTests {
    let now = Date(timeIntervalSince1970: 1_790_000_000)

    private func item(
        _ id: String, _ source: MacDataSource, _ title: String, _ body: String, at time: Double,
        fromMe: Bool = false, end: Double? = nil
    ) -> MacDataItem {
        MacDataItem(
            id: id, source: source, revision: "1", occurredAt: time, endAt: end, title: title,
            sender: source == .imessage ? (fromMe ? "Me" : "coach@example.com") : "notices@example.com",
            participants: [], thread: nil, body: body, isFromMe: source == .imessage ? fromMe : nil,
            location: nil, calendar: nil, allDay: nil, mailbox: nil, isRead: nil)
    }

    /// An engine over a temporary store with pages in notebook "n1" for iMessage and Calendar.
    private func makeEngine(_ items: [MacDataItem]) async throws -> (MacDataEngine, MacDataStore) {
        let path = try tempDirectory().appendingPathComponent("store.sqlite").path
        let engine = MacDataEngine(storePath: path)
        _ = try await engine.createPage(notebookId: "n1", source: .imessage, title: nil)
        _ = try await engine.createPage(notebookId: "n1", source: .calendar, title: nil)
        _ = try await engine.createPage(notebookId: "n2", source: .mail, title: nil)
        let store = try await engine.store()
        for source in MacDataSource.allCases {
            let batch = items.filter { $0.source == source }
            guard !batch.isEmpty else { continue }
            try store.apply(
                MacDataReadResult(items: batch, removedIds: [], presentIds: nil, reconcileWindow: nil, checkpoint: "cp"),
                source: source, now: now)
        }
        return (engine, store)
    }

    @Test func searchIsScopedToTheNotebooksMacPages() async throws {
        let t = now.timeIntervalSince1970
        let (engine, _) = try await makeEngine([
            item("imessage:1", .imessage, "Soccer parents", "No practice Friday", at: t - 3600),
            item("mail:1", .mail, "UPS delivery", "Your package arrives Friday", at: t - 1800),
        ])
        let n1 = try await engine.search(MacDataSearchRequest(notebookId: "n1", query: "friday"))
        #expect(n1.map(\.id) == ["imessage:1"])  // mail has no page in n1
        let n2 = try await engine.search(MacDataSearchRequest(notebookId: "n2", query: "friday"))
        #expect(n2.map(\.id) == ["mail:1"])
        let none = try await engine.search(MacDataSearchRequest(notebookId: "other", query: "friday"))
        #expect(none.isEmpty)
        #expect(try await engine.item(id: "mail:1", notebookId: "n1") == nil)
        #expect(try await engine.item(id: "mail:1", notebookId: "n2")?.title == "UPS delivery")
    }

    @Test func searchRanksByMeaningAfterEmbedding() async throws {
        let t = now.timeIntervalSince1970
        let (engine, _) = try await makeEngine([
            item("imessage:1", .imessage, "Coach", "Lacrosse practice is 2:30 to 4:30 at DiCaprio Park field 4", at: t - 7200),
            item("imessage:2", .imessage, "Julia", "Can you pick up milk on the way home", at: t - 3600),
        ])
        #expect(await engine.embedPending() == 2)
        let hits = try await engine.search(
            MacDataSearchRequest(notebookId: "n1", query: "when does lacrosse start", limit: 1))
        #expect(hits.first?.id == "imessage:1")
        #expect(hits.first?.when.hasPrefix("20") == true)
        // A date range without a query lists items in time order.
        let listed = try await engine.search(
            MacDataSearchRequest(notebookId: "n1", from: t - 10_000, to: t))
        #expect(listed.map(\.id) == ["imessage:1", "imessage:2"])
    }

    @Test func proactiveBatchesOnlyCarryFreshNewsForProactiveNotebooks() async throws {
        let t = now.timeIntervalSince1970
        let (engine, _) = try await makeEngine([
            item("imessage:new", .imessage, "Coach", "Purple socks tomorrow", at: t - 600),
            item("imessage:mine", .imessage, "Coach", "Thanks!", at: t - 500, fromMe: true),
            item("imessage:old", .imessage, "Coach", "Last week's news", at: t - 3 * 86_400),
            item("calendar:soon", .calendar, "Game vs LaSalle", "", at: t + 86_400, end: t + 90_000),
            item("calendar:past", .calendar, "Old game", "", at: t - 86_400, end: t - 80_000),
            item("mail:1", .mail, "UPS", "Signature required", at: t - 100),
        ])

        // Without proactive notebooks nothing is sent, and the cursor skips ahead.
        let idle = try await engine.proactiveBatches(for: [], now: now)
        #expect(idle.batches.isEmpty)

        let result = try await engine.proactiveBatches(for: ["n1", "n2"], now: now)
        let n1 = try #require(result.batches.first { $0.notebookId == "n1" })
        #expect(Set(n1.entries.map(\.item.id)) == ["imessage:new", "calendar:soon"])
        let n2 = try #require(result.batches.first { $0.notebookId == "n2" })
        #expect(n2.entries.map(\.item.id) == ["mail:1"])

        try await engine.commitProactiveCursor(result.cursor)
        let again = try await engine.proactiveBatches(for: ["n1", "n2"], now: now)
        #expect(again.batches.isEmpty)
    }
}
#endif
