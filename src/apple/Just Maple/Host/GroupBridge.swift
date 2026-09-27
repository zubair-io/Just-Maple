import Foundation
import CoreFoundation
import MapleCore

extension Bridge {
    func obligationGroupCommand(_ action:String,_ body:[String:Any]) async throws -> Any {
        guard let store=model.store else {throw MapleError.invalid("Your local workspace is not ready.")}
        switch action {
        case "retryObligationGrouping":
            try await store.retryObligationGrouping(requestID:string(body,"requestID",limit:256));return ["retrying":true]
        case "obligationGroupingSettings":
            return ["configuration":try json(try await store.obligationGroupingConfiguration()),"status":try json(try await store.obligationGroupingStatus()),"proposals":try json(try await store.obligationGroupingProposals())]
        case "configureObligationGrouping":
            let window=try decodeGroupingWindow(body["maximumSpan"])
            try await store.configureObligationGrouping(maximumSpan:window,requestID:string(body,"requestID",limit:256))
            return ["configured":window != nil]

        case "reviewedObligationGroups": return try json(try await store.reviewedObligationGroups())
        case "reviewObligationGroup":
            guard let seconds=body["maximumSpan"] as? Double else {throw MapleError.invalid("Choose a grouping window.")}
            return try json(try await store.createReviewedObligationGroup(children:decode([ObligationGroupChild].self,body,"children"),
                intent:string(body,"intent",limit:256),actor:string(body,"actor",limit:256),target:string(body,"target",limit:256),
                maximumSpan:seconds,requestID:string(body,"requestID",limit:256)))
        case "applyObligationGroupAction":
            let kind=try string(body,"kind",limit:32)
            guard ["done","notNeeded"].contains(kind) else {throw MapleError.invalid("Unsupported group action.")}
            guard let issuedAt=body["issuedAt"] as? Double else {throw MapleError.invalid("Missing action time.")}
            let result=try await store.applyObligationGroupAction(review:decode(ObligationGroupReview.self,body,"review"),change:TaskActionChange(kind:kind,issuedAt:Date(timeIntervalSince1970:issuedAt)),requestID:string(body,"requestID",limit:256),scope:"desktop")
            await model.refresh();return try json(result)
        case "undoObligationGroupAction":
            guard let issuedAt=body["issuedAt"] as? Double else {throw MapleError.invalid("Missing action time.")}
            let result=try await store.undoObligationGroupAction(targetMutationID:string(body,"targetMutationID",limit:256),requestID:string(body,"requestID",limit:256),scope:"desktop",issuedAt:Date(timeIntervalSince1970:issuedAt))
            await model.refresh();return try json(result)
        default:throw MapleError.invalid("Unsupported group action.")
        }
    }
}

/// Missing/null is explicit disable; malformed supplied data must never pause work.
func decodeGroupingWindow(_ value:Any?) throws -> TimeInterval? {
    guard let value,!(value is NSNull) else {return nil}
    guard let number=value as? NSNumber,CFGetTypeID(number) != CFBooleanGetTypeID(),number.doubleValue.isFinite,number.doubleValue>0 else {throw MapleError.invalid("Choose a positive numeric suggestion window.")}
    return number.doubleValue
}
