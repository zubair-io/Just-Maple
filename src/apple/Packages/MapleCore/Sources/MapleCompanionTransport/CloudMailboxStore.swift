import CloudKit
import Foundation

public struct CloudMailboxRecord: Sendable {
    public var id:String
    public var payload:Data
    public var version:Data?
    public init(id:String,payload:Data,version:Data?=nil){self.id=id;self.payload=payload;self.version=version}
}
public struct CloudMailboxPage: Sendable {
    public var records:[CloudMailboxRecord]
    public var cursor:Data
    public var moreComing:Bool
    public init(records:[CloudMailboxRecord],cursor:Data,moreComing:Bool){self.records=records;self.cursor=cursor;self.moreComing=moreComing}
}
public enum CloudMailboxError:Error,Sendable {case invalidPayload,conflictingCapture,conflict,accountChanged,invalidCursor,missingResult}
@MainActor public protocol CloudMailboxStore {
    func fetch(_ ids:[String])async throws->[CloudMailboxRecord]
    func save(_ record:CloudMailboxRecord)async throws
    func changes(after cursor:Data?,limit:Int)async throws->CloudMailboxPage
}

/// Private custom zone changes need no queryable indexes. Every operation is bounded and
/// failures propagate to the host's durable retry loop; no fixture or stale-success fallback.
@MainActor final class NativeCloudMailboxStore:CloudMailboxStore {
    private let database:CKDatabase
    private let zone:CKRecordZone.ID
    private var ready=false
    private let accountCheck:@MainActor ()async throws->Void
    init(containerIdentifier:String,zoneName:String,accountCheck:@escaping @MainActor ()async throws->Void){self.accountCheck=accountCheck;database=CKContainer(identifier:containerIdentifier).privateCloudDatabase;zone=CKRecordZone.ID(zoneName:zoneName,ownerName:CKCurrentUserDefaultName)}
    private func prepare()async throws {
        if ready{return}
        do {
            _ = try await retry(stage:.zoneFetch){try await self.database.recordZone(for:self.zone)}
        }catch let error as CKError where error.code == .zoneNotFound || error.code == .unknownItem || error.code == .userDeletedZone {
            _ = try await retry(stage:.zoneCreate){try await self.database.save(CKRecordZone(zoneID:self.zone))}
        }
        ready=true
    }
    private func retry<T>(stage:CloudMailboxOperation,_ operation:()async throws->T)async throws->T {
        for attempt in 0..<3 {
            try Task.checkCancellation();try await accountCheck()
            do{let result=try await operation();try await accountCheck();return result}catch {
                if let ck=error as? CKError {
                    let errors=[ck]+(ck.partialErrorsByItemID?.values.compactMap{$0 as? CKError} ?? [])
                    if stage != .zoneFetch && errors.contains(where:{[CKError.zoneNotFound,.userDeletedZone].contains($0.code)}){ready=false;throw CloudMailboxError.invalidCursor}
                }
                let diagnostic=CloudMailboxRequestFailure.wrapping(error,stage:stage)
                guard let ck=error as? CKError,attempt<2,[CKError.networkFailure,.networkUnavailable,.serviceUnavailable,.requestRateLimited,.zoneBusy].contains(ck.code) else{throw diagnostic}
                let delay=ck.retryAfterSeconds ?? Double(attempt+1)
                guard delay<=10 else{throw diagnostic}
                try await Task.sleep(for:.seconds(max(0.1,delay)))
            }
        }
        throw CloudMailboxError.missingResult
    }
    func fetch(_ ids:[String])async throws->[CloudMailboxRecord] {
        guard ids.count<=32 else{throw CloudMailboxError.invalidPayload}
        guard !ids.isEmpty else{return []}
        try await prepare()
        let result=try await retry(stage:.recordFetch) {try await self.database.records(for:ids.map{CKRecord.ID(recordName:$0,zoneID:self.zone)})}
        var output:[CloudMailboxRecord]=[]
        for id in ids {
            guard let entry=result[CKRecord.ID(recordName:id,zoneID:zone)] else{throw CloudMailboxError.missingResult}
            do{output.append(try convert(entry.get()))}catch let error as CKError {
                if error.code == .unknownItem{continue}
                if [CKError.zoneNotFound,.userDeletedZone].contains(error.code){ready=false;throw CloudMailboxError.invalidCursor}
                throw CloudMailboxRequestFailure.wrapping(error,stage:.recordFetch)
            }
        }
        return output
    }
    func save(_ value:CloudMailboxRecord)async throws {
        try await prepare()
        let record:CKRecord
        if let data=value.version {
            let decoder=try NSKeyedUnarchiver(forReadingFrom:data);decoder.requiresSecureCoding=true
            guard let decoded=CKRecord(coder:decoder) else{throw CloudMailboxError.invalidPayload};decoder.finishDecoding()
            guard decoded.recordID.recordName==value.id,decoded.recordID.zoneID==zone else{throw CloudMailboxError.invalidPayload};record=decoded
        }else{record=CKRecord(recordType:"MapleCompanionEnvelope",recordID:CKRecord.ID(recordName:value.id,zoneID:zone))}
        record["payload"]=value.payload as CKRecordValue
        do {
            let result=try await retry(stage:.recordSave) {try await self.database.modifyRecords(saving:[record],deleting:[],savePolicy:.ifServerRecordUnchanged,atomically:true)}
            guard let saved=result.saveResults[record.recordID] else{throw CloudMailboxError.missingResult}
            _ = try saved.get()
        }catch let error as CKError {
            let errors=[error]+(error.partialErrorsByItemID?.values.compactMap{$0 as? CKError} ?? [])
            if errors.contains(where:{[CKError.zoneNotFound,.userDeletedZone].contains($0.code)}){ready=false;throw CloudMailboxError.invalidCursor}
            if errors.contains(where:{$0.code == .serverRecordChanged}){throw CloudMailboxError.conflict}
            throw CloudMailboxRequestFailure.wrapping(error,stage:.recordSave)
        }
    }
    func changes(after cursor:Data?,limit:Int)async throws->CloudMailboxPage {
        guard (1...100).contains(limit) else{throw CloudMailboxError.invalidPayload}
        try await prepare()
        let token:CKServerChangeToken?
        if let cursor {token=try NSKeyedUnarchiver.unarchivedObject(ofClass:CKServerChangeToken.self,from:cursor);guard token != nil else{throw CloudMailboxError.invalidCursor}}else{token=nil}
        do {
            let result=try await retry(stage:.changeScan) {try await self.database.recordZoneChanges(inZoneWith:self.zone,since:token,desiredKeys:nil,resultsLimit:limit)}
            let records=try result.modificationResultsByID.values.map{try convert($0.get().record)}
            return .init(records:records,cursor:try NSKeyedArchiver.archivedData(withRootObject:result.changeToken,requiringSecureCoding:true),moreComing:result.moreComing)
        }catch let error as CKError {
            if error.code == .changeTokenExpired{throw CloudMailboxError.invalidCursor}
            throw CloudMailboxRequestFailure.wrapping(error,stage:.changeScan)
        }
    }
    private func convert(_ record:CKRecord)throws->CloudMailboxRecord {
        guard record.recordType=="MapleCompanionEnvelope",let payload=record["payload"] as? Data,payload.count<=262_200 else{throw CloudMailboxError.invalidPayload}
        let encoder=NSKeyedArchiver(requiringSecureCoding:true);record.encodeSystemFields(with:encoder);encoder.finishEncoding()
        return .init(id:record.recordID.recordName,payload:payload,version:encoder.encodedData)
    }
}

extension CloudMailboxError {
    /// UI-safe diagnostics. Never include CloudKit private response bodies or record contents.
    public static func safeDescription(_ error:Error)->String {
        if error is CancellationError{return "Sync paused."}
        if let failure=error as? CloudMailboxRequestFailure{return failure.safeDescription}
        if let cloud=error as? CloudMailboxError {
            switch cloud {
            case .accountChanged:return "Your iCloud account or connection changed. Reconnect to continue."
            case .invalidCursor:return "iCloud sync history changed. Retrying from saved records."
            case .conflict:return "iCloud changed during sync. Retrying safely."
            case .conflictingCapture:return "A capture ID has conflicting content. Your local capture is still safe."
            case .invalidPayload:return "An iCloud sync record could not be verified. Your local data is still safe."
            case .missingResult:return "iCloud returned an incomplete result. Retrying safely."
            }
        }
        if let ck=error as? CKError {
            if ck.code == .partialFailure {
                let nested=ck.partialErrorsByItemID?.values.compactMap{$0 as? CKError} ?? []
                let codes=Set(([ck]+nested).map{$0.code.rawValue}).sorted().prefix(8).map(String.init).joined(separator:", ")
                let relevant=nested.first{$0.code != .partialFailure && $0.code != .batchRequestFailed}
                let detail=relevant.map{safeDescription($0)} ?? "iCloud returned a partial failure."
                return "\(detail) (CloudKit codes \(codes))"
            }
            switch ck.code {
            case .notAuthenticated:return "Sign into iCloud to continue syncing."
            case .networkFailure,.networkUnavailable:return "iCloud is offline. Sync will retry when a connection is available."
            case .quotaExceeded:return "iCloud storage is full. Free some space to resume syncing."
            case .permissionFailure,.missingEntitlement:return "iCloud access is unavailable for this app. Check its signing and iCloud setup."
            case .serverRejectedRequest,.invalidArguments:return "iCloud rejected this sync request. Check the app’s CloudKit configuration."
            case .serviceUnavailable,.requestRateLimited,.zoneBusy:return "iCloud is temporarily busy. Sync will retry."
            case .zoneNotFound,.userDeletedZone,.changeTokenExpired:return "iCloud sync history changed. Retrying from saved records."
            case .serverRecordChanged:return "iCloud changed during sync. Retrying safely."
            default:return "iCloud sync failed (CloudKit code \(ck.code.rawValue)). Your local data is still safe."
            }
        }
        return "iCloud sync is unavailable. Your local data is still safe; retrying."
    }
}
