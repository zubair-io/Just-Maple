import Foundation

/// Read-only source preview transported inside the encrypted companion envelope.
public struct SyncSourceEvidence: Codable, Sendable, Equatable {
    public var id:String
    public var connector:String
    public var sender:String?
    public var subject:String?
    public var occurredAt:Date?
    public var content:String
    public var truncated:Bool
    public var available:Bool
    public init(id:String,connector:String,sender:String?=nil,subject:String?=nil,occurredAt:Date?=nil,content:String,truncated:Bool,available:Bool=true) {
        self.id=id;self.connector=connector;self.sender=sender;self.subject=subject;self.occurredAt=occurredAt
        self.content=content;self.truncated=truncated;self.available=available
    }
}
