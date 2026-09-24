import Foundation

public struct PersonSummary: Encodable, Sendable {
    public let id: String
    public var name: String
    public var source: String
    public var relationship: String
    public var pinned: Bool
    public var interactions: Int
    public var lastInteraction: Date?
    public var score: Double
    public var reason: String
    public var facts: [SourceFact]
    public var claims: [Claim]
    public var evidenceEventIDs: [String]
    var aliases: Set<String>
    var searchText: String
    enum CodingKeys: String, CodingKey { case id, name, source, relationship, pinned, interactions, lastInteraction, score, reason, facts, claims, evidenceEventIDs }
}

extension KnowledgeStore {
    /// Recent interaction ranking over conservative, reversible connector identity groups.
    public func people(search: String = "", limit: Int = 12, now: Date = Date(), includeQuiet: Bool = false) throws -> [PersonSummary] {
        let current = try state()
        let facts = try sourceFacts(limit: 500)
        var people: [String: PersonSummary] = [:]
        let identities = try personIdentities(now: now)
        let identityByID = Dictionary(uniqueKeysWithValues: identities.map { ($0.id, $0) })
        let identityByAlias = Dictionary(uniqueKeysWithValues: identities.flatMap { identity in identity.aliases.map { ($0, identity.id) } })
        func candidate(_ id: String, name: String, source: String, text: String = "") -> PersonSummary {
            PersonSummary(id: id, name: name, source: source, relationship: "", pinned: false, interactions: 0, lastInteraction: nil, score: 0, reason: "", facts: [], claims: [], evidenceEventIDs: [], aliases: [id], searchText: name + " " + text)
        }
        let contacts = try sourceRecords("apple_contacts").map { ($0, "person:apple:", "Apple Contacts") }
            + sourceRecords("google_contacts").map { ($0, "person:google:", "Google Contacts") }
        for (record, prefix, source) in contacts {
            let id = prefix + ConnectorSourceRecord.identifier(record.id)
            people[id] = candidate(id, name: record.name, source: source, text: record.content)
        }
        for identity in identities {
            let members = identity.aliases.compactMap { people[$0] }
            guard var person = people[identity.id] ?? members.first else { continue }
            person.aliases.formUnion(identity.aliases)
            person.searchText = members.map(\.searchText).joined(separator: " ")
            for alias in identity.aliases { people.removeValue(forKey: alias) }
            people[identity.id] = person
        }

        for claim in current where claim.subject.hasPrefix("person:") && claim.subject != "person:self" && claim.predicate == "person.name" {
            let id = identityByAlias[claim.subject] ?? claim.subject
            if people[id] == nil { people[id] = candidate(id, name: claim.value, source: "Your context") }
            people[id]?.name = claim.value
        }
        let cutoff = now.addingTimeInterval(-30 * 86400)
        let rows = try db.rows("SELECT e.json FROM events e WHERE e.occurred_at>=? AND e.occurred_at<=? AND e.connector IN ('imessage','gmail','feedback') AND \(Self.currentIdentityRevisionSQL) ORDER BY e.occurred_at DESC,e.received_at DESC,e.rowid DESC LIMIT 10000", [String(cutoff.timeIntervalSince1970), String(now.timeIntervalSince1970)])
        var seenInteractions=Set<String>()
        for row in rows {
            let event = try JSONCodec.decode(Event.self, from: Data(row["json"]!.utf8))
            guard seenInteractions.insert(try JSONCodec.string([event.source.connector,event.source.account,event.source.externalID])).inserted else {continue}
            let sender = Self.senderObservation(event)
            var countedPeople = Set<String>()
            for alias in event.subjects where alias.hasPrefix("person:") && alias != "person:self" {
                let id = identityByAlias[alias] ?? alias
                guard countedPeople.insert(id).inserted else { continue }
                let senderID = sender.map { identityByAlias[$0.alias] ?? $0.alias }
                let display = senderID == id ? sender?.display : nil
                let shortCode = display.map { (3...6).contains($0.count) && $0.allSatisfy(\.isNumber) } ?? false
                if people[id] == nil { people[id] = candidate(id, name: display ?? "Message participant", source: shortCode ? "Automated Messages" : event.source.connector == "gmail" ? "Gmail" : "Messages") }
                var person = people[id]!
                person.aliases.formUnion(identityByID[id]?.aliases ?? [alias])
                person.interactions += 1
                person.lastInteraction = max(person.lastInteraction ?? .distantPast, event.occurredAt)
                // One-week half-life; frequency contributes without letting one old burst dominate.
                person.score += pow(0.5, now.timeIntervalSince(event.occurredAt) / (7 * 86400))
                if person.evidenceEventIDs.count < 6 { person.evidenceEventIDs.append(event.id) }
                people[id] = person
            }
        }
        // Resolve persisted pins for known subjects even if their last interaction aged out.
        for claim in current where claim.subject != "person:self" && claim.predicate == "person.important" && claim.value == "true" && !people.values.contains(where: { $0.aliases.contains(claim.subject) }) {
            let latest = try db.rows("SELECT e.json FROM events e JOIN event_subjects s ON s.event_id=e.id WHERE s.subject=? AND e.connector IN ('imessage','gmail') AND \(Self.currentIdentityRevisionSQL) ORDER BY e.occurred_at DESC,e.received_at DESC,e.rowid DESC LIMIT 1", [claim.subject]).first
            if let json = latest?["json"] {
                let event = try JSONCodec.decode(Event.self, from: Data(json.utf8))
                let sender = Self.senderObservation(event)
                let name = sender?.alias == claim.subject ? sender!.display : "Pinned person"
                people[claim.subject] = candidate(claim.subject, name: name, source: "Messages")
            }
        }
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return people.values.map { person in
            var person = person
            person.claims = current.filter { person.aliases.contains($0.subject) }
            person.facts = Array(facts.filter { person.aliases.contains($0.subject) }.prefix(8))
            person.pinned = person.claims.filter { $0.predicate == "person.important" }.max { $0.observedAt < $1.observedAt }?.value == "true"
            person.relationship = person.claims.first { $0.predicate == "person.relationship" }?.value ?? ""
            person.reason = person.pinned ? "Pinned by you" : "\(person.interactions) message interactions in the last 30 days"
            return person
        }.filter {
            query.isEmpty ? (includeQuiet || $0.pinned || ($0.interactions > 0 && $0.source != "Automated Messages")) : ($0.name.lowercased().contains(query) || $0.searchText.lowercased().contains(query))
        }.sorted {
            if $0.pinned != $1.pinned { return $0.pinned }
            if $0.score != $1.score { return $0.score > $1.score }
            return ($0.name, $0.id) < ($1.name, $1.id)
        }.prefix(max(1, min(limit, 10000))).map { $0 }
    }

    public func pinPerson(_ id: String, pinned: Bool) throws {
        guard try people(limit: 10000, includeQuiet: true).contains(where: { $0.id == id }) else { throw MapleError.invalid("Find a known person before pinning them.") }
        try correct(subject: id, predicate: "person.important", value: pinned ? "true" : "false")
    }

    static func contactHandle(_ raw: String) -> String? {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let parts = value.split(separator: "@", omittingEmptySubsequences: false)
        if parts.count == 2, parts.allSatisfy({ !$0.isEmpty }), !value.contains(where: { $0.isWhitespace || "<>,;".contains($0) }) { return "email:" + value }
        guard value.allSatisfy({ $0.isNumber || "+()- .".contains($0) }) else { return nil }
        let digits = value.filter(\.isNumber)
        // Do not infer a country code or collapse local numbers into international numbers.
        return (7...15).contains(digits.count) ? "phone:" + (value.hasPrefix("+") ? "+" : "") + digits : nil
    }
}
