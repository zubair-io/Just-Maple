import CloudKit
import Foundation

public enum CloudMailboxOperation:String,Sendable {case zoneFetch="zone lookup",zoneCreate="zone creation",recordFetch="record fetch",recordSave="record save",changeScan="change scan"}
/// Deliberately stores only fixed stage labels, numeric codes and whitelisted flags.
/// The original NSError, private server description, identifiers and payload are never retained.
public struct CloudMailboxRequestFailure:Error,Sendable {
    public let operation:CloudMailboxOperation
    public let codes:[Int]
    public let internalCodes:[Int]
    public let schemaMissing:Bool
    public let containerUnconfigured:Bool
    public var safeDescription:String {
        var details=["CloudKit codes "+codes.map(String.init).joined(separator:", ")]
        if !internalCodes.isEmpty{details.append("internal codes "+internalCodes.map(String.init).joined(separator:", "))}
        if schemaMissing{details.append("schema missing")}
        if containerUnconfigured{details.append("container configuration")}
        return "iCloud rejected \(operation.rawValue) (\(details.joined(separator:"; "))). Your local data is safe."
    }
    static func wrapping(_ error:Error,stage:CloudMailboxOperation)->Error {
        guard let ck=error as? CKError else{return error}
        let children=ck.partialErrorsByItemID?.values.compactMap{$0 as? CKError} ?? []
        let errors=[ck]+children
        guard errors.contains(where:{[CKError.serverRejectedRequest,.invalidArguments].contains($0.code)})else{return error}
        var messages:[String]=[],internalCodes:[Int]=[]
        for error in errors.prefix(8) {
            var value=error as NSError
            for _ in 0..<3 {
                if value.domain=="CKInternalErrorDomain"{internalCodes.append(value.code)}
                if let text=value.userInfo[NSLocalizedDescriptionKey] as? String{messages.append(text.lowercased())}
                if let text=value.userInfo[NSLocalizedFailureReasonErrorKey] as? String{messages.append(text.lowercased())}
                guard let nested=value.userInfo[NSUnderlyingErrorKey] as? NSError else{break};value=nested
            }
        }
        let missing=messages.contains{message in (message.contains("record type") || message.contains("field") || message.contains("schema")) && ["not found","does not exist","unknown","not deployed"].contains(where:message.contains)}
        let container=messages.contains{message in message.contains("container") && ["not found","not configured","invalid","not entitled"].contains(where:message.contains)}
        return Self(operation:stage,codes:Set(errors.map{$0.code.rawValue}).sorted(),internalCodes:Set(internalCodes).sorted(),schemaMissing:missing,containerUnconfigured:container)
    }
}
