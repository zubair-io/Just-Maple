import Foundation

public enum DailyBlockKind: String, Codable, Sendable, CaseIterable { case text, heading, task, email, message, code }
public enum DailyBlockActor: String, Codable, Sendable { case user, bot }
public enum DailyBlockMutationKind: String, Codable, Sendable { case create, edit, clear, restore, move, complete }

public struct DailyBlockSource: Codable, Sendable, Equatable {
    public var key: String
    public var eventID: String
    public var connector: String
    public var title: String?
    public var sender: String?
    public init(key: String, eventID: String, connector: String, title: String? = nil, sender: String? = nil) {
        self.key = key; self.eventID = eventID; self.connector = connector; self.title = title; self.sender = sender
    }
}

public struct DailyBlock: Codable, Sendable, Equatable {
    public var id: String
    public var day: String
    public var kind: DailyBlockKind
    public var content: String
    public var version: Int
    public var position: Int
    public var createdAt: Date
    public var updatedAt: Date
    public var actor: DailyBlockActor
    public var userEdited: Bool
    public var clearedAt: Date?
    public var completedAt: Date?
    public var source: DailyBlockSource?
    public var taskNodeID: String?
    public var taskVersion: Int?
    public init(id: String = UUID().uuidString, day: String, kind: DailyBlockKind, content: String, version: Int = 1, position: Int = 0, createdAt: Date = Date(), updatedAt: Date = Date(), actor: DailyBlockActor = .user, userEdited: Bool = false, clearedAt: Date? = nil, completedAt: Date? = nil, source: DailyBlockSource? = nil, taskNodeID: String? = nil, taskVersion: Int? = nil) {
        self.id = id; self.day = day; self.kind = kind; self.content = content; self.version = version; self.position = position
        self.createdAt = createdAt; self.updatedAt = updatedAt; self.actor = actor; self.userEdited = userEdited
        self.clearedAt = clearedAt; self.completedAt = completedAt; self.source = source; self.taskNodeID = taskNodeID; self.taskVersion = taskVersion
    }
}

public struct DailyNoteSnapshot: Codable, Sendable, Equatable {
    public let day: String
    public let timeZone: String
    public let blocks: [DailyBlock]
    public let cleared: [DailyBlock]
    public let revision: Int64
}

public struct DailyBlockMutation: Codable, Sendable {
    public var kind: DailyBlockMutationKind
    public var blockID: String
    public var expectedVersion: Int
    public var requestID: String
    public var day: String
    public var timeZone: String
    public var content: String?
    public var blockKind: DailyBlockKind?
    public var targetDay: String?
    public var position: Int?
    public init(kind: DailyBlockMutationKind, blockID: String, expectedVersion: Int, requestID: String, day: String, timeZone: String, content: String? = nil, blockKind: DailyBlockKind? = nil, targetDay: String? = nil, position: Int? = nil) {
        self.kind = kind; self.blockID = blockID; self.expectedVersion = expectedVersion; self.requestID = requestID
        self.day = day; self.timeZone = timeZone; self.content = content; self.blockKind = blockKind; self.targetDay = targetDay; self.position = position
    }
}
