import Foundation

/// User intent is separate from the resulting obligation lifecycle state.
public enum SyncTaskIntent: String, Codable, Sendable, CaseIterable {
    case done, later, waiting, notNeeded, undo
}

public struct SyncTaskActionPayload: Codable, Sendable, Equatable {
    public var resurfaceAt: Date?
    public var reviewAt: Date?
    public var waitingOn: String?
    public var targetMutationID: UUID?
    public init(resurfaceAt: Date? = nil, reviewAt: Date? = nil,
                waitingOn: String? = nil, targetMutationID: UUID? = nil) {
        self.resurfaceAt = resurfaceAt; self.reviewAt = reviewAt
        self.waitingOn = waitingOn; self.targetMutationID = targetMutationID
    }
}

/// Explicit user commands, never source observations and never outbound replies.
/// Legacy status commands remain readable. Typed commands deliberately use a status
/// namespace that older Mac dispatchers cannot mistake for a supported status update.
public struct SyncTaskAction: Codable, Sendable, Equatable {
    public var id: UUID
    public var taskID: String
    public var expectedVersion: Int
    public var status: String
    public var intent: SyncTaskIntent?
    public var issuedAt: Date?
    public var payload: SyncTaskActionPayload?

    public init(id: UUID = UUID(), taskID: String, expectedVersion: Int, status: String) {
        self.id = id; self.taskID = taskID; self.expectedVersion = expectedVersion
        self.status = status
    }

    public init(id: UUID = UUID(), taskID: String, expectedVersion: Int,
                intent: SyncTaskIntent, issuedAt: Date = Date(),
                payload: SyncTaskActionPayload = .init()) {
        self.id = id; self.taskID = taskID; self.expectedVersion = expectedVersion
        self.status = "intent:" + intent.rawValue; self.intent = intent
        self.issuedAt = issuedAt; self.payload = payload
    }

    private static func validDate(_ date: Date) -> Bool {
        let seconds = date.timeIntervalSince1970
        return seconds.isFinite && seconds >= 0 && seconds < 253_402_300_800
    }

    /// Stable validation for persisted/retried commands. Never order conflicts by clocks;
    /// expectedVersion is the concurrency token. A deferred command may arrive after its date.
    public var valid: Bool {
        guard taskID.utf8.count <= 1024, expectedVersion > 0,
              (taskID.hasPrefix("task:") && taskID.count > 5) ||
              (taskID.hasPrefix("source:") && taskID.count > 7) else { return false }
        guard let intent else {
            return issuedAt == nil && payload == nil && ["completed", "open", "cancelled"].contains(status)
        }
        guard status == "intent:" + intent.rawValue,
              let issuedAt, Self.validDate(issuedAt), let payload else { return false }
        if let date = payload.resurfaceAt, !Self.validDate(date) || date <= issuedAt { return false }
        if let date = payload.reviewAt, !Self.validDate(date) || date <= issuedAt { return false }
        if let actor = payload.waitingOn,
           actor.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || actor.utf8.count > 256 { return false }
        switch intent {
        case .done, .notNeeded:
            return payload == .init()
        case .later:
            return payload.resurfaceAt != nil && payload.reviewAt == nil &&
                payload.waitingOn == nil && payload.targetMutationID == nil
        case .waiting:
            return payload.resurfaceAt == nil && payload.targetMutationID == nil
        case .undo:
            return payload.targetMutationID != nil && payload.targetMutationID != id &&
                payload.resurfaceAt == nil && payload.reviewAt == nil && payload.waitingOn == nil
        }
    }

    /// Use only when creating a new local command, not when retrying a persisted one.
    public func validForEnqueue(at now: Date = Date()) -> Bool {
        guard valid, Self.validDate(now) else { return false }
        if let issuedAt, issuedAt > now.addingTimeInterval(300) { return false }
        if let date = payload?.resurfaceAt, date <= now { return false }
        if let date = payload?.reviewAt, date <= now { return false }
        return true
    }

    private enum CodingKeys: String, CodingKey {
        case id, taskID, expectedVersion, status, intent, issuedAt, payload
    }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(UUID.self, forKey: .id)
        taskID = try c.decode(String.self, forKey: .taskID)
        expectedVersion = try c.decode(Int.self, forKey: .expectedVersion)
        status = try c.decode(String.self, forKey: .status)
        intent = try c.decodeIfPresent(SyncTaskIntent.self, forKey: .intent)
        issuedAt = try c.decodeIfPresent(Date.self, forKey: .issuedAt)
        payload = try c.decodeIfPresent(SyncTaskActionPayload.self, forKey: .payload)
        guard valid else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath,
                debugDescription: "Invalid task action contract"))
        }
    }
}
public struct SyncTaskActionReceipt:Codable,Sendable,Equatable {
    public var id:UUID
    public var outcome:String
    public init(id:UUID,outcome:String){self.id=id;self.outcome=outcome}
}
public struct SyncDeviceTaskAction:Codable,Sendable,Equatable {
    public var deviceID:UUID
    public var action:SyncTaskAction
    public init(deviceID:UUID,action:SyncTaskAction){self.deviceID=deviceID;self.action=action}
}
