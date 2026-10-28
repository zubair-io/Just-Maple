//
//  HomeExposure.swift
//  JapaneseMaple
//
//  Which Home Assistant entities the user exposed to assistants (Settings → Voice
//  assistants → Expose). Only these are ever read, uploaded, shown to bots or controlled.
//
//  Read with `{"type":"homeassistant/expose_entity/list"}` over the WebSocket (it needs an
//  admin token). The result is `exposed_entities: {entity_id: {assistant: bool}}`, or in
//  older Home Assistant versions `{entity_id: {assistant: {should_expose: bool}}}`. An
//  entity counts when any of the assistants below has it on.
//
//  Ported from MapleCore's HomeExposure (the canonical rules), with the same validation.
//

#if os(macOS)
import Foundation

nonisolated enum HomeExposure {
    /// Home Assistant's own assistants; anything else in the list is ignored.
    static let assistants: Set<String> = ["conversation", "cloud.alexa", "cloud.google_assistant"]
    static let maxEntities = 10_000
    static let maxResponseBytes = 10_000_000

    nonisolated enum ParseError: LocalizedError, Equatable {
        case tooLarge
        case invalid

        var errorDescription: String? {
            switch self {
            case .tooLarge: "Home Assistant's exposure list is too large."
            case .invalid: "Home Assistant returned an invalid exposure list."
            }
        }
    }

    /// The exposed entity ids in a `result` message answering request `id`.
    /// Throws on anything malformed: an unreadable list exposes nothing.
    static func parse(_ data: Data, id: Int) throws -> Set<String> {
        guard data.count <= maxResponseBytes else { throw ParseError.tooLarge }
        guard let message = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw ParseError.invalid
        }
        return try parse(message: message, id: id)
    }

    static func parse(message: [String: Any], id: Int) throws -> Set<String> {
        guard (message["id"] as? NSNumber)?.intValue == id, message["type"] as? String == "result",
            (message["success"] as? NSNumber)?.boolValue == true,
            let result = message["result"] as? [String: Any],
            let entities = result["exposed_entities"] as? [String: Any]
        else { throw ParseError.invalid }
        guard entities.count <= maxEntities else { throw ParseError.tooLarge }
        var exposed = Set<String>()
        for (entityId, value) in entities {
            guard entityId.contains("."), entityId.utf8.count <= 256,
                let settings = value as? [String: Any]
            else { throw ParseError.invalid }
            var on = false
            for (assistant, setting) in settings {
                // Every value must be a flag, in either format, even ones we ignore.
                guard let enabled = flag(setting) else { throw ParseError.invalid }
                if enabled, assistants.contains(assistant) { on = true }
            }
            // Ids the server would refuse are never treated as exposed.
            if on, isValidEntityId(entityId) { exposed.insert(entityId) }
        }
        return exposed
    }

    /// `true`, or the older `{"should_expose": true}`.
    private static func flag(_ value: Any) -> Bool? {
        if let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() {
            return number.boolValue
        }
        if let legacy = value as? [String: Any], let number = legacy["should_expose"] as? NSNumber,
            CFGetTypeID(number) == CFBooleanGetTypeID()
        {
            return number.boolValue
        }
        return nil
    }

    /// `domain.object_id` in lowercase letters, digits and underscores (the server's pattern).
    static func isValidEntityId(_ id: String) -> Bool {
        let parts = id.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 2, (1...64).contains(parts[0].count), (1...190).contains(parts[1].count)
        else { return false }
        let allowed = Set("abcdefghijklmnopqrstuvwxyz0123456789_")
        return parts.allSatisfy { $0.allSatisfy(allowed.contains) }
    }
}
#endif
