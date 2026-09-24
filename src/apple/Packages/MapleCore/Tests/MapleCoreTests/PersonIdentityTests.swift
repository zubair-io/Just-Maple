import Foundation
import Testing
@testable import MapleCore

struct PersonIdentityTests {
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    func message(_ connector: String, _ sender: String, id: String, extra: [String] = [], days: Double = 0) -> Event {
        let alias = (connector == "gmail" ? "person:email:" : "person:imessage:") + ConnectorSourceRecord.identifier(sender)
        return Event(type: "message.received", source: Source(connector: connector, account: "fixture", externalID: id, revision: "1"), occurredAt: now.addingTimeInterval(-days * 86400), subjects: ["person:self", alias] + extra, content: "Sender: \(sender)\nDirection: incoming\n\nHello")
    }
    @Test func exactMessageHandlesJoinWithoutContactsAndKeepProvenance() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let a = message("gmail", "alex@example.test", id: "a"), b = message("imessage", "alex@example.test", id: "b")
        try await store.ingest(a); try await store.ingest(b); try await store.ingest(a)
        let group = try #require(try await store.personIdentities(now: now).first)
        #expect(group.aliases.count == 2)
        #expect(Set(group.evidenceEventIDs) == [a.id,b.id])
        let people = try await store.people(now: now)
        #expect(people.count == 1)
        #expect(people.first?.interactions == 2)
        #expect(!group.aliases.contains("person:self"))
        try await store.separatePersonIdentity(group.aliases[0], separated: true, now: now)
        #expect(try await store.people(now: now).count == 2)
        try await store.separatePersonIdentity(group.aliases[0], separated: false, now: now)
        #expect(try await store.people(now: now).count == 1)
    }
    @Test func unrelatedSubjectsNamesAndOldMessagesNeverEstablishIdentity() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let stranger = "person:imessage:" + ConnectorSourceRecord.identifier("other@example.test")
        try await store.ingest(message("gmail", "alex@example.test", id: "a", extra: [stranger]))
        try await store.ingest(message("imessage", "alex@example.test", id: "old", days: 31))
        let groups = try await store.personIdentities(now: now)
        #expect(groups.count == 1)
        #expect(groups.first?.aliases.count == 1)
        #expect(!groups.contains { $0.aliases.contains(stranger) })
        #expect(KnowledgeStore.contactHandle("Alex") == nil)
        #expect(KnowledgeStore.contactHandle("Alex <alex@example.test>") == nil)
        #expect(KnowledgeStore.contactHandle("+44 1234 567890") != KnowledgeStore.contactHandle("44 1234 567890"))
    }
    @Test func matchingAddressBookCopiesCoalesceButConflictsDoNot() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let account = "fixture@example.test", scope = ConnectorSourceRecord.identifier(account)
        _ = try await store.ingestSourceSnapshot([ConnectorSourceRecord(id: "a", name: "Alex", content: "Email: alex@example.test\nPhone: +1 (555) 123-4567")], connector: "apple_contacts", now: now)
        _ = try await store.ingestSourceSnapshot([ConnectorSourceRecord(id: "g", name: "Alex G", content: "Email: ALEX@example.test\nPhone: +15551234567", scopeID: scope)], connector: "google_contacts", scopeIDs: [scope], now: now, account: account)
        try await store.ingest(message("gmail", "alex@example.test", id: "a"))
        #expect(try await store.people(now: now, includeQuiet: true).count == 1)
        #expect(try await store.personIdentities(now: now).first?.aliases.count == 3)
        _ = try await store.ingestSourceSnapshot([ConnectorSourceRecord(id: "g", name: "Alex G", content: "Email: alex@example.test\nPhone: +15559999999", scopeID: scope)], connector: "google_contacts", scopeIDs: [scope], now: now, account: account)
        #expect(try await store.people(now: now, includeQuiet: true).count == 3)
        _ = try await store.ingestSourceSnapshot([], connector: "google_contacts", scopeIDs: [scope], now: now, account: account)
        #expect(try await store.people(now: now, includeQuiet: true).count == 1)
    }
    @Test func accountScopedContactsRemainDistinctAndOutgoingNeverJoinsSelf() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        for account in ["one@example.test", "two@example.test"] {
            let scope = ConnectorSourceRecord.identifier(account)
            _ = try await store.ingestSourceSnapshot([ConnectorSourceRecord(id: account + "|people/alex", name: "Alex", content: "Email: alex@example.test", scopeID: scope)], connector: "google_contacts", scopeIDs: [scope], now: now, account: account)
        }
        try await store.ingest(message("gmail", "alex@example.test", id: "incoming"))
        #expect(try await store.personIdentities(now: now).count == 3)
        let alias = "person:imessage:" + ConnectorSourceRecord.identifier("alex@example.test")
        let sent = Event(type: "message.sent", source: Source(connector: "imessage", account: "local", externalID: "outgoing", revision: "1"), occurredAt: now, subjects: ["person:self", alias], content: "Sender: alex@example.test\nDirection: outgoing\n\nHello")
        try await store.ingest(sent)
        #expect(!(try await store.personIdentities(now: now)).contains { $0.aliases.contains(alias) || $0.aliases.contains("person:self") })
        do { try await store.separatePersonIdentity("person:self", separated: false, now: now); Issue.record("Accepted self identity") } catch {}
    }

    @Test func recipientsNeverInheritSenderNameIncludingPinnedHistory() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let recipient = "person:imessage:" + ConnectorSourceRecord.identifier("recipient@example.test")
        try await store.ingest(message("gmail", "sender@example.test", id: "received", extra: [recipient]))
        let people = try await store.people(now: now)
        #expect(people.first { $0.id == recipient }?.name == "Message participant")
        #expect(people.filter { $0.name == "sender@example.test" }.count == 1)
        try await store.correct(subject: recipient, predicate: "person.important", value: "true")
        let aged = try await store.people(now: now.addingTimeInterval(31 * 86400))
        #expect(aged.first { $0.id == recipient }?.name == "Pinned person")
    }

    @Test func latestReceivedRevisionWinsEvenWithOlderOccurrenceAndTimestampTies() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let firstSender = "first@example.test", latestSender = "latest@example.test"
        let firstAlias = "person:email:" + ConnectorSourceRecord.identifier(firstSender)
        let latestAlias = "person:email:" + ConnectorSourceRecord.identifier(latestSender)
        for (revision, sender, alias, date) in [("1", firstSender, firstAlias, now), ("2", latestSender, latestAlias, now.addingTimeInterval(-60))] {
            let event = Event(type: "message.received", source: Source(connector: "gmail", account: "fixture", externalID: "same-source", revision: revision), occurredAt: date, receivedAt: now, subjects: ["person:self", alias], content: "Sender: \(sender)\nDirection: incoming\n\nHello")
            try await store.ingest(event)
        }
        let groups = try await store.personIdentities(now: now)
        #expect(groups.count == 1)
        #expect(groups.first?.aliases == [latestAlias])
        let people = try await store.people(now: now)
        #expect(people.count == 1)
        #expect(people.first?.name == latestSender)
        #expect(people.first?.interactions == 1)
    }

}
