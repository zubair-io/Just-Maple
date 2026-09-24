import Foundation

/// A capture payload contains no trusted device identity; the authenticated transport supplies it.
public struct CompanionObservation: Codable, Sendable, Equatable {
    public let id: UUID
    public let text: String
    public let createdAt: Date
    public init(id: UUID, text: String, createdAt: Date) {
        self.id = id; self.text = text; self.createdAt = createdAt
    }
}

public struct CompanionReceipt: Codable, Sendable, Equatable {
    public let id: UUID
    public let eventID: String
    public init(id: UUID, eventID: String) { self.id = id; self.eventID = eventID }
}

extension KnowledgeStore {
    /// Returns only after event, local index jobs and processing queue have committed together.
    /// Retries return the original receipt; ID reuse with different content or time is rejected.
    public func ingestCompanionCapture(_ observation: CompanionObservation,
                                       authenticatedDeviceID: UUID,
                                       now: Date = Date()) throws -> CompanionReceipt {
        guard !observation.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              observation.text.utf8.count <= 16_384,
              observation.createdAt.timeIntervalSinceReferenceDate.isFinite,
              now.timeIntervalSinceReferenceDate.isFinite,
              observation.createdAt <= now.addingTimeInterval(300) else {
            throw MapleError.invalid("A companion capture needs nonblank text up to 16 KB and a valid capture time no more than five minutes ahead.")
        }
        let deviceID = authenticatedDeviceID.uuidString.lowercased()
        let captureID = observation.id.uuidString.lowercased()
        // Include the exact source time in immutable content: generic ingest compares content
        // atomically on replay, but does not otherwise compare occurredAt. The reference-date
        // Double representation preserves Date precision without ISO formatter rounding.
        let content = "iPhone capture\nCaptured at (seconds since 2001-01-01 UTC): \(observation.createdAt.timeIntervalSinceReferenceDate)\n\n\(observation.text)"
        let event = Event(id: "companion:\(deviceID):\(captureID)", type: "note.captured",
                          source: Source(connector: "iphone_companion", account: deviceID, externalID: captureID, revision: "1"),
                          occurredAt: observation.createdAt, receivedAt: now, subjects: ["person:self"], content: content)
        let eventID = try ingest(event)
        return CompanionReceipt(id: observation.id, eventID: eventID)
    }
}
