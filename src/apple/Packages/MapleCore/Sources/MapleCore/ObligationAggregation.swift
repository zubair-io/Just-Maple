import Foundation
import CryptoKit

/// These are validated semantic identifiers, never display names, inferred titles,
/// or Activity tags. Callers must obtain explicit review/reconciliation first.
public struct ObligationAggregationContext: Codable, Sendable, Equatable {
    public var intentID: String
    public var actorID: String
    public var targetID: String
    public var connector: String
    public var account: String
    public var sourceScopeID: String
    public init(intentID:String,actorID:String,targetID:String,connector:String,account:String,sourceScopeID:String) {
        self.intentID=intentID;self.actorID=actorID;self.targetID=targetID
        self.connector=connector;self.account=account;self.sourceScopeID=sourceScopeID
    }
}
public struct ObligationAggregationValidation: Codable, Sendable {
    public enum Authority: String, Codable, Sendable { case userReview, validatedReconciliation }
    public var authority: Authority
    public var provenanceID: String
    public var evidenceIDs: [String]
    public init(authority:Authority,provenanceID:String,evidenceIDs:[String]) {
        self.authority=authority;self.provenanceID=provenanceID;self.evidenceIDs=evidenceIDs
    }
}
public struct ObligationGroupChild: Codable, Sendable, Equatable {
    public let nodeID: String
    public let expectedVersion: Int
    public init(nodeID:String,expectedVersion:Int) {self.nodeID=nodeID;self.expectedVersion=expectedVersion}
}
public struct ObligationGroupReview: Codable, Sendable {
    public let id: String
    public let context: ObligationAggregationContext
    public let maximumSpan: TimeInterval
    public let children: [ObligationGroupChild]
    public var unresolvedCount: Int { children.count }
}
public struct ObligationGroupActionResult: Codable, Sendable {
    public let mutationID: String
    public let children: [TaskActionResult]
}
private struct AggregationRecord: Codable {
    let nodeID: String
    let version: Int
    let context: ObligationAggregationContext
    let validation: ObligationAggregationValidation
    let occurredAt: Date
}

extension SQLite {
    func migrateObligationAggregation() throws {
        try migrateObligationGroupingProposals()
        try execute("CREATE TABLE IF NOT EXISTS obligation_aggregation (id TEXT PRIMARY KEY,json TEXT NOT NULL)")
        try execute("CREATE TABLE IF NOT EXISTS obligation_group_reviews (id TEXT PRIMARY KEY,json TEXT NOT NULL)")
        try execute("CREATE TABLE IF NOT EXISTS obligation_group_mutations (id TEXT PRIMARY KEY,scope TEXT NOT NULL,result TEXT NOT NULL,undone_by TEXT)")
    }
}
private func aggregationDigest(_ value:String) -> String {
    SHA256.hash(data:Data(value.utf8)).map { String(format:"%02x",$0) }.joined()
}
extension KnowledgeStore {
    /// No existing source currently establishes all these fields. Until a trusted
    /// caller supplies validation, groups remain empty rather than guessing.
    public func validateObligationAggregation(nodeID:String,expectedVersion:Int,context:ObligationAggregationContext,
        validation:ObligationAggregationValidation,requestID:String,at:Date=Date()) throws {
        _ = try command("aggregation-validation:"+requestID,payload:JSONCodec.string([
            "node":nodeID,"version":String(expectedVersion),"context":try JSONCodec.string(context),"validation":try JSONCodec.string(validation)
        ])) { () throws -> Bool in
            for value in [nodeID,context.intentID,context.actorID,context.targetID,context.connector,context.account,context.sourceScopeID,validation.provenanceID] {
                try validateText(value,max:512,required:true)
            }
            guard !validation.evidenceIDs.isEmpty,validation.evidenceIDs.count<=50,
                  Set(validation.evidenceIDs).count==validation.evidenceIDs.count,
                  let task=try taskNode(nodeID),try nodeVersion(nodeID)==expectedVersion,!task.status.terminal else {
                throw MapleError.invalid("Review a current unresolved obligation with supporting evidence.")
            }
            try requireAggregationRoot(nodeID)
            let supported=Set(task.evidenceIDs + (try sourceEventID(nodeID).map { [$0] } ?? []))
            var dates=[Date]()
            for id in validation.evidenceIDs {
                guard supported.contains(id),let evidence=try event(id),
                      evidence.source.connector==context.connector,evidence.source.account==context.account,
                      (context.sourceScopeID.hasPrefix("thread:") && evidence.subjects.contains(context.sourceScopeID)) || evidence.source.externalID==context.sourceScopeID else {
                    throw MapleError.invalid("Aggregation evidence does not support this obligation and source scope.")
                }
                dates.append(evidence.occurredAt)
            }
            let record=AggregationRecord(nodeID:nodeID,version:expectedVersion,context:context,validation:validation,occurredAt:dates.min()!)
            try db.execute("INSERT INTO obligation_aggregation VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json",[nodeID,try JSONCodec.string(record)])
            try history(subjects:[nodeID],type:"obligation.grouping_validated",before:Optional<AggregationRecord>.none,after:record,command:requestID,at:at)
            return true
        }
    }
    /// Desktop review entry: source scope is derived from actual evidence; only
    /// semantics are asserted by the user. Entire review is committed atomically.
    public func createReviewedObligationGroup(children:[ObligationGroupChild],intent:String,actor:String,target:String,maximumSpan:TimeInterval,requestID:String,at:Date=Date()) throws -> ObligationGroupReview {
        let key="aggregation-review:"+requestID
        return try command(key,payload:JSONCodec.string(["children":JSONCodec.string(children),"intent":intent,"actor":actor,"target":target,"window":String(maximumSpan)])) {
            for value in [intent,actor,target] {try validateText(value,max:256,required:true)}
            guard children.count>=2,children.count<=100,Set(children.map(\.nodeID)).count==children.count,maximumSpan.isFinite,maximumSpan>0 else {throw MapleError.invalid("Select 2–100 tasks and choose a positive grouping window.")}
            var evidenceByChild=[[Event]](), shared:Set<String>?
            var scopes=[String:(String,String,String)]()
            for child in children {
                guard let task=try taskNode(child.nodeID),!task.status.terminal,try nodeVersion(child.nodeID)==child.expectedVersion else {throw MapleError.invalid("A selected task changed. Review your selection again.")}
                try requireAggregationRoot(child.nodeID)
                let ids=Set(task.evidenceIDs+(try sourceEventID(child.nodeID).map{[$0]} ?? []))
                let events=try ids.compactMap{try event($0)}
                var available=Set<String>()
                for event in events {
                    for scope in event.subjects.filter({$0.hasPrefix("thread:")})+[event.source.externalID] {
                        let encoded=try JSONCodec.string([event.source.connector,event.source.account,scope])
                        available.insert(encoded);scopes[encoded]=(event.source.connector,event.source.account,scope)
                    }
                }
                shared=shared.map{$0.intersection(available)} ?? available;evidenceByChild.append(events)
            }
            let choices=(shared ?? []).sorted()
            guard let selected=choices.first(where:{scopes[$0]!.2.hasPrefix("thread:")}) ?? choices.first,let scope=scopes[selected] else {
                throw MapleError.invalid("These tasks do not share a source conversation or message in one account. Select related tasks from the same conversation; tasks without source evidence cannot be grouped yet.")
            }
            let context=ObligationAggregationContext(intentID:intent.trimmingCharacters(in:.whitespacesAndNewlines),actorID:actor.trimmingCharacters(in:.whitespacesAndNewlines),targetID:target.trimmingCharacters(in:.whitespacesAndNewlines),connector:scope.0,account:scope.1,sourceScopeID:scope.2)
            var records=[AggregationRecord]()
            for (index,child) in children.enumerated() {
                let evidence=evidenceByChild[index].filter{$0.source.connector==scope.0 && $0.source.account==scope.1 && (($0.subjects.contains(scope.2) && scope.2.hasPrefix("thread:")) || $0.source.externalID==scope.2)}
                records.append(AggregationRecord(nodeID:child.nodeID,version:child.expectedVersion,context:context,validation:ObligationAggregationValidation(authority:.userReview,provenanceID:requestID,evidenceIDs:evidence.map(\.id).sorted()),occurredAt:evidence.map(\.occurredAt).min()!))
            }
            let dates=records.map(\.occurredAt)
            guard dates.max()!.timeIntervalSince(dates.min()!)<=maximumSpan else {throw MapleError.invalid("The selected sources span longer than your grouping window. Choose fewer tasks or adjust the window.")}
            for record in records {
                try db.execute("INSERT INTO obligation_aggregation VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json",[record.nodeID,try JSONCodec.string(record)])
            }
            let review=ObligationGroupReview(id:aggregationDigest(key),context:context,maximumSpan:maximumSpan,children:children)
            try db.execute("INSERT INTO obligation_group_reviews VALUES (?,?)",[review.id,try JSONCodec.string(review)])
            try history(subjects:children.map(\.nodeID),type:"obligation.group_reviewed",before:Optional<ObligationGroupReview>.none,after:review,command:requestID,at:at)
            return review
        }
    }
    private func sourceEventID(_ nodeID:String) throws -> String? {
        guard nodeID.hasPrefix("source:") else { return nil }
        return try record("task_suggestions",id:String(nodeID.dropFirst(7)),as:TaskSuggestion.self)?.eventID
    }
    private func requireAggregationRoot(_ nodeID:String) throws {
        if nodeID.hasPrefix("task:"),try taskNode(nodeID) != nil,try reconciliationRoot(nodeID,relations:taskRelations())==nodeID { return }
        guard nodeID.hasPrefix("source:"),let source=try record("task_suggestions",id:String(nodeID.dropFirst(7)),as:TaskSuggestion.self),
              source.reviewStatus=="pending",obligationRoot(source,relations:try taskRelations())==nodeID else {
            throw MapleError.invalid("Review the current canonical obligation before grouping.")
        }
    }
    /// Explicit duration, anchored at the earliest child's source timestamp; it is
    /// not a rolling/transitive window that can grow without bound.
    public func obligationGroups(maximumSpan:TimeInterval) throws -> [ObligationGroupReview] {
        guard maximumSpan.isFinite,maximumSpan>0 else {throw MapleError.invalid("Configure a finite positive grouping window.")}
        let records=try records("obligation_aggregation",as:AggregationRecord.self).filter { record in
            guard let task=try taskNode(record.nodeID),!task.status.terminal,try nodeVersion(record.nodeID)==record.version else {return false}
            return (try? requireAggregationRoot(record.nodeID)) != nil
        }
        let buckets=try Dictionary(grouping:records) { try JSONCodec.string($0.context) }
        var output=[ObligationGroupReview]()
        for key in buckets.keys.sorted() {
            let sorted=buckets[key]!.sorted { $0.occurredAt == $1.occurredAt ? $0.nodeID < $1.nodeID : $0.occurredAt < $1.occurredAt }
            var pending=[AggregationRecord]()
            func append() throws {
                guard pending.count>1 else {return}
                let children=pending.map {ObligationGroupChild(nodeID:$0.nodeID,expectedVersion:$0.version)}
                output.append(ObligationGroupReview(id:aggregationDigest(key+(try JSONCodec.string(children))+String(maximumSpan)),context:pending[0].context,maximumSpan:maximumSpan,children:children))
            }
            for record in sorted {
                if let first=pending.first, record.occurredAt.timeIntervalSince(first.occurredAt)>maximumSpan || pending.count>=100 {
                    try append();pending=[]
                }
                pending.append(record)
            }
            try append()
        }
        return output
    }
    /// Original user-reviewed membership only. Any changed child requires fresh
    /// review, including after undo; arrivals never join an existing review.
    public func reviewedObligationGroups() throws -> [ObligationGroupReview] {
        try records("obligation_group_reviews",as:ObligationGroupReview.self).filter { review in
            for child in review.children {
                guard let task=try taskNode(child.nodeID),!task.status.terminal,try nodeVersion(child.nodeID)==child.expectedVersion,
                      let validation=try record("obligation_aggregation",id:child.nodeID,as:AggregationRecord.self),validation.context==review.context,validation.version==child.expectedVersion,
                      (try? requireAggregationRoot(child.nodeID)) != nil else {return false}
            }
            return true
        }
    }
    private func groupKey(scope:String,requestID:String) throws -> String {
        try validateText(scope,max:256,required:true);try validateText(requestID,max:256,required:true)
        return "obligation-group:"+aggregationDigest(try JSONCodec.string([scope,requestID]))
    }
    /// Membership is exactly the reviewed list. Later arrivals are never selected.
    public func applyObligationGroupAction(review:ObligationGroupReview,change:TaskActionChange,requestID:String,scope:String,at:Date=Date()) throws -> ObligationGroupActionResult {
        guard change.kind != "undo" else {throw MapleError.invalid("Use the original group mutation to undo.")}
        let key=try groupKey(scope:scope,requestID:requestID)
        return try command(key,payload:JSONCodec.string(["review":JSONCodec.string(review),"change":JSONCodec.string(change)])) {
            guard review.children.count>=2,review.children.count<=100,review.maximumSpan.isFinite,review.maximumSpan>0,
                  Set(review.children.map(\.nodeID)).count==review.children.count else {throw MapleError.invalid("Invalid reviewed group.")}
            var dates=[Date]()
            for child in review.children {
                try requireAggregationRoot(child.nodeID)
                guard let record=try record("obligation_aggregation",id:child.nodeID,as:AggregationRecord.self),record.context==review.context,
                      record.version==child.expectedVersion,try nodeVersion(child.nodeID)==child.expectedVersion else {throw MapleError.invalid("Group changed. Review again before applying this action.")}
                dates.append(record.occurredAt)
            }
            guard dates.max()!.timeIntervalSince(dates.min()!)<=review.maximumSpan else {throw MapleError.invalid("Reviewed group exceeds its configured window.")}
            let results=try review.children.map { child in
                try applyTaskActionInTransaction(nodeID:child.nodeID,change:change,expectedVersion:child.expectedVersion,
                    requestID:aggregationDigest(key+child.nodeID),scope:scope,at:at)
            }
            let result=ObligationGroupActionResult(mutationID:requestID,children:results)
            try db.execute("INSERT INTO obligation_group_mutations(id,scope,result) VALUES (?,?,?)",[key,scope,try JSONCodec.string(result)])
            return result
        }
    }
    public func undoObligationGroupAction(targetMutationID:String,requestID:String,scope:String,issuedAt:Date,at:Date=Date()) throws -> ObligationGroupActionResult {
        let key=try groupKey(scope:scope,requestID:requestID),target=try groupKey(scope:scope,requestID:targetMutationID)
        return try command(key,payload:JSONCodec.string(["undo":target,"issuedAt":JSONCodec.string(issuedAt)])) {
            guard let row=try db.rows("SELECT result,undone_by FROM obligation_group_mutations WHERE id=? AND scope=?",[target,scope]).first,row["undone_by"]==nil else {
                throw MapleError.invalid("Group action is unavailable or already undone.")
            }
            let original=try JSONCodec.decode(ObligationGroupActionResult.self,from:Data(row["result"]!.utf8))
            let results=try original.children.map { child in
                try applyTaskActionInTransaction(nodeID:child.nodeID,
                    change:TaskActionChange(kind:"undo",issuedAt:issuedAt,targetMutationID:child.mutationID),
                    expectedVersion:child.version,requestID:aggregationDigest(key+child.nodeID),scope:scope,at:at)
            }
            try db.execute("UPDATE obligation_group_mutations SET undone_by=? WHERE id=?",[key,target])
            return ObligationGroupActionResult(mutationID:requestID,children:results)
        }
    }
}
