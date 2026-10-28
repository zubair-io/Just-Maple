//
//  HomeEntities.swift
//  JapaneseMaple
//
//  Entity states from `subscribe_entities`, and how they become `home` items.
//
//  `subscribe_entities` sends compressed states: `a` adds full states, `c` changes them
//  (`+` sets fields, `-` removes attributes) and `r` removes entities. Fields: `s` state,
//  `a` attributes, `lc` last changed, `lu` last updated (seconds since 1970).
//
//  Each exposed entity is one item, `home:<entity_id>`, with its current state. A
//  meaningful change also becomes its own item, `home:<entity_id>@<time>`; numbers that
//  move all day (power, temperature) only refresh the current state, at most every few
//  minutes (HomeChangeCoalescer).
//

#if os(macOS)
import Foundation

nonisolated struct HomeEntityState: Equatable, Sendable {
    var entityId: String
    var state: String
    var attributes: [String: JSONValue]
    /// Seconds since 1970.
    var lastChanged: Double
    var lastUpdated: Double

    var domain: String { String(entityId.split(separator: ".").first ?? "") }
    var friendlyName: String? { attributes["friendly_name"]?.stringValue }
    var unit: String? { attributes["unit_of_measurement"]?.stringValue }
    var deviceClass: String? { attributes["device_class"]?.stringValue }

    /// Where someone is: never sent with coordinates.
    var isPresence: Bool { HomeDomains.presence.contains(domain) }

    /// A reading that moves on its own (power, temperature), not an on/off kind of state.
    var isMeasurement: Bool {
        guard Double(state) != nil else { return false }
        return HomeDomains.measuring.contains(domain) || unit != nil
    }
}

nonisolated enum HomeDomains {
    /// What a bot may propose changes to. The same list as `HOME_CONTROL_DOMAINS` on the server.
    static let control: Set<String> = [
        "light", "switch", "fan", "cover", "climate", "lock", "media_player", "scene", "script",
    ]
    static let presence: Set<String> = ["person", "device_tracker"]
    static let measuring: Set<String> = ["sensor", "number", "input_number", "counter"]

    /// Attributes worth keeping. Coordinates, pictures and long lists never leave the Mac.
    static let keptAttributes: Set<String> = [
        "friendly_name", "unit_of_measurement", "device_class", "state_class", "brightness",
        "color_mode", "current_temperature", "temperature", "target_temp_high", "target_temp_low",
        "hvac_action", "current_position", "percentage", "volume_level", "is_volume_muted",
        "media_title", "media_artist", "source", "battery_level",
    ]
}

// MARK: - Compressed states

nonisolated enum HomeEntityDiff {
    /// Applies one `subscribe_entities` event to `states`. Entities outside `allowed` are
    /// ignored, even if Home Assistant sends them. Returns the entities that changed, with
    /// their state before (nil when new) and after (nil when removed).
    static func apply(
        _ event: [String: Any], to states: inout [String: HomeEntityState], allowed: Set<String>
    ) -> [(id: String, before: HomeEntityState?, after: HomeEntityState?)] {
        var changes: [(String, HomeEntityState?, HomeEntityState?)] = []
        if let added = event["a"] as? [String: Any] {
            for (id, raw) in added where allowed.contains(id) {
                guard let fields = raw as? [String: Any], let state = full(id, fields) else { continue }
                let before = states[id]
                states[id] = state
                if before != state { changes.append((id, before, state)) }
            }
        }
        if let changed = event["c"] as? [String: Any] {
            for (id, raw) in changed where allowed.contains(id) {
                guard let diff = raw as? [String: Any], var state = states[id] else { continue }
                let before = state
                if let plus = diff["+"] as? [String: Any] {
                    if let value = plus["s"] { state.state = text(value) }
                    if let attributes = plus["a"] as? [String: Any] {
                        for (key, value) in attributes { state.attributes[key] = JSONValue(any: value) }
                        state.attributes = kept(state.attributes)
                    }
                    if let lc = number(plus["lc"]) {
                        state.lastChanged = lc
                        state.lastUpdated = lc
                    }
                    if let lu = number(plus["lu"]) { state.lastUpdated = lu }
                }
                if let minus = diff["-"] as? [String: Any], let keys = minus["a"] as? [String] {
                    for key in keys { state.attributes[key] = nil }
                }
                states[id] = state
                if before != state { changes.append((id, before, state)) }
            }
        }
        if let removed = event["r"] as? [String] {
            for id in removed {
                if let before = states.removeValue(forKey: id) { changes.append((id, before, nil)) }
            }
        }
        return changes
    }

    private static func full(_ id: String, _ fields: [String: Any]) -> HomeEntityState? {
        guard let value = fields["s"] else { return nil }
        let lastChanged = number(fields["lc"]) ?? Date().timeIntervalSince1970
        let attributes = (fields["a"] as? [String: Any] ?? [:]).compactMapValues { JSONValue(any: $0) }
        return HomeEntityState(
            entityId: id, state: text(value), attributes: kept(attributes),
            lastChanged: lastChanged, lastUpdated: number(fields["lu"]) ?? lastChanged)
    }

    private static func kept(_ attributes: [String: JSONValue]) -> [String: JSONValue] {
        attributes.filter { key, value in
            guard HomeDomains.keptAttributes.contains(key) else { return false }
            if case .string(let text) = value { return text.count <= 200 }
            if case .array = value { return false }
            if case .object = value { return false }
            return true
        }
    }

    private static func text(_ value: Any) -> String {
        if let string = value as? String { return String(string.prefix(255)) }
        if let number = value as? NSNumber { return number.stringValue }
        return ""
    }

    static func number(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else {
            return nil
        }
        return number.doubleValue
    }
}

nonisolated extension JSONValue {
    init?(any value: Any) {
        switch value {
        case let number as NSNumber where CFGetTypeID(number) == CFBooleanGetTypeID():
            self = .bool(number.boolValue)
        case let number as NSNumber:
            self = .number(number.doubleValue)
        case let string as String:
            self = .string(string)
        case let array as [Any]:
            self = .array(array.compactMap(JSONValue.init(any:)))
        case let object as [String: Any]:
            self = .object(object.compactMapValues(JSONValue.init(any:)))
        case is NSNull:
            self = .null
        default:
            return nil
        }
    }

    var stringValue: String? {
        if case .string(let value) = self { return value }
        return nil
    }
}

// MARK: - Items

/// Names and areas from Home Assistant's registries, for the items.
nonisolated struct HomeEntityInfo: Equatable, Sendable {
    var name: String?
    var area: String?
}

nonisolated enum HomeItems {
    static func stateId(_ entityId: String) -> String { "home:\(entityId)" }

    static func changeId(_ entityId: String, at time: Double) -> String {
        "home:\(entityId)@\(Int(time))"
    }

    /// The entity's current state.
    static func state(_ entity: HomeEntityState, info: HomeEntityInfo?) -> MacDataItem {
        let name = displayName(entity, info)
        var extra = common(entity, info)
        extra["kind"] = .string("state")
        let attributes = entity.attributes.filter {
            !["friendly_name", "unit_of_measurement", "device_class"].contains($0.key)
        }
        if !attributes.isEmpty { extra["attributes"] = .object(attributes) }
        let signature = [
            entity.state, name, info?.area ?? "", String(entity.lastChanged),
            attributes.keys.sorted().map { "\($0)=\(attributes[$0]!)" }.joined(separator: ","),
        ].joined(separator: "|")
        return MacDataItem(
            id: stateId(entity.entityId), source: .home, revision: macDataStableHash(signature),
            occurredAt: entity.lastChanged, endAt: nil, title: name, sender: nil, participants: [],
            thread: nil, body: "\(name) is \(spoken(entity))", isFromMe: nil, location: info?.area,
            calendar: nil, allDay: nil, mailbox: nil, isRead: nil, extra: extra)
    }

    /// One change, from `from` to the entity's state now.
    static func change(_ entity: HomeEntityState, from: String, info: HomeEntityInfo?) -> MacDataItem {
        let name = displayName(entity, info)
        var extra = common(entity, info)
        extra["kind"] = .string("change")
        extra["from"] = .string(from)
        return MacDataItem(
            id: changeId(entity.entityId, at: entity.lastChanged), source: .home, revision: "1",
            occurredAt: entity.lastChanged, endAt: nil, title: name, sender: nil, participants: [],
            thread: nil, body: "\(name) changed from \(from) to \(spoken(entity))", isFromMe: nil,
            location: info?.area, calendar: nil, allDay: nil, mailbox: nil, isRead: nil, extra: extra)
    }

    private static func displayName(_ entity: HomeEntityState, _ info: HomeEntityInfo?) -> String {
        let name = entity.friendlyName ?? info?.name ?? entity.entityId
        return String(name.prefix(200))
    }

    private static func common(_ entity: HomeEntityState, _ info: HomeEntityInfo?) -> [String: JSONValue] {
        var extra: [String: JSONValue] = [
            "entityId": .string(entity.entityId),
            "domain": .string(entity.domain),
            "state": .string(entity.state),
        ]
        if let area = info?.area { extra["area"] = .string(area) }
        if let deviceClass = entity.deviceClass { extra["deviceClass"] = .string(deviceClass) }
        if let unit = entity.unit { extra["unit"] = .string(unit) }
        return extra
    }

    private static func spoken(_ entity: HomeEntityState) -> String {
        entity.unit.map { "\(entity.state) \($0)" } ?? entity.state
    }
}
#endif
