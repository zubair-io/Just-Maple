import Foundation

public enum MapleError: Error, LocalizedError, Sendable {
    case invalid(String)
    case database(String)
    case provider(String)

    public var errorDescription: String? {
        switch self {
        case .invalid(let message), .database(let message), .provider(let message): message
        }
    }
}

public struct Source: Codable, Sendable, Equatable {
    public let connector: String
    public let account: String
    public let externalID: String
    public let revision: String
    public let timeZone: String?
    public init(connector: String, account: String, externalID: String, revision: String, timeZone:String? = nil) {
        self.connector = connector; self.account = account
        self.externalID = externalID; self.revision = revision; self.timeZone = timeZone
    }
}

public struct Event: Codable, Sendable, Equatable {
    public let id: String
    public let type: String
    public let source: Source
    public let occurredAt: Date
    public let receivedAt: Date
    public let subjects: [String]
    public let content: String

    public init(id: String = UUID().uuidString, type: String, source: Source,
                occurredAt: Date, receivedAt: Date = Date(), subjects: [String], content: String) {
        self.id = id; self.type = type; self.source = source
        self.occurredAt = occurredAt; self.receivedAt = receivedAt
        self.subjects = subjects; self.content = content
    }

    func validate() throws {
        let fields = [id, type, source.connector, source.account, source.externalID, source.revision]
        guard fields.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.utf8.count <= 1024 }),
              !content.isEmpty, content.utf8.count <= 256_000,
              !subjects.isEmpty, subjects.count <= 32,
              subjects.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 256 }),
              occurredAt.timeIntervalSince1970.isFinite, receivedAt.timeIntervalSince1970.isFinite else {
            throw MapleError.invalid("Invalid event: provide source identity, subjects and bounded content.")
        }
    }
}

public struct Claim: Codable, Sendable, Equatable {
    public let id: String
    public let subject: String
    public let predicate: String
    public let value: String
    public let evidenceEventID: String
    public let observedAt: Date
    public let confidence: Double
    public let origin: String
}

public struct Context: Codable, Sendable {
    public let event: Event
    public let currentState: [Claim]
    public let recentEvents: [Event]
    public let relatedEvidence: [Event]
    public let version: String
    public var sourceFacts: [SourceFact]? = nil
    public var world: ReasoningWorldContext? = nil
}

public enum JobStage: String, Codable, Sendable, CaseIterable {
    case unchanged, searching, interviewing, offerReceived = "offer_received"
    case offerAccepted = "offer_accepted", closed, uncertain
}

public struct Assessment: Codable, Sendable {
    public let notify: Double
    public let askUser: Double
    public let reason: Double
    public let summarize: Double
    public let jobStage: JobStage
    public let stageConfidence: Double
    public let model: String
    public let provider: String
    public let message: MessageAssessment?
    public let containsFacts: Double?

    public init(notify: Double, askUser: Double, reason: Double, summarize: Double,
                jobStage: JobStage, stageConfidence: Double, model: String, provider: String, message: MessageAssessment? = nil, containsFacts: Double? = nil) {
        self.notify = notify; self.askUser = askUser; self.reason = reason
        self.summarize = summarize; self.jobStage = jobStage; self.stageConfidence = stageConfidence
        self.model = model; self.provider = provider
        self.message = message
        self.containsFacts = containsFacts
    }

    func validate() throws {
        try message?.validate()
        if let containsFacts, !containsFacts.isFinite || !(0...1).contains(containsFacts) {
            throw MapleError.provider("Invalid fact relevance probability.")
        }
        guard [notify, askUser, reason, summarize, stageConfidence].allSatisfy({ $0.isFinite && (0...1).contains($0) }),
              !model.isEmpty, !provider.isEmpty else {
            throw MapleError.provider("Classifier returned invalid probabilities or provenance.")
        }
    }
}

public struct ClassifierResult: Sendable {
    public let assessment: Assessment
    public let rawResponse: Data
    public let inputContext: Context?
    public init(assessment: Assessment, rawResponse: Data, inputContext: Context? = nil) {
        self.assessment = assessment; self.rawResponse = rawResponse; self.inputContext = inputContext
    }
}

public protocol Classifier: Sendable {
    func classify(_ context: Context) async throws -> ClassifierResult
}

public enum Route: String, Codable, Sendable {
    case retain, summarize, reason, askUser = "ask_user", notify
}

public struct Decision: Codable, Sendable {
    public let eventID: String
    public let route: Route
    public let assessment: Assessment
    public let context: Context
    public let explanation: [String]
    public let policyVersion: String
    public let createdAt: Date
}

public struct WorkItem: Codable, Sendable {
    public let id: String
    public let eventID: String
    public let kind: String
    public let status: String
}

public struct QueueItem: Codable, Sendable {
    public let eventID: String
    public let status: String
    public let attempts: Int
    public let nextAttemptAt: Date
    public let error: String?
}

public enum JSONCodec {
    public static func encode<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .secondsSince1970
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(value)
    }
    public static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        let decoder = JSONDecoder(); decoder.dateDecodingStrategy = .secondsSince1970
        return try decoder.decode(type, from: data)
    }
    static func string<T: Encodable>(_ value: T) throws -> String {
        String(decoding: try encode(value), as: UTF8.self)
    }
}

public struct ReasoningWorldContext: Codable, Sendable {
    public var asOf: Date
    public var activities: [LifeActivity]
    public var tasks: [LifeTask]
    public var states: [StateProjection]
}
