import Foundation

public struct SyncGroupContext: Codable, Sendable, Equatable {
    public var intentID:String;public var actorID:String;public var targetID:String
    public var connector:String;public var account:String;public var sourceScopeID:String
    public init(intentID:String,actorID:String,targetID:String,connector:String,account:String,sourceScopeID:String){self.intentID=intentID;self.actorID=actorID;self.targetID=targetID;self.connector=connector;self.account=account;self.sourceScopeID=sourceScopeID}
}
public struct SyncGroupChild: Codable, Sendable, Equatable {
    public var nodeID:String;public var expectedVersion:Int
    public init(nodeID:String,expectedVersion:Int){self.nodeID=nodeID;self.expectedVersion=expectedVersion}
}
public struct SyncGroupReview: Codable, Sendable, Equatable {
    public var id:String;public var context:SyncGroupContext;public var maximumSpan:Double;public var children:[SyncGroupChild]
    public init(id:String,context:SyncGroupContext,maximumSpan:Double,children:[SyncGroupChild]){self.id=id;self.context=context;self.maximumSpan=maximumSpan;self.children=children}
    public var valid:Bool {
        !id.isEmpty && id.utf8.count<=256 && maximumSpan.isFinite && maximumSpan>0 && (2...100).contains(children.count) && Set(children.map(\.nodeID)).count==children.count &&
        children.allSatisfy{$0.expectedVersion>0 && $0.nodeID.utf8.count<=1024 && (($0.nodeID.hasPrefix("task:") && $0.nodeID.count>5) || ($0.nodeID.hasPrefix("source:") && $0.nodeID.count>7))} &&
        [context.intentID,context.actorID,context.targetID,context.connector,context.account,context.sourceScopeID].allSatisfy{!$0.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty && $0.utf8.count<=1024}
    }
}
public struct SyncReviewedGroup: Codable, Sendable, Equatable {
    public var review:SyncGroupReview
    /// Display labels only. Identity and concurrency come exclusively from review.children.
    public var titles:[String:String]
    public init(review:SyncGroupReview,titles:[String:String]){self.review=review;self.titles=titles}
}
public enum SyncGroupIntent:String,Codable,Sendable,CaseIterable {case done,notNeeded,undo}
public struct SyncGroupAction: Codable, Sendable, Equatable {
    public var id:UUID;public var intent:SyncGroupIntent;public var issuedAt:Date
    public var review:SyncGroupReview?;public var targetMutationID:UUID?
    public init(id:UUID=UUID(),intent:SyncGroupIntent,issuedAt:Date=Date(),review:SyncGroupReview?=nil,targetMutationID:UUID?=nil){self.id=id;self.intent=intent;self.issuedAt=SyncWireDate.normalized(issuedAt);self.review=review;self.targetMutationID=targetMutationID}
    public var valid:Bool {
        guard issuedAt.timeIntervalSince1970.isFinite,issuedAt.timeIntervalSince1970>=0 else{return false}
        return intent == .undo ? review==nil && targetMutationID != nil && targetMutationID != id : review?.valid==true && targetMutationID==nil
    }
}
public struct SyncGroupChildResult:Codable,Sendable,Equatable {
    public var nodeID:String;public var version:Int;public var mutationID:String
    public init(nodeID:String,version:Int,mutationID:String){self.nodeID=nodeID;self.version=version;self.mutationID=mutationID}
}
public struct SyncGroupActionReceipt:Codable,Sendable,Equatable {
    public var id:UUID;public var outcome:String;public var children:[SyncGroupChildResult]?
    public init(id:UUID,outcome:String,children:[SyncGroupChildResult]?=nil){self.id=id;self.outcome=outcome;self.children=children}
    public var valid:Bool {
        guard ["applied","conflict","unsupported"].contains(outcome) else{return false}
        guard outcome=="applied" else{return children==nil}
        guard let children,(2...100).contains(children.count),Set(children.map(\.nodeID)).count==children.count else{return false}
        return children.allSatisfy{$0.version>0 && !$0.nodeID.isEmpty && $0.nodeID.utf8.count<=1024 && !$0.mutationID.isEmpty && $0.mutationID.utf8.count<=256}
    }
}
public struct SyncDeviceGroupAction:Codable,Sendable,Equatable {
    public var deviceID:UUID;public var action:SyncGroupAction
    public init(deviceID:UUID,action:SyncGroupAction){self.deviceID=deviceID;self.action=action}
}
