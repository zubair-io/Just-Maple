import Foundation

/// Transport mirrors use epoch seconds, matching the daily-note bridge rather than SyncCodec dates.
public struct SyncDailySource: Codable, Sendable, Equatable {
    public var key: String
    public var eventID: String
    public var connector: String
    public var title: String?
    public var sender: String?
}
public struct SyncDailyBlock: Codable, Sendable, Equatable {
    public var id: String
    public var day: String
    public var kind: String
    public var content: String
    public var version: Int
    public var position: Int
    public var createdAt: Double
    public var updatedAt: Double
    public var actor: String
    public var userEdited: Bool
    public var clearedAt: Double?
    public var completedAt: Double?
    public var source: SyncDailySource?
    public var taskNodeID: String?
    public var taskVersion: Int?
    public var valid: Bool {
        !id.isEmpty && id.utf8.count <= 256 && SyncDailyMutation.validDay(day, zone: "UTC") &&
        SyncDailyMutation.kinds.contains(kind) && content.utf8.count <= 65_536 && version > 0 &&
        createdAt.isFinite && updatedAt.isFinite && (clearedAt?.isFinite ?? true) &&
        (completedAt?.isFinite ?? true) && ["user", "bot"].contains(actor)
    }
}
public struct SyncDailyProjection: Codable, Sendable, Equatable {
    public var remainingTasks:Int
    public init(remainingTasks:Int) {self.remainingTasks=remainingTasks}
}
public struct SyncDailyNote: Codable, Sendable, Equatable {
    public var day: String
    public var timeZone: String
    public var blocks: [SyncDailyBlock]
    public var cleared: [SyncDailyBlock]
    public var revision: Int64
    public var partial: Bool?
    public var readOnly: Bool?
    public var projection: SyncDailyProjection?
    public var valid: Bool {
        SyncDailyMutation.validDay(day, zone: timeZone) && blocks.count + cleared.count <= 500 &&
        (blocks + cleared).allSatisfy { $0.valid && $0.day == day } &&
        Set((blocks + cleared).map(\.id)).count == blocks.count + cleared.count
    }
}
public struct SyncDailyMutation: Codable, Sendable, Equatable {
    public var kind: String
    public var blockID: String
    public var expectedVersion: Int
    public var requestID: String
    public var day: String
    public var timeZone: String
    public var content: String?
    public var blockKind: String?
    public var targetDay: String?
    public var position: Int?
    public init(kind: String, blockID: String, expectedVersion: Int, requestID: String, day: String, timeZone: String, content: String? = nil, blockKind: String? = nil, targetDay: String? = nil, position: Int? = nil) {
        self.kind=kind; self.blockID=blockID; self.expectedVersion=expectedVersion; self.requestID=requestID
        self.day=day; self.timeZone=timeZone; self.content=content; self.blockKind=blockKind; self.targetDay=targetDay; self.position=position
    }
    public static let kinds = ["text", "heading", "task", "email", "message", "code"]
    public static func validDay(_ value: String, zone: String) -> Bool {
        guard value.utf8.count == 10, let timeZone = TimeZone(identifier: zone),
              value.range(of: #"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"#, options: .regularExpression) != nil else { return false }
        let formatter=DateFormatter(); formatter.locale=Locale(identifier:"en_US_POSIX")
        formatter.calendar=Calendar(identifier:.gregorian); formatter.timeZone=timeZone; formatter.dateFormat="yyyy-MM-dd"; formatter.isLenient=false
        return formatter.date(from:value).map { formatter.string(from:$0) == value } ?? false
    }
    public var valid: Bool {
        ["create", "edit", "clear", "restore", "move", "complete"].contains(kind) &&
        !blockID.isEmpty && blockID.utf8.count <= 256 && expectedVersion >= 0 && (position.map { (0...1_000_000).contains($0) } ?? true) &&
        UUID(uuidString:requestID) != nil && validDay && (content?.utf8.count ?? 0) <= 65_536 &&
        (blockKind.map { Self.kinds.contains($0) } ?? true) &&
        (targetDay.map { Self.validDay($0,zone:timeZone) } ?? true) &&
        (kind != "create" || expectedVersion == 0 && content != nil && blockKind != nil) &&
        (kind != "edit" || content != nil || position != nil || blockKind != nil) && (kind != "move" || targetDay != nil)
    }
    private var validDay: Bool { Self.validDay(day,zone:timeZone) }
}
public struct SyncDailyAction: Codable, Sendable, Equatable {
    public var id: UUID
    public var mutation: SyncDailyMutation
    public init(mutation: SyncDailyMutation) { self.id=UUID(uuidString:mutation.requestID) ?? UUID(); self.mutation=mutation }
    public var valid: Bool { mutation.valid && UUID(uuidString:mutation.requestID) == id && ((try? JSONEncoder().encode(self).count) ?? Int.max) <= 230_000 }
}
public struct SyncDeviceDailyAction: Codable, Sendable, Equatable {
    public var deviceID: UUID
    public var action: SyncDailyAction
    public init(deviceID:UUID,action:SyncDailyAction) { self.deviceID=deviceID;self.action=action }
}
public struct SyncDailyReceipt: Codable, Sendable, Equatable {
    public var id: UUID
    public var outcome: String
    public var resultingRevision: Int64?
    public init(id:UUID,outcome:String,resultingRevision:Int64?=nil) { self.id=id;self.outcome=outcome;self.resultingRevision=resultingRevision }
    public var valid: Bool { ["applied", "conflict", "unsupported"].contains(outcome) && (resultingRevision.map{$0>=0} ?? true) }
}
