import Foundation

public enum ActivityKind: String, Codable, Sendable { case area, pursuit }
public enum ActivityLifecycle: String, Codable, Sendable { case active, paused, completed, archived }
public enum TaskStatus: String, Codable, Sendable {
    case open, in_progress, waiting, completed, cancelled
    public var terminal: Bool { self == .completed || self == .cancelled }
}
public struct LifeActivity: Codable, Sendable, Equatable {
    public var id = UUID().uuidString
    public let ownerID = "local"
    public var name = ""
    public var purpose = ""
    public var kind: ActivityKind = .area
    public var lifecycle: ActivityLifecycle = .active
    public var version = 0
    public var createdAt = Date()
    public var updatedAt = Date()
    public init() {}
}
public struct DueSpec: Codable, Sendable, Equatable {
    public enum Kind: String, Codable, Sendable { case date, instant }
    public var kind: Kind = .date
    public var date = "" // ISO calendar date, never coerced to midnight in UI.
    public var instant: Date?
    public var timeZone = TimeZone.current.identifier
    public init() {}
    public func boundary(endOfDay: Bool = false) throws -> Date {
        guard let zone = TimeZone(identifier: timeZone) else { throw MapleError.invalid("Choose a valid time zone.") }
        if kind == .instant { guard let instant else { throw MapleError.invalid("Missing due time.") }; return instant }
        let parts = date.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3, date.count == 10 else { throw MapleError.invalid("Use a YYYY-MM-DD date.") }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = zone
        guard let start = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])),
              calendar.component(.year, from: start) == parts[0], calendar.component(.month, from: start) == parts[1], calendar.component(.day, from: start) == parts[2] else { throw MapleError.invalid("Invalid calendar date.") }
        return endOfDay ? calendar.date(byAdding: .day, value: 1, to: start)! : start
    }
}
public struct RelevanceCondition: Codable, Sendable, Equatable {
    public var subject = "person:self"
    public var property = "presence"
    public var value = ""
    public init() {}
}
public struct LifeTask: Codable, Sendable, Equatable {
    public var id = UUID().uuidString
    public let ownerID = "local"
    public var title = ""
    public var description = ""
    public var status: TaskStatus = .open
    public var waitingReason = ""
    public var assignee = "" // Private label; never sends a notification.
    public var due: DueSpec?
    public var scheduled: DueSpec?
    public var place = ""
    public var people: [String] = []
    public var priority = 0
    public var conditions: [RelevanceCondition] = []
    public var evidenceIDs: [String] = []
    public var activityIDs: [String] = []
    public var seriesID: String?
    public var occurrenceKey: String?
    public var completedAt: Date?
    public var version = 0
    public var createdAt = Date()
    public var updatedAt = Date()
    public init() {}
}
public struct WorldHistory: Codable, Sendable {
    public var id = UUID().uuidString
    public var sequence: Int64 = 0
    public var subjects: [String]
    public var type: String
    public var effectiveAt: Date
    public var recordedAt: Date
    public var actor = "user"
    public var before: String?
    public var after: String?
    public var correlationID: String
}
public struct StateProperty: Codable, Sendable {
    public var key: String
    public var label: String
    public var lens: String
    public var ttl: TimeInterval?
    public var durable: Bool
    public var valueType = "text"
    public static let catalog: [StateProperty] = [
        .init(key:"presence",label:"Location / presence",lens:"Me",ttl:900,durable:false),
        .init(key:"currentBehavior",label:"Right now",lens:"Me",ttl:900,durable:false),
        .init(key:"availability",label:"Availability",lens:"Me",ttl:900,durable:false),
        .init(key:"socialContext",label:"Social context",lens:"Me",ttl:900,durable:false),
        .init(key:"travel",label:"Travel",lens:"Me",ttl:86400,durable:false),
        .init(key:"focus",label:"Focus",lens:"Me",ttl:900,durable:false),
        .init(key:"relationship",label:"Relationship",lens:"People",ttl:nil,durable:true),
        .init(key:"occupancy",label:"Occupancy",lens:"Home",ttl:300,durable:false),
        .init(key:"homeMode",label:"Home mode",lens:"Home",ttl:300,durable:false),
        .init(key:"security",label:"Security",lens:"Home",ttl:300,durable:false),
        .init(key:"climate",label:"Climate",lens:"Home",ttl:300,durable:false),
        .init(key:"employment",label:"Employment",lens:"Work",ttl:nil,durable:true),
        .init(key:"role",label:"Role",lens:"Work",ttl:nil,durable:true),
        .init(key:"projects",label:"Current projects",lens:"Work",ttl:nil,durable:true),
        .init(key:"responsibilities",label:"Responsibilities",lens:"Work",ttl:nil,durable:true),
        .init(key:"milestone",label:"Current state",lens:"Activities",ttl:nil,durable:true)
    ]
}
public struct WorldStateClaim: Codable, Sendable, Equatable {
    public var id = UUID().uuidString
    public var subject = "person:self"
    public var property = "currentBehavior"
    public var value = ""
    public var origin = "user-confirmed"
    public var confidence: Double?
    public var evidenceIDs: [String] = []
    public var observedAt = Date()
    public var ingestedAt = Date()
    public var validFrom = Date()
    public var validUntil: Date?
    public var retracted = false
    public var sourceAvailable = true
    public var sourceQuote: String?
    public var provider: String?
    public var sourceKey: String?
    public var supersedes: String?
    public var version = 0
    public init() {}
}
public struct StateProjection: Codable, Sendable {
    public var subject: String
    public var property: String
    public var status: String // known, unknown, stale, conflicting
    public var value: String?
    public var candidates: [WorldStateClaim]
    public var reason: String
    public var revision: Int64
    public var asOf: Date
}
public struct TaskAttention: Codable, Sendable {
    public var id: String
    public var taskID: String
    public var taskVersion: Int
    public var category: String
    public var reasonCodes: [String]
    public var explanation: String
    public var rank: Int
    public var relevantAt: Date?
    public var stateIDs: [String]
}
public struct TaskSuggestion: Codable, Sendable {
    public var obligationIdentity: ObligationIdentity?
    public var obligation:String?
    public var actorID:String?
    public var sourceSubject: String?
    public var sourceSender: String?
    public var id = UUID().uuidString
    public var candidate = LifeTask()
    public var eventID = ""
    public var fingerprint = ""
    public var sourceKey = ""
    public var quote = ""
    public var provider = ""
    public var confidence: Double?
    public var deadlineExplanation = ""
    public var reviewStatus = "pending"
    public var acceptedTaskID: String?
    public var linkedTaskID: String?
    public var possibleDuplicateIDs: [String] = []
    public var version = 0
    public var createdAt = Date()
    public init() {}
}
public struct TaskSeries: Codable, Sendable {
    public var id = UUID().uuidString
    public var template = LifeTask()
    public var frequency = "weekly" // MVP supports daily and weekly, one local time.
    public var timeZone = TimeZone.current.identifier
    public var startDate = ""
    public var endDate: String?
    public var localTime = "07:45"
    public var paused = false
    public var version = 0
    public init() {}
}
public struct WorldSnapshot: Codable, Sendable {
    public var revision: Int64
    public var asOf: Date
    public var activities: [LifeActivity]
    public var tasks: [LifeTask]
    public var states: [StateProjection]
    public var suggestions: [TaskSuggestion]
    public var series: [TaskSeries]
    public var attention: [TaskAttention]
    public var history: [WorldHistory]
    public var taskRelations: [TaskRelation] = []
    public var taskProgress: [TaskProgressEvidence] = []
    public var reconciliationFailures: Int = 0
    public var activityEvidence: [ActivityLinkEvidence] = []
    public var discoveryFailures: Int = 0
    public var properties: [StateProperty] = StateProperty.catalog
}
