import Foundation

/// Source captures are distinct from the narrow, versioned task-action command channel.
/// No provider settings, credentials, or arbitrary remote commands are transported.
public struct SyncCapture: Codable, Sendable, Equatable {
    public var id: UUID
    public var text: String
    public var createdAt: Date
    public init(id:UUID,text:String,createdAt:Date){self.id=id;self.text=text;self.createdAt=createdAt}
}
public struct SyncRequest: Codable, Sendable {
    public var version = 1
    public var deviceID: UUID
    public var operation: String
    public var captures: [SyncCapture]
    public init(deviceID:UUID,operation:String,captures:[SyncCapture]=[]){self.deviceID=deviceID;self.operation=operation;self.captures=captures}
}
public struct SyncTaskActionState: Codable, Sendable, Equatable {
    public var resurfaceAt:Date?
    public var reviewAt:Date?
    public var waitingOn:String?
    public var lastMutationScope:String
    public var lastMutationID:String
    public var lastAction:String
    public var canUndo:Bool
    public init(resurfaceAt:Date?,reviewAt:Date?,waitingOn:String?,lastMutationScope:String,lastMutationID:String,lastAction:String,canUndo:Bool) {
        self.resurfaceAt=resurfaceAt;self.reviewAt=reviewAt;self.waitingOn=waitingOn
        self.lastMutationScope=lastMutationScope;self.lastMutationID=lastMutationID;self.lastAction=lastAction;self.canUndo=canUndo
    }
}
public struct SyncTask: Codable, Sendable, Equatable {
    public var id: String
    public var title: String
    public var status: String
    public var activities: [String]
    public var activityIDs:[String]?
    public var actionState:SyncTaskActionState?
    public var due: String?
    /// Absolute deadline boundary; phone reply encodes ISO8601 for the shared action UI.
    public var dueAt:Date?
    public var version:Int?
    public var detail:String?
    public var assignee:String?
    public init(id:String,title:String,status:String,activities:[String],due:String?){self.id=id;self.title=title;self.status=status;self.activities=activities;self.due=due}
}
public struct SyncState: Codable, Sendable, Equatable {
    public var property: String
    public var status: String
    public var value: String?
    public init(property:String,status:String,value:String?){self.property=property;self.status=status;self.value=value}
}
public struct SyncActivity: Codable, Sendable, Equatable {
    public var id:String; public var name:String; public var kind:String; public var lifecycle:String; public var openTaskCount:Int
    public init(id:String,name:String,kind:String,lifecycle:String,openTaskCount:Int){self.id=id;self.name=name;self.kind=kind;self.lifecycle=lifecycle;self.openTaskCount=openTaskCount}
}
public struct SyncPerson: Codable, Sendable, Equatable {
    public var id:String; public var name:String; public var pinned:Bool; public var relationship:String
    public init(id:String,name:String,pinned:Bool,relationship:String){self.id=id;self.name=name;self.pinned=pinned;self.relationship=relationship}
}
public struct SyncResponse: Codable, Sendable {
    public var version = 1
    public var deviceID: UUID
    public var receivedIDs: [UUID]
    public var asOf: Date
    public var tasks: [SyncTask]
    public var states: [SyncState]
    public var activities:[SyncActivity]
    public var people:[SyncPerson]
    public var displayName:String?
    public var needsYouTotal:Int?
    public var waitingTotal:Int?
    public var laterTotal:Int?
    public var supportedTaskIntents:[String]?
    public init(deviceID:UUID,receivedIDs:[UUID],asOf:Date=Date(),tasks:[SyncTask]=[],states:[SyncState]=[],activities:[SyncActivity]=[],people:[SyncPerson]=[]){self.deviceID=deviceID;self.receivedIDs=receivedIDs;self.asOf=asOf;self.tasks=tasks;self.states=states;self.activities=activities;self.people=people}
    private enum CodingKeys:String,CodingKey {case version,deviceID,receivedIDs,asOf,tasks,states,activities,people,displayName,needsYouTotal,waitingTotal,laterTotal,supportedTaskIntents}
    public init(from decoder:Decoder)throws {
        let c=try decoder.container(keyedBy:CodingKeys.self)
        version=try c.decode(Int.self,forKey:.version);deviceID=try c.decode(UUID.self,forKey:.deviceID)
        receivedIDs=try c.decode([UUID].self,forKey:.receivedIDs);asOf=try c.decode(Date.self,forKey:.asOf)
        tasks=try c.decode([SyncTask].self,forKey:.tasks);states=try c.decode([SyncState].self,forKey:.states)
        activities=try c.decodeIfPresent([SyncActivity].self,forKey:.activities) ?? []
        people=try c.decodeIfPresent([SyncPerson].self,forKey:.people) ?? []
        displayName=try c.decodeIfPresent(String.self,forKey:.displayName)
        needsYouTotal=try c.decodeIfPresent(Int.self,forKey:.needsYouTotal)
        waitingTotal=try c.decodeIfPresent(Int.self,forKey:.waitingTotal)
        laterTotal=try c.decodeIfPresent(Int.self,forKey:.laterTotal)
        supportedTaskIntents=try c.decodeIfPresent([String].self,forKey:.supportedTaskIntents)
    }
}
public enum SyncCodec {
    public static func encode<T:Encodable>(_ value:T)throws->Data {let encoder=JSONEncoder();encoder.dateEncodingStrategy = .millisecondsSince1970;return try encoder.encode(value)}
    public static func decode<T:Decodable>(_ type:T.Type,from data:Data)throws->T {let decoder=JSONDecoder();decoder.dateDecodingStrategy = .millisecondsSince1970;return try decoder.decode(type,from:data)}
}
