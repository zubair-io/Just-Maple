import Foundation

extension GoogleAPI {
    /// Full, contact-only snapshot: a failed or truncated page never implies removals.
    public func contacts(account: String) async throws -> [ConnectorSourceRecord] {
        struct Page: Decodable { let connections: [GoogleContact]?; let nextPageToken: String? }
        var records: [ConnectorSourceRecord] = [], page: String?, seenPages = Set<String>(), seenPeople = Set<String>()
        repeat {
            var query = [URLQueryItem(name: "personFields", value: "names,emailAddresses,phoneNumbers,organizations"),
                URLQueryItem(name: "sources", value: "READ_SOURCE_TYPE_CONTACT"), URLQueryItem(name: "pageSize", value: "1000")]
            if let page { query.append(URLQueryItem(name: "pageToken", value: page)) }
            let response: Page = try await get("/v1/people/me/connections", query: query, peopleAPI: true)
            for person in response.connections ?? [] {
                guard seenPeople.insert(person.resourceName).inserted else { throw MapleError.provider("Google repeated a contact. No partial snapshot was imported.") }
                records.append(try person.record(account: account))
            }
            guard records.count <= 10000 else { throw MapleError.provider("Google Contacts exceeds 10,000 contacts. No partial snapshot was imported.") }
            page = response.nextPageToken
            if let page, !seenPages.insert(page).inserted { throw MapleError.provider("Google repeated a contacts page. Try again later.") }
        } while page != nil
        return records.sorted { $0.id < $1.id }
    }
}

struct GoogleContact: Decodable {
    struct Name: Decodable { let displayName: String? }
    struct Value: Decodable { let value: String? }
    struct Organization: Decodable { let name: String?; let title: String? }
    let resourceName: String
    let names: [Name]?
    let emailAddresses: [Value]?
    let phoneNumbers: [Value]?
    let organizations: [Organization]?
    func record(account: String) throws -> ConnectorSourceRecord {
        guard resourceName.hasPrefix("people/"), resourceName.count <= 1024 else { throw MapleError.provider("Google returned an invalid contact identity.") }
        let names = (names ?? []).compactMap(\.displayName).filter { !$0.isEmpty }.sorted()
        let emails = (emailAddresses ?? []).compactMap(\.value).sorted()
        let phones = (phoneNumbers ?? []).compactMap(\.value).sorted()
        let organizations = (organizations ?? []).map { [$0.name, $0.title].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ") }.sorted()
        let name = names.first ?? organizations.first ?? emails.first ?? phones.first ?? "Unnamed contact"
        let content = "Google Contacts source record (not a user correction)\nName: \(name)\nOrganization and title: \(organizations.joined(separator: "; "))\nEmail: \(emails.joined(separator: ", "))\nPhone: \(phones.joined(separator: ", "))"
        return ConnectorSourceRecord(id: ConnectorSourceRecord.identifier(account + "|" + resourceName), name: name, content: content, scopeID: ConnectorSourceRecord.identifier(account))
    }
}
