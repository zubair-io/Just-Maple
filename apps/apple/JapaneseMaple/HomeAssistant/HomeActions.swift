//
//  HomeActions.swift
//  JapaneseMaple
//
//  `home_service` actions: a change to a Home Assistant entity the owner confirmed in a
//  chat. They come through the same queue as "Add to calendar" (CalendarActions.swift).
//
//  Before calling anything the Mac checks, again, on its own:
//  - the action hasn't expired (the server gives 15 minutes from the tap);
//  - the domain and service are on the allowed list below, with a value in range;
//  - a sensitive call (locks, scenes, scripts, garage doors, gates and their openers) was
//    confirmed twice: the server marks it `sensitive`, and the Mac refuses one that isn't;
//  - the entity is still exposed, by reading the exposed list right then.
//

#if os(macOS)
import Foundation

/// One service call, as the server sends it (`HomeServiceCallSchema`).
nonisolated struct HomeServiceCall: Codable, Equatable, Sendable {
    var entityId: String
    var domain: String
    var service: String
    var data: [String: JSONValue]?
    var name: String?
    var area: String?
    var sensitive: Bool?
}

/// Runs a confirmed call. The connector does it over its live connection.
nonisolated protocol HomeActionPerforming: Sendable {
    func perform(_ call: HomeServiceCall) async -> DeviceActionResult
}

nonisolated enum HomeServiceRules {
    /// The same list as `HOME_SERVICES` on the server: each service and the one value it takes.
    static let services: [String: [String: String?]] = [
        "light": ["turn_on": "brightness_pct", "turn_off": nil, "toggle": nil],
        "switch": ["turn_on": nil, "turn_off": nil, "toggle": nil],
        "fan": ["turn_on": nil, "turn_off": nil, "set_percentage": "percentage"],
        "cover": [
            "open_cover": nil, "close_cover": nil, "stop_cover": nil,
            "set_cover_position": "position",
        ],
        "climate": [
            "turn_on": nil, "turn_off": nil, "set_temperature": "temperature",
            "set_hvac_mode": "hvac_mode",
        ],
        "lock": ["lock": nil, "unlock": nil],
        "media_player": [
            "turn_on": nil, "turn_off": nil, "media_play": nil, "media_pause": nil,
            "media_stop": nil, "media_next_track": nil, "media_previous_track": nil,
            "volume_set": "volume_level",
        ],
        "scene": ["turn_on": nil],
        "script": ["turn_on": nil],
    ]
    static let hvacModes: Set<String> = ["off", "heat", "cool", "heat_cool", "auto", "dry", "fan_only"]

    /// Words that mean an entity opens or unlocks a way into the home.
    static let entryWords: Set<String> = ["garage", "gate", "gates", "door", "doors", "lock", "locks", "opener"]

    /// The same rule as `isSensitiveHomeEntity` on the server: locks, scenes and scripts;
    /// covers and switches that are, or are named like, a garage door, gate, door or opener.
    static func isSensitive(entityId: String, deviceClass: String?, name: String?) -> Bool {
        let domain = entityId.split(separator: ".").first.map(String.init) ?? ""
        if ["lock", "scene", "script"].contains(domain) { return true }
        guard domain == "cover" || domain == "switch" else { return false }
        if let deviceClass, ["garage", "gate", "door"].contains(deviceClass) { return true }
        let words = "\(entityId) \(name ?? "")".lowercased()
        if words.contains("garage") || words.contains("opener") { return true }
        return words.split(whereSeparator: { !("a"..."z").contains($0) }).contains {
            entryWords.contains(String($0))
        }
    }

    /// Why the call isn't allowed, or nil when it is. `deviceClass` and `name` are what this
    /// Mac knows of the entity, so a call the server didn't mark sensitive still is here.
    static func problem(_ call: HomeServiceCall, deviceClass: String? = nil, name: String? = nil) -> String? {
        guard HomeExposure.isValidEntityId(call.entityId),
            call.entityId.hasPrefix("\(call.domain)."),
            HomeDomains.control.contains(call.domain),
            let allowed = services[call.domain], let field = allowed[call.service]
        else { return "Just Maple can't do \(call.domain).\(call.service)." }
        if call.sensitive != true,
            isSensitive(entityId: call.entityId, deviceClass: deviceClass, name: name)
                || isSensitive(entityId: call.entityId, deviceClass: nil, name: call.name)
        {
            return "\(call.name ?? call.entityId) needs a second confirmation in Just Maple."
        }
        let data = call.data ?? [:]
        guard data.count <= 1, data.keys.allSatisfy({ $0 == field }) else {
            return "Unexpected values for \(call.service)."
        }
        guard let field, let value = data[field] else { return nil }
        switch (field, value) {
        case ("brightness_pct", .number(let n)), ("percentage", .number(let n)),
            ("position", .number(let n)):
            return (0...100).contains(n) ? nil : "\(field) must be between 0 and 100."
        case ("volume_level", .number(let n)):
            return (0...1).contains(n) ? nil : "volume_level must be between 0 and 1."
        case ("temperature", .number(let n)):
            return (-50...150).contains(n) ? nil : "temperature is out of range."
        case ("hvac_mode", .string(let mode)):
            return hvacModes.contains(mode) ? nil : "Unknown hvac_mode."
        default:
            return "Invalid \(field)."
        }
    }

    /// The `call_service` message for this call, with request id `id`.
    static func message(_ call: HomeServiceCall, id: Int) -> [String: Any] {
        var message: [String: Any] = [
            "id": id, "type": "call_service", "domain": call.domain, "service": call.service,
            "target": ["entity_id": call.entityId],
        ]
        if let data = call.data, !data.isEmpty {
            message["service_data"] = data.mapValues(\.anyValue)
        }
        return message
    }
}

nonisolated extension JSONValue {
    /// For JSONSerialization; whole numbers become integers.
    var anyValue: Any {
        switch self {
        case .string(let value): value
        case .number(let value):
            value.rounded() == value && abs(value) < 1e15 ? Int(value) as Any : value as Any
        case .bool(let value): value
        case .array(let values): values.map(\.anyValue)
        case .object(let values): values.mapValues(\.anyValue)
        case .null: NSNull()
        }
    }
}

nonisolated enum HomeActionError {
    static func expired() -> DeviceActionResult {
        DeviceActionResult(ok: false, error: "This expired before the Mac could do it. Ask again if you still want it.")
    }

    static func notConnected() -> DeviceActionResult {
        DeviceActionResult(ok: false, error: "This Mac isn't connected to Home Assistant right now.")
    }
}
#endif
