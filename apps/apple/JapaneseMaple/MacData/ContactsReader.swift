//
//  ContactsReader.swift
//  JapaneseMaple
//
//  Reads every card from the Contacts app (all accounts) through the Contacts
//  framework, so bots know who people are and how they relate to you. Notes and
//  photos are left out: notes can hold sensitive text, and photos aren't needed.
//  Read-only.
//

#if os(macOS)
import Contacts
import Foundation

nonisolated struct ContactsReader {
    static var hasAccess: Bool {
        CNContactStore.authorizationStatus(for: .contacts) == .authorized
    }

    static var accessDenied: Bool {
        let status = CNContactStore.authorizationStatus(for: .contacts)
        return status == .denied || status == .restricted
    }

    /// Explains a past decision macOS won't ask about again; nil when a prompt can still appear.
    static var accessProblem: String? {
        switch CNContactStore.authorizationStatus(for: .contacts) {
        case .denied:
            return "Contacts access is turned off for JapaneseMaple. Turn it on in System Settings → Privacy & Security → Contacts."
        case .restricted:
            return "Contacts access is restricted on this Mac, for example by Screen Time or a device profile."
        default:
            return nil
        }
    }

    static var keysToFetch: [CNKeyDescriptor] {
        let keys = [
            CNContactIdentifierKey, CNContactTypeKey, CNContactNicknameKey,
            CNContactOrganizationNameKey, CNContactJobTitleKey, CNContactPhoneNumbersKey,
            CNContactEmailAddressesKey, CNContactPostalAddressesKey, CNContactBirthdayKey,
            CNContactRelationsKey,
        ]
        return [CNContactFormatter.descriptorForRequiredKeys(for: .fullName)]
            + keys.map { $0 as CNKeyDescriptor }
    }

    /// Contacts has no change cursor that survives relaunch cheaply, and a few thousand
    /// cards read in well under a second, so each pass reads them all and the store
    /// removes cards that are gone.
    func read(store: CNContactStore = CNContactStore(), now: Date = Date()) throws
        -> MacDataReadResult
    {
        guard Self.hasAccess else {
            throw MacDataError.accessDenied("Contacts access hasn't been granted.")
        }
        let meId = try? store.unifiedMeContactWithKeys(
            toFetch: [CNContactIdentifierKey as CNKeyDescriptor]
        ).identifier
        let request = CNContactFetchRequest(keysToFetch: Self.keysToFetch)
        request.unifyResults = true
        var items: [MacDataItem] = []
        do {
            try store.enumerateContacts(with: request) { contact, _ in
                items.append(Self.item(from: contact, isMe: contact.identifier == meId, readAt: now))
            }
        } catch {
            throw MacDataError.accessDenied("Maple can't read Contacts: \(error.localizedDescription)")
        }
        return MacDataReadResult(
            items: items,
            removedIds: [],
            presentIds: Set(items.map(\.id)),
            // Every stored card is checked: cards aren't tied to a time.
            reconcileWindow: 0...Double.greatestFiniteMagnitude,
            checkpoint: String(now.timeIntervalSince1970))
    }

    // MARK: - Mapping

    static func item(from contact: CNContact, isMe: Bool, readAt: Date) -> MacDataItem {
        let name = displayName(contact)
        let phones = contact.phoneNumbers.map { labeled in
            (label: label(labeled.label), value: labeled.value.stringValue)
        }
        let emails = contact.emailAddresses.map { labeled in
            (label: label(labeled.label), value: String(labeled.value))
        }
        let addresses = contact.postalAddresses.map { labeled in
            (label: label(labeled.label), address: labeled.value)
        }
        let relations = contact.contactRelations.map { labeled in
            (label: label(labeled.label), name: labeled.value.name)
        }
        let birthday = contact.birthday.flatMap(Self.birthday)

        var lines = [name]
        if !contact.nickname.isEmpty { lines[0] += " (\(contact.nickname))" }
        if isMe { lines.append("This is me") }
        let work = [contact.jobTitle, contact.organizationName].filter { !$0.isEmpty }
        if !work.isEmpty, work != [name] { lines.append(work.joined(separator: ", ")) }
        lines += phones.map { "Phone\(suffix($0.label)): \($0.value)" }
        lines += emails.map { "Email\(suffix($0.label)): \($0.value)" }
        lines += addresses.map { "Address\(suffix($0.label)): \(formatted($0.address))" }
        if let birthday { lines.append("Birthday: \(birthday)") }
        lines += relations.map { "\(($0.label ?? "related").capitalized): \($0.name)" }

        var extra: [String: JSONValue] = [
            "phones": .array(phones.map { labeledJSON($0.label, ["value": .string($0.value)]) }),
            "emails": .array(emails.map { labeledJSON($0.label, ["value": .string($0.value)]) }),
            "addresses": .array(
                addresses.map { entry in
                    labeledJSON(
                        entry.label,
                        [
                            "street": .string(entry.address.street),
                            "city": .string(entry.address.city),
                            "state": .string(entry.address.state),
                            "postalCode": .string(entry.address.postalCode),
                            "country": .string(entry.address.country),
                            "formatted": .string(formatted(entry.address)),
                        ])
                }),
            "relations": .array(relations.map { labeledJSON($0.label, ["name": .string($0.name)]) }),
            "isMe": .bool(isMe),
        ]
        if let birthday { extra["birthday"] = .string(birthday) }
        if !contact.organizationName.isEmpty { extra["organization"] = .string(contact.organizationName) }
        if !contact.jobTitle.isEmpty { extra["jobTitle"] = .string(contact.jobTitle) }
        if !contact.nickname.isEmpty { extra["nickname"] = .string(contact.nickname) }

        let body = lines.joined(separator: "\n")
        return MacDataItem(
            id: "contacts:\(contact.identifier)",
            source: .contacts,
            // The read time isn't part of the revision, so unchanged cards aren't re-uploaded.
            revision: macDataStableHash(body),
            occurredAt: readAt.timeIntervalSince1970,
            endAt: nil,
            title: name,
            sender: nil,
            participants: phones.map(\.value) + emails.map(\.value),
            thread: nil,
            body: body,
            isFromMe: nil,
            location: nil,
            calendar: nil,
            allDay: nil,
            mailbox: nil,
            isRead: nil,
            extra: extra)
    }

    /// The name Contacts shows, falling back to the company, then any way to reach them.
    static func displayName(_ contact: CNContact) -> String {
        if let name = CNContactFormatter.string(from: contact, style: .fullName), !name.isEmpty {
            return name
        }
        if !contact.organizationName.isEmpty { return contact.organizationName }
        return contact.emailAddresses.first.map { String($0.value) }
            ?? contact.phoneNumbers.first?.value.stringValue ?? "(no name)"
    }

    /// YYYY-MM-DD, or --MM-DD (the vCard form) when the year isn't known.
    static func birthday(_ components: DateComponents) -> String? {
        guard let month = components.month, let day = components.day else { return nil }
        let monthDay = String(format: "%02d-%02d", month, day)
        guard let year = components.year, year != NSDateComponentUndefined else { return "--" + monthDay }
        return String(format: "%04d-", year) + monthDay
    }

    /// "_$!<Mobile>!$_" → "mobile"; custom labels stay as typed.
    private static func label(_ raw: String?) -> String? {
        guard let raw, !raw.isEmpty else { return nil }
        return CNLabeledValue<NSString>.localizedString(forLabel: raw).lowercased()
    }

    private static func suffix(_ label: String?) -> String {
        label.map { " (\($0))" } ?? ""
    }

    private static func labeledJSON(_ label: String?, _ fields: [String: JSONValue]) -> JSONValue {
        var fields = fields
        fields["label"] = label.map(JSONValue.string) ?? .null
        return .object(fields)
    }

    private static func formatted(_ address: CNPostalAddress) -> String {
        CNPostalAddressFormatter.string(from: address, style: .mailingAddress)
            .split(whereSeparator: \.isNewline).joined(separator: ", ")
    }
}

/// Phone number and email → contact name, so iMessage handles and Mail senders show
/// "Julia" instead of "+1 555…".
nonisolated struct MacDataContactNames: Sendable, Equatable {
    static let empty = MacDataContactNames(names: [:])

    private var names: [String: String]
    private var handles: Set<String>

    init(names: [String: String]) {
        self.names = names
        self.handles = Set(names.keys)
    }

    /// Built from stored contact items, using the phones and emails in their `extra`.
    init(contacts: [MacDataItem]) {
        var names: [String: String] = [:]
        var ambiguous = Set<String>()
        var handles = Set<String>()
        // A shared phone/email does not identify which contact authored a message.
        for contact in contacts {
            let name = contact.title ?? ""
            for field in ["phones", "emails"] {
                guard case .array(let entries) = contact.extra?[field] else { continue }
                for entry in entries {
                    let value: String?
                    switch entry {
                    case .object(let fields):
                        if case .string(let raw) = fields["value"] { value = raw } else { value = nil }
                    case .string(let raw): value = raw
                    default: value = nil
                    }
                    guard let value, let key = Self.key(value) else { continue }
                    handles.insert(key)
                    guard !name.isEmpty, !ambiguous.contains(key) else { continue }
                    if let previous = names[key], previous != name {
                        names.removeValue(forKey: key)
                        ambiguous.insert(key)
                    } else { names[key] = name }
                }
            }
        }
        self.names = names
        self.handles = handles
    }

    func containsEmail(_ handle: String) -> Bool {
        guard let key = Self.key(handle),
            key.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil
        else { return false }
        return handles.contains(key)
    }

    var isEmpty: Bool { names.isEmpty }

    func name(for handle: String) -> String? {
        Self.key(handle).flatMap { names[$0] }
    }

    /// Emails compare lowercased. US national numbers default to +1; explicit country
    /// codes are retained so numbers in different countries cannot collide by suffix.
    static func key(_ handle: String) -> String? {
        var value = handle.trimmingCharacters(in: .whitespacesAndNewlines)
        if let start = value.firstIndex(of: "<"), let end = value[start...].firstIndex(of: ">") {
            value = String(value[value.index(after: start)..<end]).trimmingCharacters(in: .whitespaces)
        }
        if value.lowercased().hasPrefix("mailto:") { value = String(value.dropFirst(7)) }
        if value.contains("@") { return value.isEmpty ? nil : value.lowercased() }
        let digits = value.unicodeScalars.filter { ("0"..."9").contains($0) }.map(String.init).joined()
        // Short codes and stray numbers would match too much.
        guard digits.count >= 7 else { return nil }
        return "+" + (digits.count == 10 ? "1" + digits : digits)
    }
}
#endif
