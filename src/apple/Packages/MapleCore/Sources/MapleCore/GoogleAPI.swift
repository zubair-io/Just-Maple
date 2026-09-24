import Foundation

public struct GoogleCalendarChoice: Codable, Sendable {
    public let id: String
    public let name: String
    public let timeZone: String
}

/// Google API transport never forwards a bearer token through a redirect.
public final class GoogleTransport: NSObject, URLSessionTaskDelegate, Sendable {
    public func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                           newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
    public static func session() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 120
        return URLSession(configuration: config, delegate: GoogleTransport(), delegateQueue: nil)
    }
}

public struct GoogleHTTPTransport: HTTPTransport {
    public init() {}
    public func send(_ request: URLRequest) async throws -> (Data, Int) {
        let session = GoogleTransport.session(); defer { session.finishTasksAndInvalidate() }
        let (data, response) = try await session.data(for: request)
        return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
    }
}

public struct GoogleAPI: Sendable {
    let token: String
    let transport: any HTTPTransport
    public init(token: String, transport: any HTTPTransport = GoogleHTTPTransport()) { self.token = token; self.transport = transport }
    func get<T: Decodable>(_ path: String, query: [URLQueryItem] = [], peopleAPI: Bool = false) async throws -> T {
        var url = URLComponents(string: (peopleAPI ? "https://people.googleapis.com" : "https://www.googleapis.com") + path)!
        url.queryItems = query.isEmpty ? nil : query
        var request = URLRequest(url: url.url!)
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        let (data, status) = try await transport.send(request)
        guard status == 200 else {
            switch status {
            case 401: throw MapleError.provider("Google access expired or was revoked. Reconnect Google.")
            case 403:
                let reason=(try? JSONDecoder().decode(GoogleFailure.self,from:data))?.error.errors?.first?.reason ?? "unknown"
                if ["rateLimitExceeded","userRateLimitExceeded","dailyLimitExceeded","quotaExceeded"].contains(reason) {throw MapleError.provider("Google quota/rate limit reached (\(reason)). Retry after the quota resets.")}
                let service=peopleAPI ? "People":"Gmail/Calendar"
                let known=["accessNotConfigured","insufficientPermissions","forbidden","domainPolicy","authError"].contains(reason) ? reason:"unknown"
                throw MapleError.provider("Google denied \(service) access (\(known)). Check this API and the granted scopes in your Google Cloud project.")
            case 429: throw MapleError.provider("Google rate limit reached. Try importing again later.")
            default: throw MapleError.provider("Google request failed (HTTP \(status)). Try again later.")
            }
        }
        guard data.count <= 10_000_000 else { throw MapleError.provider("Google response exceeds the import limit.") }
        return try JSONDecoder().decode(T.self, from: data)
    }
    public func email() async throws -> String {
        struct Profile: Decodable { let emailAddress: String }
        let profile: Profile = try await get("/gmail/v1/users/me/profile")
        guard profile.emailAddress.contains("@") else { throw MapleError.provider("Google returned no account email.") }
        return profile.emailAddress.lowercased()
    }
    public func calendars() async throws -> [GoogleCalendarChoice] {
        struct Item: Decodable { let id: String; let summary: String?; let timeZone: String?; let deleted: Bool? }
        struct Page: Decodable { let items: [Item]?; let nextPageToken: String? }
        var result: [GoogleCalendarChoice] = [], page: String?
        var seen = Set<String>()
        repeat {
            var query = [URLQueryItem(name: "maxResults", value: "250")]
            if let page { query.append(URLQueryItem(name: "pageToken", value: page)) }
            let response: Page = try await get("/calendar/v3/users/me/calendarList", query: query)
            result += (response.items ?? []).filter { $0.deleted != true }.map { GoogleCalendarChoice(id: $0.id, name: $0.summary ?? $0.id, timeZone: $0.timeZone ?? "UTC") }
            guard result.count <= 1000 else { throw MapleError.provider("Google calendar list exceeds 1,000 calendars.") }
            page = response.nextPageToken
            if let page, !seen.insert(page).inserted { throw MapleError.provider("Google repeated a calendar page. Try again.") }
        } while page != nil
        return result.sorted { ($0.name, $0.id) < ($1.name, $1.id) }
    }
    public static func scope(account: String, calendar: String) -> String { ConnectorSourceRecord.identifier(account) + ":" + calendar }
    public func calendarRecords(account: String, choices: [GoogleCalendarChoice], start: Date, end: Date) async throws -> [ConnectorSourceRecord] {
        struct Page: Decodable { let items: [GoogleCalendarEvent]?; let nextPageToken: String? }
        var records: [ConnectorSourceRecord] = []
        let iso = ISO8601DateFormatter()
        for calendar in choices {
            var page: String?
            var seen = Set<String>()
            repeat {
                var query = [URLQueryItem(name: "timeMin", value: iso.string(from: start)), URLQueryItem(name: "timeMax", value: iso.string(from: end)),
                    URLQueryItem(name: "singleEvents", value: "true"), URLQueryItem(name: "showDeleted", value: "false"), URLQueryItem(name: "maxResults", value: "2500")]
                if let page { query.append(URLQueryItem(name: "pageToken", value: page)) }
                let id = calendar.id.addingPercentEncoding(withAllowedCharacters: .alphanumerics)!
                let response: Page = try await get("/calendar/v3/calendars/\(id)/events", query: query)
                for event in response.items ?? [] where event.status != "cancelled" {
                    records.append(try event.record(account: account, calendar: calendar))
                }
                guard records.count <= 10000 else { throw MapleError.provider("Google Calendar exceeds 10,000 events. No partial snapshot was saved.") }
                page = response.nextPageToken
                if let page, !seen.insert(page).inserted { throw MapleError.provider("Google repeated an event page. No partial snapshot was saved.") }
            } while page != nil
        }
        return records
    }
    public func recentMail(account:String, query:String = "newer_than:30d -in:spam -in:trash -in:drafts", limit:Int = 100) async throws -> [Event] {
        guard (1...1000).contains(limit),query.utf8.count<=1000 else {throw MapleError.invalid("Invalid Gmail history range.")}
        struct Reference:Decodable {let id:String}
        struct Page:Decodable {let messages:[Reference]?;let nextPageToken:String?}
        var events:[Event]=[],token:String?,seen=Set<String>(),tokens=Set<String>()
        repeat {
            var parameters=[URLQueryItem(name:"maxResults",value:String(min(100,limit-events.count))),URLQueryItem(name:"q",value:query)]
            if let token {parameters.append(URLQueryItem(name:"pageToken",value:token))}
            let page:Page=try await get("/gmail/v1/users/me/messages",query:parameters)
            for reference in page.messages ?? [] where !seen.contains(reference.id) && events.count<limit {
                seen.insert(reference.id)
                let id=reference.id.addingPercentEncoding(withAllowedCharacters:.alphanumerics)!
                let message:GoogleMailMessage=try await get("/gmail/v1/users/me/messages/\(id)",query:[URLQueryItem(name:"format",value:"full")])
                events.append(try message.event(account:account))
            }
            token=page.nextPageToken
            if let token,!tokens.insert(token).inserted {throw MapleError.invalid("Gmail repeated its pagination cursor.")}
        } while token != nil && events.count<limit
        return events
    }

}

struct GoogleCalendarEvent: Decodable {
    struct Moment: Decodable {
        let dateTime: String?; let date: String?; let timeZone: String?
        func instant(fallbackZone: String) throws -> Date {
            if let dateTime {
                let iso = ISO8601DateFormatter()
                if let result = iso.date(from: dateTime) { return result }
                iso.formatOptions.insert(.withFractionalSeconds)
                if let result = iso.date(from: dateTime) { return result }
            }
            if let date {
                let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX")
                formatter.calendar = Calendar(identifier: .gregorian); formatter.timeZone = TimeZone(identifier: timeZone ?? fallbackZone)
                formatter.dateFormat = "yyyy-MM-dd"; formatter.isLenient = false
                if let result = formatter.date(from: date) { return result }
            }
            throw MapleError.provider("Google Calendar returned an invalid event date.")
        }
    }
    struct Attendee: Decodable { let email: String?; let displayName: String?; let responseStatus: String? }
    let id: String; let summary: String?; let description: String?; let location: String?; let status: String?
    let start: Moment?; let end: Moment?; let attendees: [Attendee]?
    func record(account: String, calendar: GoogleCalendarChoice) throws -> ConnectorSourceRecord {
        guard let start, let end else { throw MapleError.provider("Google event is missing its dates.") }
        let begins = try start.instant(fallbackZone: calendar.timeZone), ends = try end.instant(fallbackZone: calendar.timeZone)
        let iso = ISO8601DateFormatter(), name = summary ?? "Untitled event"
        let guests = (attendees ?? []).map { "\($0.displayName ?? "") <\($0.email ?? "")> (\($0.responseStatus ?? "unknown"))" }.sorted().joined(separator: ", ")
        let content = "Google Calendar source record\nTitle: \(name)\nCalendar: \(calendar.name)\nStart: \(iso.string(from: begins))\nEnd: \(iso.string(from: ends))\nAll day: \(start.date != nil)\nTime zone: \(calendar.timeZone)\nStatus: \(status ?? "unknown")\nLocation: \(location ?? "")\nAttendees: \(guests)\nNotes: \(description ?? "")"
        return ConnectorSourceRecord(id: ConnectorSourceRecord.identifier(account + "|" + calendar.id + "|" + id), name: name, content: content,
            start: begins, end: ends, scopeID: GoogleAPI.scope(account: account, calendar: calendar.id))
    }
}

struct GoogleMailMessage: Decodable {
    struct Part: Decodable {
        struct Header: Decodable { let name: String; let value: String }
        struct Body: Decodable { let data: String? }
        let mimeType: String?; let filename: String?; let headers: [Header]?; let body: Body?; let parts: [Part]?
        func plainText(depth: Int = 0, htmlFallback:Bool = false) -> String {
            guard depth < 20, (filename ?? "").isEmpty else { return "" }
            if (mimeType == "text/plain" || (htmlFallback && mimeType == "text/html")), let encoded = body?.data {
                var value = encoded.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
                value += String(repeating: "=", count: (4 - value.count % 4) % 4)
                return Data(base64Encoded: value).map { String(decoding: $0, as: UTF8.self) } ?? ""
            }
            return (parts ?? []).map { $0.plainText(depth: depth + 1,htmlFallback:htmlFallback) }.filter { !$0.isEmpty }.joined(separator: "\n")
        }
    }
    let id: String; let threadId: String; let internalDate: String; let snippet: String?; let labelIds:[String]?; let payload: Part
    func event(account: String) throws -> Event {
        func header(_ name: String) -> String { payload.headers?.first { $0.name.lowercased() == name.lowercased() }?.value ?? "" }
        guard let milliseconds = Double(internalDate), milliseconds.isFinite else { throw MapleError.provider("Gmail returned an invalid message date.") }
        let sender = header("From"), address = Self.address(sender)
        // Sender addresses can be shared by automated delivery or spoofed. Gmail's
        // per-message SENT label is the mailbox evidence of outgoing direction.
        let outgoing = labelIds?.contains("SENT") == true
        let plain = payload.plainText()
        let fallback=plain.isEmpty ? payload.plainText(htmlFallback:true) : plain
        let body = String(MailText.visible(fallback.isEmpty ? snippet ?? "" : fallback).prefix(40000))
        let content = "Gmail message\nDirection: \(outgoing ? "outgoing" : "incoming")\nSender: \(sender)\nTo: \(header("To"))\nSubject: \(header("Subject"))\nBody\(fallback.isEmpty ? " (snippet only)" : ""):\n\(body)"
        var subjects = ["person:self", "thread:gmail:" + ConnectorSourceRecord.identifier(account + "|" + threadId)]
        if !outgoing, let address { subjects.append("person:email:" + ConnectorSourceRecord.identifier(address)) }
        return Event(type: outgoing ? "message.sent" : "message.received", source: Source(connector: "gmail", account: account, externalID: id,
            revision: ConnectorSourceRecord.identifier(content)), occurredAt: Date(timeIntervalSince1970: milliseconds / 1000), subjects: subjects, content: content)
    }
    static func address(_ sender: String) -> String? {
        let value: String
        if let start = sender.lastIndex(of: "<"), let end = sender.lastIndex(of: ">"), start < end { value = String(sender[sender.index(after: start)..<end]) }
        else { value = sender }
        let clean = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return clean.contains("@") && !clean.contains(" ") ? clean : nil
    }
}

extension KnowledgeStore {
    /// Commit the bounded mail batch only after all requested message fetches succeed.
    public func ingestGoogleMail(_ events: [Event]) throws -> Int {
        guard events.count <= 1000, events.allSatisfy({ $0.source.connector == "gmail" }) else { throw MapleError.invalid("Invalid Gmail batch.") }
        return try db.transaction {
            let before = try eventCount()
            for event in events { try event.validate(); _ = try insert(event, enqueue: true) }
            return try eventCount() - before
        }
    }
}

private struct GoogleFailure:Decodable {struct Detail:Decodable {struct Item:Decodable {let reason:String};let errors:[Item]?};let error:Detail}
