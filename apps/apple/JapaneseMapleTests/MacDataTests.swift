//
//  MacDataTests.swift
//  JapaneseMapleTests
//
//  Exercises the Mac data readers against small synthetic copies of the
//  Messages and Mail databases, contacts built in memory, and the uploader
//  against a stubbed server. No real user data is read or sent.
//

#if os(macOS)
import Contacts
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
            "CREATE TABLE chat(ROWID INTEGER PRIMARY KEY, guid TEXT, chat_identifier TEXT, display_name TEXT)")
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
        try db.execute("INSERT INTO chat VALUES (1, 'iMessage;+;chat1', 'chat1', 'Soccer parents')")
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
        #expect(first.extra?["chatId"] == .string("iMessage;+;chat1"))
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

    @Test func keepsRepliesThatOnlyHaveAnAttributedBody() throws {
        let (url, db) = try makeChatDB()
        try insert(db, rowid: 1, text: nil, body: attributedBody("Sure, Thursday works"), at: now, fromMe: true)
        let item = try #require(IMessageReader(databaseURL: url).read(checkpoint: nil, now: now).items.first)
        #expect(item.body == "Sure, Thursday works")
        #expect(item.isFromMe == true)
        #expect(item.sender == "Me")
        #expect(item.thread == "Soccer parents")
    }

    @Test func oneNumberOverSMSAndIMessageIsOneThread() throws {
        let (url, db) = try makeChatDB()
        // No contact card. Messages keeps a handle and a chat per service.
        try db.execute("INSERT INTO handle VALUES (3, '+15185550142'), (4, '(518) 555-0142')")
        try db.execute(
            "INSERT INTO chat VALUES (2, 'iMessage;-;+15185550142', '+15185550142', ''), (3, 'SMS;-;(518) 555-0142', '(518) 555-0142', '')")
        try db.execute("INSERT INTO chat_handle_join VALUES (2, 3), (3, 4)")
        let rows: [(Int, Int, Int, Bool, String)] = [
            (1, 2, 3, false, "Coffee this week?"), (2, 3, 4, true, "Yes! Thursday?"),
        ]
        for (rowid, chat, handle, fromMe, text) in rows {
            try db.execute(
                "INSERT INTO message(ROWID, guid, text, date, is_from_me, handle_id, service) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [rowid, "g\(rowid)", text, IMessageReader.appleNanos(now.addingTimeInterval(Double(rowid))), fromMe, handle,
                 chat == 2 ? "iMessage" : "SMS"])
            try db.execute("INSERT INTO chat_message_join VALUES (?, ?)", [chat, rowid])
        }
        let items = try IMessageReader(databaseURL: url, region: "US").read(checkpoint: nil, now: now.addingTimeInterval(10)).items
        #expect(items.map(\.thread) == ["+15185550142", "+15185550142"])
        #expect(items.map(\.sender) == ["+15185550142", "Me"])
        #expect(items.map(\.mailbox) == ["iMessage", "SMS"])
        // The chat ids stay as Messages has them; the server treats both as one conversation.
        #expect(items.map { $0.extra?["chatId"] } == [.string("iMessage;-;+15185550142"), .string("SMS;-;(518) 555-0142")])
    }

    @Test func showsHandlesWithoutACardInOneForm() {
        #expect(IMessageReader.displayHandle("+15185550142", region: "US") == "+15185550142")
        #expect(IMessageReader.displayHandle("(518) 555-0142", region: "US") == "+15185550142")
        #expect(IMessageReader.displayHandle("1-518-555-0142", region: "CA") == "+15185550142")
        #expect(IMessageReader.displayHandle("+44 20 7946 0958", region: "US") == "+442079460958")
        #expect(IMessageReader.displayHandle("Coach@Example.com", region: "US") == "coach@example.com")
        #expect(IMessageReader.displayHandle("12345", region: "US") == "12345")
        // Without a country code, only a North American Mac assumes +1.
        #expect(IMessageReader.displayHandle("(518) 555-0142", region: "GB") == "(518) 555-0142")
        #expect(IMessageReader.displayHandle("06 12 34 56 78", region: "FR") == "06 12 34 56 78")
        #expect(IMessageReader.displayHandle("(518) 555-0142", region: nil) == "(518) 555-0142")
        // Not shaped like a North American number: left alone.
        #expect(IMessageReader.displayHandle("0612345678", region: "US") == "0612345678")
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

// MARK: - Shared helpers

#if os(macOS)
private func makeItem(
    _ id: String, _ source: MacDataSource, at time: Double, revision: String = "1",
    body: String = "Body", end: Double? = nil
) -> MacDataItem {
    MacDataItem(
        id: id, source: source, revision: revision, occurredAt: time, endAt: end, title: "Title \(id)",
        sender: "Coach", participants: [], thread: nil, body: body, isFromMe: false, location: nil,
        calendar: nil, allDay: nil, mailbox: nil, isRead: nil)
}

private func readResult(_ items: [MacDataItem], removed: [String] = []) -> MacDataReadResult {
    MacDataReadResult(items: items, removedIds: removed, presentIds: nil, reconcileWindow: nil, checkpoint: "cp")
}

// MARK: - Upload

/// Answers the upload API from memory and records what was sent.
final class StubServer: URLProtocol, @unchecked Sendable {
    struct Request {
        var path: String
        var json: [String: Any]
    }

    nonisolated(unsafe) private static var requests: [Request] = []
    nonisolated(unsafe) private static var activeSources = ["imessage", "calendar"]
    nonisolated(unsafe) private static var uploadCount = 0
    /// The upload request (1-based) that fails with a 500.
    nonisolated(unsafe) private static var failingUpload: Int?
    private static let lock = NSLock()

    static func reset(activeSources: [String] = ["imessage", "calendar"], failingUpload: Int? = nil) {
        lock.withLock {
            requests = []
            uploadCount = 0
            self.activeSources = activeSources
            self.failingUpload = failingUpload
        }
    }

    static var requestCount: Int { lock.withLock { requests.count } }

    static func uploads() -> [[String: Any]] {
        lock.withLock { requests.filter { $0.path == "/api/device-data/items" }.map(\.json) }
    }

    static func registrations() -> [[String: Any]] {
        lock.withLock { requests.filter { $0.path == "/api/collectors" }.map(\.json) }
    }

    static func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubServer.self]
        return URLSession(configuration: configuration)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        var body = request.httpBody ?? Data()
        if body.isEmpty, let stream = request.httpBodyStream {
            stream.open()
            var buffer = [UInt8](repeating: 0, count: 64 * 1024)
            while stream.hasBytesAvailable {
                let read = stream.read(&buffer, maxLength: buffer.count)
                guard read > 0 else { break }
                body.append(buffer, count: read)
            }
            stream.close()
        }
        let json = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] ?? [:]
        let path = request.url?.path ?? ""
        let (status, reply) = Self.lock.withLock { () -> (Int, [String: Any]) in
            Self.requests.append(Request(path: path, json: json))
            if path == "/api/collectors" {
                let collector: [String: Any] = [
                    "deviceId": json["deviceId"] ?? "", "platform": "macos", "name": json["name"] ?? "",
                    "sources": json["sources"] ?? [], "activeSources": Self.activeSources,
                ]
                return (200, ["collector": collector])
            }
            Self.uploadCount += 1
            if Self.uploadCount == Self.failingUpload { return (500, ["error": "Try again"]) }
            let active = Set(Self.activeSources)
            let upserts = json["upserts"] as? [[String: Any]] ?? []
            let stored = upserts.filter { active.contains($0["source"] as? String ?? "") }.count
            var result: [String: Any] = [
                "stored": stored, "removed": (json["removals"] as? [Any])?.count ?? 0,
                "vectors": (json["vectors"] as? [Any])?.count ?? 0, "skipped": upserts.count - stored,
            ]
            result["cursor"] = json["cursor"]
            return (200, result)
        }
        let response = HTTPURLResponse(
            url: request.url!, statusCode: status, httpVersion: nil,
            headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: try! JSONSerialization.data(withJSONObject: reply))
        client?.urlProtocolDidFinishLoading(self)
    }
}

@Suite(.serialized) struct MacDataUploadTests {
    let now = Date(timeIntervalSince1970: 1_790_000_000)

    private func makeEngine(path: String? = nil, account: String = "user-a") throws -> MacDataEngine {
        // A sign-in token whose subject is `account`.
        let claims = Data(#"{"sub":"\#(account)"}"#.utf8).base64EncodedString()
            .replacingOccurrences(of: "=", with: "")
        let token = "header.\(claims).signature"
        let client = DeviceDataClient(
            session: StubServer.session(), baseURL: { "https://api.example.test" }, token: { token })
        return MacDataEngine(
            storePath: try path ?? tempDirectory().appendingPathComponent("store.sqlite").path,
            client: client, deviceName: { "Test Mac" }, retriesUploads: false)
    }

    private func upsertIds(_ uploads: [[String: Any]]) -> [String] {
        uploads.flatMap { ($0["upserts"] as? [[String: Any]] ?? []).compactMap { $0["id"] as? String } }
    }

    @Test func anotherAccountOrARemovedDeviceGetsEverythingAgain() async throws {
        StubServer.reset()
        let path = try tempDirectory().appendingPathComponent("store.sqlite").path
        let first = try makeEngine(path: path, account: "user-a")
        let store = try await first.store()
        let t = now.timeIntervalSince1970
        try store.enable(.imessage)
        try store.apply(
            readResult([makeItem("imessage:1", .imessage, at: t - 60), makeItem("imessage:2", .imessage, at: t - 30)]),
            source: .imessage, now: now)
        #expect(await first.uploadPending(now: now))
        #expect(Set(upsertIds(StubServer.uploads())) == ["imessage:1", "imessage:2"])

        // Same Mac, signed in as someone else: their account has none of it yet.
        StubServer.reset()
        let second = try makeEngine(path: path, account: "user-b")
        #expect(await second.uploadPending(now: now))
        #expect(Set(upsertIds(StubServer.uploads())) == ["imessage:1", "imessage:2"])

        // Removed in Settings → Devices (the server answers 404): start over too.
        StubServer.reset()
        try await second.forgetUploads()
        #expect(await second.uploadPending(now: now))
        #expect(Set(upsertIds(StubServer.uploads())) == ["imessage:1", "imessage:2"])
        let removals = StubServer.uploads().compactMap { $0["removals"] as? [String] }.flatMap { $0 }
        #expect(removals.isEmpty)
    }

    @Test func uploadsChangedItemsOnceWithRemovalsAndVectors() async throws {
        StubServer.reset()
        let engine = try makeEngine()
        let store = try await engine.store()
        let t = now.timeIntervalSince1970
        for source in [MacDataSource.imessage, .mail, .calendar] { try store.enable(source) }
        try store.apply(
            readResult([makeItem("imessage:1", .imessage, at: t - 60), makeItem("imessage:2", .imessage, at: t - 30)]),
            source: .imessage, now: now)
        try store.apply(readResult([makeItem("mail:1", .mail, at: t - 10)]), source: .mail, now: now)
        try store.apply(
            readResult([makeItem("calendar:1", .calendar, at: t + 3600, end: t + 7200)]), source: .calendar, now: now)

        // First pass: registers, then uploads only the sources the server takes from this Mac.
        #expect(await engine.uploadPending(now: now))
        let registration = try #require(StubServer.registrations().first)
        #expect(registration["name"] as? String == "Test Mac")
        #expect(registration["platform"] as? String == "macos")
        #expect(registration["sources"] as? [String] == ["calendar", "imessage", "mail"])
        #expect(upsertIds(StubServer.uploads()) == ["calendar:1", "imessage:2", "imessage:1"])  // newest first, no mail
        let uploaded = try #require((StubServer.uploads().first?["upserts"] as? [[String: Any]])?.first)
        #expect(uploaded["source"] as? String == "calendar")
        #expect(uploaded["endAt"] as? Double == t + 7200)
        #expect(uploaded["participants"] as? [String] == [])
        #expect(try store.pendingUploadCount(sources: [.imessage, .calendar]) == 0)
        #expect(try await engine.uploadStatus().activeSources == [.calendar, .imessage])
        #expect(try await engine.uploadStatus().lastUploadAt == t)

        // Nothing changed: nothing is sent, and registration isn't repeated.
        let before = StubServer.requestCount
        #expect(await engine.uploadPending(now: now))
        #expect(StubServer.requestCount == before)

        // One message edited, one deleted: only those go up.
        StubServer.reset()
        try store.apply(
            readResult([makeItem("imessage:1", .imessage, at: t - 60, revision: "2")], removed: ["imessage:2"]),
            source: .imessage, now: now)
        #expect(await engine.uploadPending(now: now))
        #expect(upsertIds(StubServer.uploads()) == ["imessage:1"])
        let removals = StubServer.uploads().filter { ($0["removals"] as? [String])?.isEmpty == false }
        #expect(removals.count == 1)
        #expect(removals.first?["removals"] as? [String] == ["imessage:2"])
        #expect(removals.first?["cursor"] as? String == String(try store.latestChangeSeq()))
        #expect(StubServer.registrations().isEmpty)

        // Embedded since the last upload: vectors follow, once.
        StubServer.reset()
        let vectors: [[Float]] = [[0.6, 0.8, 0], [0, 0, 1]]
        try store.saveEmbedding(itemId: "imessage:1", revision: "2", vectors: vectors)
        try store.saveEmbedding(itemId: "mail:1", revision: "1", vectors: vectors)  // mail isn't active
        #expect(await engine.uploadPending(now: now))
        let sent = StubServer.uploads().flatMap { $0["vectors"] as? [[String: Any]] ?? [] }
        #expect(sent.count == 1)
        let entry = try #require(sent.first)
        #expect(entry["id"] as? String == "imessage:1")
        #expect(entry["revision"] as? String == "2")
        #expect(entry["dimensions"] as? Int == 3)
        let data = try #require(Data(base64Encoded: entry["vectors"] as? String ?? ""))
        #expect(DeviceEmbedding.decode(data) == vectors.flatMap { $0 })

        StubServer.reset()
        #expect(await engine.uploadPending(now: now))
        #expect(StubServer.uploads().isEmpty)
    }

    @Test func failedUploadResumesAfterRelaunch() async throws {
        // The second batch fails: the first stays uploaded, the rest waits.
        StubServer.reset(failingUpload: 2)
        let path = try tempDirectory().appendingPathComponent("store.sqlite").path
        let engine = try makeEngine(path: path)
        let store = try await engine.store()
        let t = now.timeIntervalSince1970
        try store.enable(.imessage)
        try store.apply(
            readResult((1...250).map { makeItem("imessage:\($0)", .imessage, at: t - Double($0)) }),
            source: .imessage, now: now)
        #expect(await engine.uploadPending(now: now) == false)
        let rest = 250 - DeviceDataClient.maxUpserts
        #expect(try store.pendingUploadCount(sources: [.imessage]) == rest)
        #expect(try await engine.uploadStatus().error != nil)

        // A new engine over the same store, as after a relaunch, sends only the rest.
        StubServer.reset()
        let relaunched = try makeEngine(path: path)
        #expect(await relaunched.uploadPending(now: now))
        #expect(upsertIds(StubServer.uploads()).count == rest)
        #expect(StubServer.registrations().count == 1)  // a new launch registers again
        #expect(try await relaunched.uploadStatus().error == nil)
    }

    @Test func sourceTakenByAnotherDeviceUploadsAgainWhenItComesBack() async throws {
        StubServer.reset()
        let engine = try makeEngine()
        let store = try await engine.store()
        try store.enable(.calendar)
        try store.apply(
            readResult([makeItem("calendar:1", .calendar, at: now.timeIntervalSince1970 + 60)]),
            source: .calendar, now: now)
        #expect(await engine.uploadPending(now: now))
        #expect(upsertIds(StubServer.uploads()) == ["calendar:1"])

        // The iPhone now collects calendar, and the server dropped this Mac's copy.
        StubServer.reset(activeSources: ["imessage"])
        await engine.registrationChanged()
        #expect(await engine.uploadPending(now: now))
        #expect(StubServer.uploads().isEmpty)
        #expect(try await engine.statuses().first { $0.source == .calendar }?.uploadActive == false)

        StubServer.reset()
        await engine.registrationChanged()
        #expect(await engine.uploadPending(now: now))
        #expect(upsertIds(StubServer.uploads()) == ["calendar:1"])
    }

    @Test func disablingASourceDropsItsLocalCopy() async throws {
        StubServer.reset()
        let engine = try makeEngine()
        let store = try await engine.store()
        try store.enable(.mail)
        try store.apply(
            readResult([makeItem("mail:1", .mail, at: now.timeIntervalSince1970)]), source: .mail, now: now)
        #expect(try await engine.disable(.mail))
        #expect(try store.itemCount(.mail) == 0)
        #expect(try await engine.enabledSources().isEmpty)
        #expect(try await engine.disable(.mail) == false)
    }
}

// MARK: - Contacts

@Suite struct ContactsTests {
    let readAt = Date(timeIntervalSince1970: 1_790_000_000)

    private func julia() -> CNMutableContact {
        let contact = CNMutableContact()
        contact.givenName = "Julia"
        contact.familyName = "Lawrence"
        contact.nickname = "Jules"
        contact.organizationName = "Albany Med"
        contact.jobTitle = "Nurse"
        contact.phoneNumbers = [CNLabeledValue(label: CNLabelPhoneNumberMobile, value: CNPhoneNumber(stringValue: "+1 (518) 555-0100"))]
        contact.emailAddresses = [CNLabeledValue(label: CNLabelHome, value: "Julia@Example.com" as NSString)]
        let address = CNMutablePostalAddress()
        address.street = "1 Main St"
        address.city = "Albany"
        address.state = "NY"
        address.postalCode = "12207"
        address.country = "USA"
        contact.postalAddresses = [CNLabeledValue(label: CNLabelHome, value: address)]
        contact.birthday = DateComponents(year: 1985, month: 4, day: 9)
        contact.contactRelations = [
            CNLabeledValue(label: CNLabelContactRelationSpouse, value: CNContactRelation(name: "Zubair")),
            CNLabeledValue(label: CNLabelContactRelationDaughter, value: CNContactRelation(name: "Emma")),
        ]
        contact.note = "Private note"
        return contact
    }

    @Test func mapsACardToAnItem() throws {
        let contact = julia()
        let item = ContactsReader.item(from: contact, isMe: false, readAt: readAt)
        #expect(item.id == "contacts:\(contact.identifier)")
        #expect(item.source == .contacts)
        #expect(item.title == "Julia Lawrence")
        #expect(item.occurredAt == readAt.timeIntervalSince1970)
        #expect(item.participants == ["+1 (518) 555-0100", "Julia@Example.com"])
        #expect(item.body.hasPrefix("Julia Lawrence (Jules)\nNurse, Albany Med\n"))
        #expect(item.body.contains("Phone (mobile): +1 (518) 555-0100"))
        #expect(item.body.contains("Email (home): Julia@Example.com"))
        #expect(item.body.contains("Address (home): 1 Main St, Albany NY 12207"))
        #expect(item.body.contains("Birthday: 1985-04-09"))
        #expect(item.body.contains("Spouse: Zubair"))
        #expect(item.body.contains("Daughter: Emma"))
        #expect(!item.body.contains("Private note"))

        let extra = try #require(item.extra)
        #expect(extra["birthday"] == .string("1985-04-09"))
        #expect(extra["organization"] == .string("Albany Med"))
        #expect(extra["jobTitle"] == .string("Nurse"))
        #expect(extra["isMe"] == .bool(false))
        #expect(extra["phones"] == .array([.object(["label": .string("mobile"), "value": .string("+1 (518) 555-0100")])]))
        #expect(extra["emails"] == .array([.object(["label": .string("home"), "value": .string("Julia@Example.com")])]))
        #expect(
            extra["relations"]
                == .array([
                    .object(["label": .string("spouse"), "name": .string("Zubair")]),
                    .object(["label": .string("daughter"), "name": .string("Emma")]),
                ]))
        guard case .array(let addresses) = extra["addresses"], case .object(let home) = addresses.first else {
            Issue.record("No address")
            return
        }
        #expect(home["city"] == .string("Albany"))
        #expect(home["label"] == .string("home"))

        // Reading again later doesn't change the revision, so it isn't uploaded again.
        let later = ContactsReader.item(from: contact, isMe: false, readAt: readAt.addingTimeInterval(3600))
        #expect(later.revision == item.revision)
        // The DeviceItem keeps the extra fields for the server.
        #expect(item.deviceItem.extra == item.extra)
        #expect(item.deviceItem.source == .contacts)
    }

    @Test func marksTheMeCardAndHandlesMissingFields() {
        let contact = CNMutableContact()
        contact.organizationName = "UPS Store"
        contact.birthday = DateComponents(month: 12, day: 25)
        let item = ContactsReader.item(from: contact, isMe: true, readAt: readAt)
        #expect(item.title == "UPS Store")
        #expect(item.extra?["isMe"] == .bool(true))
        #expect(item.extra?["birthday"] == .string("--12-25"))
        #expect(item.body.contains("This is me"))
        #expect(item.participants.isEmpty)
    }
}

// MARK: - Sender names

@Suite struct SenderNameTests {
    let now = Date(timeIntervalSince1970: 1_790_000_000)

    private func names() -> MacDataContactNames {
        let julia = CNMutableContact()
        julia.givenName = "Julia"
        julia.phoneNumbers = [CNLabeledValue(label: nil, value: CNPhoneNumber(stringValue: "(518) 555-0100"))]
        let coach = CNMutableContact()
        coach.givenName = "Coach"
        coach.familyName = "Dan"
        coach.emailAddresses = [CNLabeledValue(label: nil, value: "Coach@Example.com" as NSString)]
        return MacDataContactNames(contacts: [
            ContactsReader.item(from: julia, isMe: false, readAt: now),
            ContactsReader.item(from: coach, isMe: false, readAt: now),
        ])
    }

    @Test func matchesNormalizedPhonesAndEmailsIgnoringCase() {
        let names = names()
        #expect(names.name(for: "+15185550100") == "Julia")
        #expect(names.name(for: "518.555.0100") == "Julia")
        #expect(names.name(for: "coach@example.com") == "Coach Dan")
        #expect(names.name(for: "mailto:COACH@example.com") == "Coach Dan")
        #expect(names.name(for: "+15185550199") == nil)
        #expect(names.name(for: "12345") == nil)  // short codes don't match anything
        #expect(MacDataContactNames.key("+44 20 7946 0958") == "+442079460958")
        #expect(MacDataContactNames.key("+44 20 7946 0958") != MacDataContactNames.key("+1 207 946 0958"))
    }

    @Test func doesNotGuessWhichPersonUsesASharedNumber() {
        let alice = CNMutableContact()
        alice.givenName = "Alice"
        alice.phoneNumbers = [CNLabeledValue(label: nil, value: CNPhoneNumber(stringValue: "+15185550123"))]
        let bob = CNMutableContact()
        bob.givenName = "Bob"
        bob.phoneNumbers = alice.phoneNumbers
        let names = MacDataContactNames(contacts: [
            ContactsReader.item(from: alice, isMe: false, readAt: now),
            ContactsReader.item(from: bob, isMe: false, readAt: now),
        ])
        #expect(names.name(for: "+15185550123") == nil)
    }

    @Test func iMessageAndMailShowContactNames() throws {
        // iMessage: handle 2 is coach@example.com, the chat has a name.
        let chat = try tempDirectory().appendingPathComponent("chat.db")
        let db = try MacDataSQLite(path: chat.path, readOnly: false)
        try db.execute("CREATE TABLE handle(ROWID INTEGER PRIMARY KEY, id TEXT)")
        try db.execute("CREATE TABLE chat(ROWID INTEGER PRIMARY KEY, chat_identifier TEXT, display_name TEXT)")
        try db.execute("CREATE TABLE chat_message_join(chat_id INTEGER, message_id INTEGER)")
        try db.execute("CREATE TABLE chat_handle_join(chat_id INTEGER, handle_id INTEGER)")
        try db.execute(
            "CREATE TABLE message(ROWID INTEGER PRIMARY KEY, guid TEXT, text TEXT, date INTEGER, is_from_me INTEGER, handle_id INTEGER)")
        try db.execute("INSERT INTO handle VALUES (1, '+15185550100'), (2, 'coach@example.com')")
        try db.execute("INSERT INTO chat VALUES (1, 'chat1', '')")
        try db.execute("INSERT INTO chat_handle_join VALUES (1, 1), (1, 2)")
        try db.execute(
            "INSERT INTO message VALUES (1, 'g1', 'Practice moved', ?, 0, 2)", [IMessageReader.appleNanos(now)])
        try db.execute("INSERT INTO chat_message_join VALUES (1, 1)")

        let item = try #require(
            IMessageReader(databaseURL: chat).read(checkpoint: nil, now: now, names: names()).items.first)
        #expect(item.sender == "Coach Dan")
        #expect(item.extra?["senderHandle"] == .string("coach@example.com"))
        #expect(item.thread == "Julia, Coach Dan")
        #expect(item.participants == ["+15185550100", "coach@example.com"])  // raw handles stay

        // Mail: the contact's name replaces the header's.
        let root = try tempDirectory()
        let data = root.appendingPathComponent("V10/MailData", isDirectory: true)
        try FileManager.default.createDirectory(at: data, withIntermediateDirectories: true)
        let mail = try MacDataSQLite(path: data.appendingPathComponent("Envelope Index").path, readOnly: false)
        try mail.execute("CREATE TABLE addresses(ROWID INTEGER PRIMARY KEY, address TEXT, comment TEXT)")
        try mail.execute("CREATE TABLE subjects(ROWID INTEGER PRIMARY KEY, subject TEXT)")
        try mail.execute("CREATE TABLE summaries(ROWID INTEGER PRIMARY KEY, summary TEXT)")
        try mail.execute("CREATE TABLE mailboxes(ROWID INTEGER PRIMARY KEY, url TEXT)")
        try mail.execute(
            "CREATE TABLE messages(ROWID INTEGER PRIMARY KEY, sender INTEGER, subject INTEGER, summary INTEGER, date_received INTEGER, mailbox INTEGER, read INTEGER, deleted INTEGER)")
        try mail.execute("INSERT INTO addresses VALUES (1, 'coach@example.com', 'D. Smith'), (2, 'other@example.com', 'Other')")
        try mail.execute("INSERT INTO subjects VALUES (1, 'Practice')")
        try mail.execute("INSERT INTO summaries VALUES (1, 'Moved to 5')")
        try mail.execute("INSERT INTO mailboxes VALUES (1, 'imap://abc/INBOX')")
        try mail.execute("INSERT INTO messages VALUES (1, 1, 1, 1, ?, 1, 0, 0), (2, 2, 1, 1, ?, 1, 0, 0)", [Int(now.timeIntervalSince1970), Int(now.timeIntervalSince1970)])
        let emails = try MailReader(mailRoot: root).read(checkpoint: nil, now: now, names: names()).items
        #expect(emails.map(\.sender) == ["Coach Dan <coach@example.com>", "Other <other@example.com>"])
    }
}

// MARK: - Retention

@Suite struct MacDataRetentionTests {
    let now = Date(timeIntervalSince1970: 1_790_000_000)

    @Test func prunesOldItemsButKeepsContactsAndEventsThatHaventEnded() throws {
        let store = try MacDataStore(path: tempDirectory().appendingPathComponent("store.sqlite").path)
        let t = now.timeIntervalSince1970
        let day = 86_400.0
        for source in MacDataSource.allCases { try store.enable(source) }
        try store.apply(
            readResult([makeItem("imessage:old", .imessage, at: t - 31 * day), makeItem("imessage:new", .imessage, at: t - 29 * day)]),
            source: .imessage, now: now)
        try store.apply(readResult([makeItem("mail:old", .mail, at: t - 45 * day)]), source: .mail, now: now)
        try store.apply(
            readResult([
                makeItem("calendar:ended", .calendar, at: t - 40 * day, end: t - 40 * day + 3600),
                // A trip that started long ago and ends next week is still on.
                makeItem("calendar:ongoing", .calendar, at: t - 40 * day, end: t + 7 * day),
            ]),
            source: .calendar, now: now)
        try store.apply(readResult([makeItem("contacts:old", .contacts, at: t - 400 * day)]), source: .contacts, now: now)
        try store.saveEmbedding(itemId: "imessage:old", revision: "1", vectors: [[1, 0]])

        #expect(try store.pruneExpired(now: now) == 3)
        let left = try MacDataSource.allCases.flatMap { try store.items(source: $0).map(\.id) }
        #expect(Set(left) == ["imessage:new", "calendar:ongoing", "contacts:old"])
        #expect(try store.vectors(itemId: "imessage:old").isEmpty)
        // Pruning isn't a deletion to upload: the server applies the same rule itself.
        #expect(try store.changes(after: 0, limit: 100).allSatisfy { $0.kind != "removed" })
        #expect(try store.pruneExpired(now: now) == 0)
    }
}

// MARK: - Relay

@Suite struct MacDataRelayTests {
    @Test func answersEmbedWithANormalizedVector() async throws {
        let answer = try await MacDataConnection.answer("embed", ["text": "when does lacrosse practice start"])
        if DeviceEmbedding.isAvailable {
            let vector = try #require(answer as? [Double])
            #expect(vector.count == DeviceEmbedding.dimensions)
            let norm = vector.reduce(0) { $0 + $1 * $1 }.squareRoot()
            #expect(abs(norm - 1) < 0.001)
        } else {
            #expect(answer is NSNull)
        }
        #expect(try await MacDataConnection.answer("embed", ["text": "   "]) is NSNull)
        #expect(try await MacDataConnection.answer("embed", [:]) is NSNull)
        await #expect(throws: (any Error).self) { try await MacDataConnection.answer("search", [:]) }
    }

    @Test func heartbeatInfoStillMatchesTheServerSchema() async throws {
        let engine = MacDataEngine(storePath: try tempDirectory().appendingPathComponent("store.sqlite").path)
        let info = try await engine.hostInfo()
        let json = try #require(
            try JSONSerialization.jsonObject(with: JSONEncoder().encode(info)) as? [String: Any])
        #expect(Set(json.keys) == ["timeZone", "now", "notebooks", "pendingEmbeddings"])
        #expect((json["notebooks"] as? [Any])?.isEmpty == true)
        #expect(json["pendingEmbeddings"] as? Int == 0)
    }
}
#endif
