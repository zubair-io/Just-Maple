import Foundation
import Testing
@testable import MapleCore

private actor ContactsFixture: HTTPTransport {
    var requests: [URLRequest] = []
    let failSecond: Bool
    init(failSecond: Bool = false) { self.failSecond = failSecond }
    func send(_ request: URLRequest) async throws -> (Data, Int) {
        requests.append(request)
        if requests.count == 2 && failSecond { return (Data(), 403) }
        return (Data((requests.count == 1 ? #"{"connections":[{"resourceName":"people/one","names":[{"displayName":"Alex"}],"emailAddresses":[{"value":"alex@example.test"}]}],"nextPageToken":"next"}"# : #"{"connections":[{"resourceName":"people/two","names":[{"displayName":"Sam"}]}]}"#).utf8), 200)
    }
}
struct GoogleContactsTests {
    @Test func paginatedReadOnlyContactSnapshotAndIdentity() async throws {
        let transport = ContactsFixture()
        let records = try await GoogleAPI(token: "fixture", transport: transport).contacts(account: "owner@example.test")
        #expect(records.count == 2)
        let requests = await transport.requests
        #expect(requests.allSatisfy { $0.httpMethod == "GET" && $0.url?.host == "people.googleapis.com" })
        #expect(requests[0].url?.query?.contains("READ_SOURCE_TYPE_CONTACT") == true)
        #expect(requests[1].url?.query?.contains("pageToken=next") == true)
        let store = try KnowledgeStore(path: ":memory:")
        let scope = ConnectorSourceRecord.identifier("owner@example.test")
        #expect(try await store.ingestSourceSnapshot(records, connector: "google_contacts", scopeIDs: [scope], account: "owner@example.test") == 2)
        #expect(try await store.ingestSourceSnapshot(records, connector: "google_contacts", scopeIDs: [scope], account: "owner@example.test") == 0)
        let event = try #require(try await store.search("Alex").first)
        #expect(event.subjects.count == 1)
        #expect(event.subjects[0].hasPrefix("person:google:"))
        #expect(!FactRules.subjects(for: event).contains("person:self"))
        #expect(try await store.people().isEmpty)
        let alex = try #require(try await store.people(search: "alex").first)
        #expect(alex.source == "Google Contacts")
        try await store.pinPerson(alex.id, pinned: true)
        #expect(try await store.people().first?.name == "Alex")
        let otherScope = ConnectorSourceRecord.identifier("other@example.test")
        #expect(try await store.ingestSourceSnapshot([], connector: "google_contacts", scopeIDs: [otherScope], account: "other@example.test") == 0)
        #expect(try await store.sourceRecords("google_contacts").count == 2)
        #expect(try await store.ingestSourceSnapshot([], connector: "google_contacts", scopeIDs: [scope], account: "owner@example.test") == 2)
    }
    @Test func failedSecondPageCannotBecomePartialSnapshot() async throws {
        do { _ = try await GoogleAPI(token: "fixture", transport: ContactsFixture(failSecond: true)).contacts(account: "owner"); Issue.record("Accepted partial contacts") } catch {}
    }
}
