import Foundation

/// Compact wire representation only. SQLite and the decision retain the full Context.
/// Every observation, timestamp and evidence ID survives; repeated entity IDs are interned.
struct JevHomeState: Encodable {
    let event: Event
    let currentState: [Claim]
    let entities: [String]
    let entitySubjects: [[String]]
    let columns = ["evidenceID", "entityIndex", "occurredAt", "content"]
    let relatedEvidence: [Observation]
    let recentEvents: [Observation]

    struct Observation: Encodable {
        let event: Event
        let entityIndex: Int
        func encode(to encoder: any Encoder) throws {
            var row = encoder.unkeyedContainer()
            try row.encode(event.id)
            try row.encode(entityIndex)
            try row.encode(event.occurredAt)
            try row.encode(event.content)
        }
    }

    init(_ context: Context) {
        event = context.event
        currentState = context.currentState
        entities = Array(Set((context.relatedEvidence + context.recentEvents).map { $0.source.externalID })).sorted()
        entitySubjects = entities.map { entity in
            Array(Set((context.relatedEvidence + context.recentEvents).filter { $0.source.externalID == entity }.flatMap(\.subjects))).sorted()
        }
        let indices = Dictionary(uniqueKeysWithValues: entities.enumerated().map { ($0.element, $0.offset) })
        relatedEvidence = context.relatedEvidence.map { Observation(event: $0, entityIndex: indices[$0.source.externalID]!) }
        recentEvents = context.recentEvents.map { Observation(event: $0, entityIndex: indices[$0.source.externalID]!) }
    }
}

/// An exact allowlisted provider error; never carries arbitrary HTTP error text.
struct JevInputTooLarge: Error, LocalizedError {
    var errorDescription: String? {
        "This source exceeds Jev's input limit. Its evidence is retained for review; other sources can continue processing."
    }
    static func matches(status: Int, data: Data) -> Bool {
        guard status == 400, data.count <= 16_384,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let detail = object["detail"] as? [String: Any] else { return false }
        return detail["error_type"] as? String == "max_tokens_exceeded"
    }
}
