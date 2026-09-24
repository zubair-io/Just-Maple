import Foundation
import Testing
@testable import MapleCore

struct GoogleConnectorTests {
    func mail(id: String = "m1", sender: String = "Alex <alex@example.test>") throws -> GoogleMailMessage {
        let json: [String: Any] = ["id": id, "threadId": "thread1", "internalDate": "1700000000000", "snippet": "preview", "payload": [
            "mimeType": "multipart/alternative", "headers": [["name": "From", "value": sender], ["name": "Subject", "value": "Alpine"]],
            "parts": [["mimeType": "text/plain", "body": ["data": Data("Can we meet tomorrow?".utf8).base64EncodedString()]],
                      ["mimeType": "text/html", "body": ["data": Data("<script>unsafe</script>".utf8).base64EncodedString()]]]]]
        return try JSONDecoder().decode(GoogleMailMessage.self, from: JSONSerialization.data(withJSONObject: json))
    }
    @Test func gmailIdentityBodyAndAtomicDeduplication() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let event = try mail().event(account: "owner@example.test")
        #expect(event.type == "message.received")
        #expect(event.content.contains("Can we meet tomorrow?"))
        #expect(!event.content.contains("<script>"))
        #expect(event.subjects.contains("person:email:" + ConnectorSourceRecord.identifier("alex@example.test")))
        #expect(try await store.ingestGoogleMail([event]) == 1)
        #expect(try await store.ingestGoogleMail([mail().event(account: "owner@example.test")]) == 0)
        #expect(try await store.queue().count == 1)
        let own = try mail(sender: "Owner <owner@example.test>").event(account: "owner@example.test")
        #expect(own.type == "message.sent")
        #expect(own.subjects.filter { $0.hasPrefix("person:") } == ["person:self"])
        let differentAccount = try mail().event(account: "second@example.test")
        #expect(differentAccount.subjects[1] != event.subjects[1])
        let invalid = Event(type: "mail", source: Source(connector: "gmail", account: "owner", externalID: "bad", revision: "1"), occurredAt: Date(), subjects: [], content: "bad")
        do { _ = try await store.ingestGoogleMail([mail(id: "m2").event(account: "owner@example.test"), invalid]); Issue.record("Accepted invalid batch") } catch {}
        #expect(try await store.eventCount() == 1)
    }
    @Test func calendarAllDayTimezoneStableIdentityAndScopes() async throws {
        let data = Data(#"{"id":"recurring_occurrence","summary":"Trip","status":"confirmed","start":{"date":"2026-09-22"},"end":{"date":"2026-09-23"}}"#.utf8)
        let event = try JSONDecoder().decode(GoogleCalendarEvent.self, from: data)
        let choice = GoogleCalendarChoice(id: "work@example.test", name: "Work", timeZone: "America/New_York")
        let record = try event.record(account: "owner@example.test", calendar: choice)
        #expect(record.start == ISO8601DateFormatter().date(from: "2026-09-22T04:00:00Z"))
        #expect(record.end!.timeIntervalSince(record.start!) == 86400)
        #expect(record.id != (try event.record(account: "other@example.test", calendar: choice)).id)
        let store = try KnowledgeStore(path: ":memory:")
        let start = record.start!.addingTimeInterval(-86400), end = record.end!.addingTimeInterval(86400)
        #expect(try await store.ingestSourceSnapshot([record], connector: "google_calendar", windowStart: start, windowEnd: end, scopeIDs: [record.scopeID!], account: "owner@example.test") == 1)
        #expect(try await store.ingestSourceSnapshot([record], connector: "google_calendar", windowStart: start, windowEnd: end, scopeIDs: [record.scopeID!], account: "owner@example.test") == 0)
        #expect(try await store.ingestSourceSnapshot([], connector: "google_calendar", windowStart: start, windowEnd: end, scopeIDs: ["different-account-scope"], account: "other") == 0)
        #expect(try await store.sourceRecords("google_calendar").count == 1)
        #expect(try await store.ingestSourceSnapshot([], connector: "google_calendar", windowStart: start, windowEnd: end, scopeIDs: [record.scopeID!], account: "owner@example.test") == 1)
    }
    @Test func gmailRanksExactContactMatch() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        _ = try await store.ingestAppleSnapshot([ConnectorSourceRecord(id: "alex", name: "Alex", content: "Email: alex@example.test")], connector: "apple_contacts")
        let event = try mail().event(account: "owner@example.test")
        _ = try await store.ingestGoogleMail([event])
        let people = try await store.people(now: event.occurredAt.addingTimeInterval(1))
        #expect(people.count == 1)
        #expect(people.first?.name == "Alex")
        #expect(people.first?.interactions == 1)
    }
}

private actor GoogleFixture: HTTPTransport {
    var requests: [URLRequest] = []
    let status: Int
    init(status: Int = 200) { self.status = status }
    func send(_ request: URLRequest) async throws -> (Data, Int) {
        requests.append(request)
        if status != 200 { return (Data("PRIVATE_ERROR_SENTINEL".utf8), status) }
        let page = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "pageToken" }?.value
        return (Data((page == nil ? #"{"items":[{"id":"a","summary":"Work"}],"nextPageToken":"two"}"# : #"{"items":[{"id":"b","summary":"Personal"}]}"#).utf8), 200)
    }
}
extension GoogleConnectorTests {
    @Test func calendarPaginationAndReadOnlyAuthentication() async throws {
        let transport = GoogleFixture()
        let records = try await GoogleAPI(token: "TEST_TOKEN", transport: transport).calendars()
        #expect(records.count == 2)
        let requests = await transport.requests
        #expect(requests.count == 2)
        #expect(requests.allSatisfy { $0.httpMethod == "GET" && $0.value(forHTTPHeaderField: "Authorization") == "Bearer TEST_TOKEN" && $0.url?.host == "www.googleapis.com" })
        #expect(requests[1].url?.query?.contains("pageToken=two") == true)
        for status in [401,403,429,500] {
            do { _ = try await GoogleAPI(token: "TEST_TOKEN", transport: GoogleFixture(status: status)).calendars(); Issue.record("Accepted failed response") }
            catch { #expect(!error.localizedDescription.contains("PRIVATE_ERROR_SENTINEL")); #expect(!error.localizedDescription.contains("TEST_TOKEN")) }
        }
    }
}

struct AuditQueueTests {
    @Test func targetedClassificationDoesNotConsumeUnrelatedBacklog() async throws {
        let store=try KnowledgeStore(path:":memory:")
        func event(_ id:String)->Event {Event(id:id,type:"note.updated",source:Source(connector:"notes",account:"test",externalID:id,revision:"1"),occurredAt:Date(),subjects:["person:self"],content:id)}
        _ = try await store.ingest(event("unrelated"));_ = try await store.ingest(event("selected"))
        let lease=try #require(await store.acquire(now:Date(),eventIDs:["selected"]))
        #expect(lease.eventID=="selected")
        #expect(try await store.acquire(now:Date(),eventIDs:[])==nil)
        #expect(try await store.acquire(now:Date())?.eventID=="unrelated")
    }
}

struct MailNormalizationTests {
    @Test func htmlTextPreservesActionsWithoutRemoteMarkupOrCredentials() {
        let input="<html><head><style>tracking</style></head><body><p>Welcome &amp; congratulations.</p><p>Complete your profile.</p><p>Temporary password: SECRET-VALUE</p><a href='https://example.test/?token=SECRET-LINK'>Open dashboard</a></body></html>"
        let text=MailText.visible(input)
        #expect(text.contains("Welcome & congratulations."));#expect(text.contains("Complete your profile."));#expect(text.contains("Open dashboard"))
        #expect(!text.contains("SECRET"));#expect(!text.contains("tracking"));#expect(!text.contains("<html>"))
    }
}

private actor HistoryMailTransport:HTTPTransport {
    var listed=0
    func send(_ request:URLRequest) async throws -> (Data,Int) {
        let url=request.url!
        if url.path.hasSuffix("/messages") {
            listed+=1
            return (Data((listed==1 ? #"{"messages":[{"id":"one"}],"nextPageToken":"next"}"# : #"{"messages":[{"id":"two"}]}"#).utf8),200)
        }
        let json:[String:Any]=["id":url.lastPathComponent,"threadId":"thread","internalDate":"1790000000000","labelIds":["SENT"],"payload":["mimeType":"text/html","headers":[["name":"From","value":"Alias <alias@example.test>"]],"body":["data":Data("<p>Please review the plan.</p>".utf8).base64EncodedString()]]]
        return (try JSONSerialization.data(withJSONObject:json),200)
    }
}
struct HistoryMailTests {
    @Test func paginatesHistoryAndRecognizesSentAliasesWithHTMLBodies() async throws {
        let transport=HistoryMailTransport()
        let events=try await GoogleAPI(token:"fixture",transport:transport).recentMail(account:"owner@example.test",query:"newer_than:90d",limit:2)
        #expect(events.count==2);#expect(await transport.listed==2)
        #expect(events.allSatisfy{$0.type=="message.sent" && $0.content.contains("Please review the plan.") && !$0.content.contains("<p>")})
    }
}
