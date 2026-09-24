import Foundation

/// A reversible projection of connector observations, not a rewrite of source subjects.
public struct PersonIdentity: Encodable, Sendable {
    public let id: String
    public let aliases: [String]
    public let evidenceEventIDs: [String]
    public let basis: String
}

extension KnowledgeStore {
    /// Only connector-provided address fields participate. Names and model claims never establish identity.
    public func personIdentities(now: Date = Date()) throws -> [PersonIdentity] {
        struct Contact { let id: String; let connector: String; let handles: Set<String>; let eventID: String }
        let separated = Set(try state().filter { $0.predicate == "person.identity_separate" && $0.value == "true" }.map(\.subject))
        var contacts: [Contact] = []
        for row in try db.rows("SELECT connector,json,event_id FROM connector_source_records WHERE active=1 AND connector IN ('apple_contacts','google_contacts') ORDER BY connector,id") {
            let record = try JSONCodec.decode(ConnectorSourceRecord.self, from: Data(row["json"]!.utf8))
            let connector = row["connector"]!
            let id = (connector == "apple_contacts" ? "person:apple:" : "person:google:") + ConnectorSourceRecord.identifier(record.id)
            let handles = Set(record.content.components(separatedBy: "\n").filter { $0.hasPrefix("Email: ") || $0.hasPrefix("Phone: ") }.flatMap { $0.dropFirst(7).components(separatedBy: ", ") }.compactMap(Self.contactHandle))
            contacts.append(Contact(id: id, connector: connector, handles: handles, eventID: row["event_id"]!))
        }
        var owners: [String: Set<String>] = [:]
        for contact in contacts { for handle in contact.handles { owners[handle, default: []].insert(contact.id) } }
        var root: [String: String] = [:], proof: [String: Set<String>] = [:]
        for contact in contacts { root[contact.id] = contact.id; proof[contact.id] = [contact.eventID] }
        // Duplicate address-book copies must agree on ALL supplied handles. Shared family/company
        // addresses with conflicting phone/email fields and same-book duplicates remain separate.
        let contactsByHandles = Dictionary(grouping: contacts, by: { $0.handles.sorted() })
        for candidates in contactsByHandles.values {
            guard let contact = candidates.first, !contact.handles.isEmpty else { continue }
            guard candidates.count == 2, Set(candidates.map(\.connector)).count == 2,
                  candidates.allSatisfy({ !separated.contains($0.id) }),
                  contact.handles.allSatisfy({ owners[$0] == Set(candidates.map(\.id)) }) else { continue }
            let canonical = candidates.map(\.id).sorted()[0]
            for candidate in candidates { root[candidate.id] = canonical }
        }
        let cutoff = now.addingTimeInterval(-30 * 86400)
        let rows = try db.rows("SELECT e.json FROM events e WHERE e.occurred_at>=? AND e.occurred_at<=? AND e.connector IN ('gmail','imessage') AND \(Self.currentIdentityRevisionSQL) ORDER BY e.occurred_at DESC,e.received_at DESC,e.rowid DESC LIMIT 10000", [String(cutoff.timeIntervalSince1970), String(now.timeIntervalSince1970)])
        var seen = Set<String>(), observations: [(alias: String, handle: String, eventID: String)] = []
        for row in rows {
            let event = try JSONCodec.decode(Event.self, from: Data(row["json"]!.utf8))
            let key = try JSONCodec.string([event.source.connector,event.source.account,event.source.externalID])
            guard seen.insert(key).inserted, let observation = Self.senderIdentity(event) else { continue }
            observations.append((observation.alias, observation.handle, event.id))
        }
        // Preselect deterministic roots so ingestion order cannot change a message-only identity.
        var messageRoots: [String: String] = [:]
        for item in observations where !separated.contains(item.alias) {
            messageRoots[item.handle] = min(messageRoots[item.handle] ?? item.alias, item.alias)
        }
        for item in observations {
            proof[item.alias, default: []].insert(item.eventID)
            guard !separated.contains(item.alias) else { root[item.alias] = item.alias; continue }
            let contactOwners = owners[item.handle] ?? []
            let resolved = Set(contactOwners.map { root[$0] ?? $0 })
            if resolved.count == 1, contactOwners.allSatisfy({ !separated.contains($0) }) {
                root[item.alias] = resolved.first!
            } else {
                root[item.alias] = messageRoots[item.handle] ?? item.alias
            }
        }
        return Dictionary(grouping: root.keys, by: { root[$0]! }).map { id, aliases in
            PersonIdentity(id: id, aliases: aliases.sorted(), evidenceEventIDs: Set(aliases.flatMap { proof[$0] ?? [] }).sorted(), basis: aliases.count > 1 ? "Exact connector email or phone; matching complete handles for address-book copies" : "Independent connector identity")
        }.sorted { $0.id < $1.id }
    }

    /// An explicit user correction. Separating a source alias prevents automatic joins until cleared.
    public func separatePersonIdentity(_ alias: String, separated: Bool, now: Date = Date()) throws {
        guard alias != "person:self", try personIdentities(now: now).contains(where: { $0.aliases.contains(alias) }) else {
            throw MapleError.invalid("Choose a known connector identity.")
        }
        try correct(subject: alias, predicate: "person.identity_separate", value: separated ? "true" : "false")
    }

    static let currentIdentityRevisionSQL = "NOT EXISTS (SELECT 1 FROM events n WHERE n.connector=e.connector AND n.account=e.account AND n.external_id=e.external_id AND (n.received_at>e.received_at OR (n.received_at=e.received_at AND n.rowid>e.rowid)))"

    static func senderIdentity(_ event: Event) -> (alias: String, handle: String)? {
        guard let sender = senderObservation(event), let handle = contactHandle(sender.address) else { return nil }
        return (sender.alias, handle)
    }

    // Display attribution also works for short codes, without treating them as joinable handles.
    static func senderObservation(_ event: Event) -> (alias: String, address: String, display: String)? {
        guard ["gmail", "imessage"].contains(event.source.connector) else { return nil }
        // Inspect headers only; message bodies can contain arbitrary Sender/Direction text.
        let headers = event.content.components(separatedBy: event.source.connector == "gmail" ? "\nBody" : "\n\n")[0].components(separatedBy: "\n")
        guard !headers.contains("Direction: outgoing"), let sender = headers.first(where: { $0.hasPrefix("Sender: ") }).map({ String($0.dropFirst(8)) }) else { return nil }
        let address = event.source.connector == "gmail" ? GoogleMailMessage.address(sender) : sender
        guard let address else { return nil }
        let alias = (event.source.connector == "gmail" ? "person:email:" : "person:imessage:") + ConnectorSourceRecord.identifier(address)
        guard event.subjects.contains(alias), alias != "person:self" else { return nil }
        return (alias, address, sender)
    }
}
