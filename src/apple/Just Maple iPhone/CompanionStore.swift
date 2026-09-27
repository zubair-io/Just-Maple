import Foundation
import MapleCompanionTransport

struct CompanionCapture: Codable, Equatable {
    let id: String
    let text: String
    let createdAt: Date
}
struct CompanionSnapshot: Codable {
    let deviceID: String
    var captures: [CompanionCapture]
    var receivedIDs: [String]?
    var uploadedIDs: [String]?
    var mac: SyncResponse?
    var groupActions:[SyncGroupAction]?
    var groupActionReceipts:[SyncGroupActionReceipt]?
    var taskActions:[SyncTaskAction]?
    var taskActionReceipts:[SyncTaskActionReceipt]?
    var cloudAccountID:String?
}
enum CompanionError: Error, LocalizedError {
    case invalidCapture, conflictingRequest, storageUnavailable, queueFull, invalidPairing, accountChanged
    var errorDescription: String? {
        switch self {
        case .invalidCapture: "Enter a note of up to 16 KB."
        case .conflictingRequest: "This capture ID already belongs to a different note."
        case .storageUnavailable: "Your saved captures could not be opened. They have not been replaced."
        case .accountChanged: "These captures belong to a different iCloud account. Sign back into that account to sync them."
        case .invalidPairing: "This pairing code is invalid or expired. Create a new code on your Mac."
        case .queueFull: "Your offline capture storage is full. Existing notes are safe."
        }
    }
}
/// Device outbox only. The authoritative knowledge database remains on the Mac.
/// No item is marked delivered until the future transport receives a durable Mac receipt.
@MainActor final class CompanionStore {
    private let file: URL
    private(set) var snapshot: CompanionSnapshot
    init(directory: URL) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        file=directory.appendingPathComponent("captures.json")
        if FileManager.default.fileExists(atPath:file.path) {
            do { snapshot=try JSONDecoder().decode(CompanionSnapshot.self,from:Data(contentsOf:file)) }
            catch {throw CompanionError.storageUnavailable}
        } else {
            snapshot=CompanionSnapshot(deviceID:UUID().uuidString,captures:[])
            try Self.write(snapshot,to:file)
        }
    }
    func capture(id:String,text:String,at:Date=Date())throws {
        let text=text.trimmingCharacters(in:.whitespacesAndNewlines)
        guard UUID(uuidString:id) != nil,!text.isEmpty,text.utf8.count<=16_000 else {throw CompanionError.invalidCapture}
        if let existing=snapshot.captures.first(where:{$0.id==id}) {
            guard existing.text==text else {throw CompanionError.conflictingRequest};return
        }
        guard snapshot.captures.count<2000 else {throw CompanionError.queueFull}
        var next=snapshot
        next.captures.insert(CompanionCapture(id:id,text:text,createdAt:at),at:0)
        try Self.write(next,to:file)
        snapshot=next
    }
    var pendingGroupActions:[SyncGroupAction] {
        let received=Set((snapshot.groupActionReceipts ?? []).map(\.id))
        return (snapshot.groupActions ?? []).filter{!received.contains($0.id)}
    }
    private func groupMembers(_ action:SyncGroupAction)->Set<String> {
        if let children=action.review?.children{return Set(children.map(\.nodeID))}
        if let target=action.targetMutationID,let original=snapshot.groupActions?.first(where:{$0.id==target}) {return Set(original.review?.children.map(\.nodeID) ?? [])}
        return []
    }
    func groupAction(_ action:SyncGroupAction)throws {
        if let old=snapshot.groupActions?.first(where:{$0.id==action.id}){guard old==action else{throw CompanionError.conflictingRequest};return}
        guard action.valid,action.issuedAt<=Date().addingTimeInterval(300) else{throw CompanionError.invalidCapture}
        if action.intent == .undo {
            guard let target=action.targetMutationID,snapshot.groupActions?.contains(where:{$0.id==target && $0.intent != .undo})==true,
                  snapshot.groupActionReceipts?.contains(where:{$0.id==target && $0.outcome=="applied"})==true else{throw CompanionError.invalidCapture}
        } else {
            guard snapshot.mac?.reviewedGroups?.contains(where:{$0.review==action.review})==true else{throw CompanionError.invalidCapture}
        }
        let members=groupMembers(action)
        guard pendingGroupActions.count<50,!members.isEmpty,
              pendingTaskActions.allSatisfy({!members.contains($0.taskID)}),
              pendingGroupActions.allSatisfy({groupMembers($0).isDisjoint(with:members)}) else{throw CompanionError.queueFull}
        var next=snapshot
        let pinned=Set((pendingGroupActions+[action]).flatMap{[$0.id,$0.targetMutationID].compactMap{$0}})
        let recent=Set((snapshot.groupActionReceipts ?? []).suffix(50).map(\.id))
        let retained=recent.union(pinned)
        next.groupActions=(next.groupActions ?? []).filter{retained.contains($0.id)}+[action]
        next.groupActionReceipts=(next.groupActionReceipts ?? []).filter{retained.contains($0.id)}
        try Self.write(next,to:file);snapshot=next
    }
    func acceptGroupActionReceipts(_ receipts:[SyncGroupActionReceipt],sent:Set<UUID>)throws {
        guard Set(receipts.map(\.id)).count==receipts.count,receipts.allSatisfy({$0.valid && sent.contains($0.id)}),sent.isSubset(of:Set((snapshot.groupActions ?? []).map(\.id))) else{throw CompanionError.invalidCapture}
        var next=snapshot,values=Dictionary((snapshot.groupActionReceipts ?? []).map{($0.id,$0)},uniquingKeysWith:{a,_ in a})
        for receipt in receipts {
            if let old=values[receipt.id],old != receipt{throw CompanionError.conflictingRequest}
            if let children=receipt.children,let action=snapshot.groupActions?.first(where:{$0.id==receipt.id}) {
                guard Set(children.map(\.nodeID))==groupMembers(action) else{throw CompanionError.invalidCapture}
            }
            values[receipt.id]=receipt
        }
        next.groupActionReceipts=(next.groupActions ?? []).compactMap{values[$0.id]}
        try Self.write(next,to:file);snapshot=next
    }
    var pendingTaskActions:[SyncTaskAction] {
        let done=Set((snapshot.taskActionReceipts ?? []).map(\.id))
        return (snapshot.taskActions ?? []).filter{!done.contains($0.id)}
    }
    func taskAction(_ action:SyncTaskAction)throws {
        if let old=snapshot.taskActions?.first(where:{$0.id==action.id}) {guard old==action else{throw CompanionError.conflictingRequest};return}
        guard action.validForEnqueue() else{throw CompanionError.invalidCapture}
        if action.intent == .undo, let target=action.payload?.targetMutationID {
            let receiptProof = snapshot.taskActions?.contains(where:{$0.id==target && $0.taskID==action.taskID && $0.intent != .undo}) == true &&
                snapshot.taskActionReceipts?.contains(where:{$0.id==target && $0.outcome=="applied" && $0.resultingVersion==action.expectedVersion}) == true
            // A current authenticated snapshot can outlive the bounded local receipt history.
            // Recheck scope and revision instead of trusting a UI canUndo flag alone.
            let snapshotProof = snapshot.mac?.tasks.contains(where:{task in
                guard task.id==action.taskID,task.version==action.expectedVersion,let state=task.actionState else{return false}
                return state.canUndo && state.lastMutationScope.lowercased()==snapshot.deviceID.lowercased() &&
                    UUID(uuidString:state.lastMutationID)==target && ["done","later","waiting","notNeeded"].contains(state.lastAction)
            }) == true
            guard receiptProof || snapshotProof else{throw CompanionError.invalidCapture}
        } else {
            guard let task=snapshot.mac?.tasks.first(where:{$0.id==action.taskID}),task.version==action.expectedVersion else{throw CompanionError.invalidCapture}
        }
        guard pendingGroupActions.allSatisfy({!groupMembers($0).contains(action.taskID)}),pendingTaskActions.count<100,!pendingTaskActions.contains(where:{$0.taskID==action.taskID}) else{throw CompanionError.queueFull}
        var next=snapshot
        // Keep outstanding actions and a bounded recent receipt history.
        let keep=Set((snapshot.taskActionReceipts ?? []).suffix(100).map(\.id)).union(pendingTaskActions.map(\.id))
        next.taskActions=(next.taskActions ?? []).filter{keep.contains($0.id)}+[action]
        next.taskActionReceipts=Array((next.taskActionReceipts ?? []).suffix(100))
        try Self.write(next,to:file);snapshot=next
    }
    func acceptActionReceipts(_ receipts:[SyncTaskActionReceipt],sent:Set<UUID>)throws {
        guard Set(receipts.map(\.id)).count==receipts.count,receipts.allSatisfy({sent.contains($0.id) && $0.valid}),sent.isSubset(of:Set((snapshot.taskActions ?? []).map(\.id))) else{throw CompanionError.invalidCapture}
        var next=snapshot,values=Dictionary((snapshot.taskActionReceipts ?? []).map{($0.id,$0)},uniquingKeysWith:{a,_ in a})
        for receipt in receipts {if let old=values[receipt.id],old != receipt{throw CompanionError.conflictingRequest};values[receipt.id]=receipt}
        next.taskActionReceipts=(next.taskActions ?? []).compactMap{values[$0.id]}
        try Self.write(next,to:file);snapshot=next
    }
    func accept(_ response:SyncResponse,sentIDs:Set<UUID>)throws {
        guard response.validGroups,response.version==1,response.deviceID.uuidString.lowercased()==snapshot.deviceID.lowercased(),
              Set(response.receivedIDs).count==response.receivedIDs.count,
              Set(response.receivedIDs).isSubset(of:sentIDs),
              response.tasks.count<=50,response.states.count<=32,
              response.activities.count<=32,response.people.count<=12,
              response.asOf.timeIntervalSince1970.isFinite,
              response.asOf<=Date().addingTimeInterval(300) else{throw CompanionError.invalidCapture}
        var next=snapshot
        next.receivedIDs=Array(Set(next.receivedIDs ?? []).union(response.receivedIDs.map{$0.uuidString.lowercased()}))
        if next.mac == nil || response.asOf >= next.mac!.asOf { next.mac=response }
        try Self.write(next,to:file);snapshot=next
    }
    func acceptReceipts(_ ids:[UUID], sentIDs:Set<UUID>)throws {
        guard Set(ids).count==ids.count, Set(ids).isSubset(of:sentIDs),
              sentIDs.isSubset(of:Set(snapshot.captures.compactMap { UUID(uuidString:$0.id) })) else { throw CompanionError.invalidCapture }
        guard !ids.isEmpty else{return}
        var next=snapshot
        next.receivedIDs=Array(Set(next.receivedIDs ?? []).union(ids.map{$0.uuidString.lowercased()}))
        try Self.write(next,to:file);snapshot=next
    }
    /// Cloud upload is not a Mac receipt: captures remain pending until ingestion is acknowledged.
    func markUploaded(_ ids:Set<UUID>)throws {
        let known=Set(snapshot.captures.compactMap { UUID(uuidString:$0.id) })
        guard ids.isSubset(of:known) else { throw CompanionError.invalidCapture }
        guard !ids.isEmpty, !Set(ids.map{$0.uuidString.lowercased()}).isSubset(of:Set(snapshot.uploadedIDs ?? [])) else{return}
        var next=snapshot
        next.uploadedIDs=Array(Set(next.uploadedIDs ?? []).union(ids.map{$0.uuidString.lowercased()}))
        try Self.write(next,to:file);snapshot=next
    }
    func bindCloudAccount(_ account:String)throws {
        if let owner=snapshot.cloudAccountID,owner != account {
            try clearMac();throw CompanionError.accountChanged
        }
        guard snapshot.cloudAccountID==nil else{return}
        var next=snapshot;next.cloudAccountID=account
        try Self.write(next,to:file);snapshot=next
    }
    func clearMac()throws {
        var next=snapshot;next.mac=nil
        // Delivery receipts remain: disconnecting must not resubmit previously delivered notes.
        try Self.write(next,to:file);snapshot=next
    }
    var pending:[CompanionCapture] {let delivered=Set(snapshot.receivedIDs ?? []);return snapshot.captures.filter{!delivered.contains($0.id.lowercased())}}
    private static func write(_ snapshot:CompanionSnapshot,to file:URL)throws {
        try JSONEncoder().encode(snapshot).write(to:file,options:[.atomic,.completeFileProtectionUntilFirstUserAuthentication])
    }
    func reply()throws->Any {
        let encoder=JSONEncoder();encoder.dateEncodingStrategy = .iso8601
        guard var result=try JSONSerialization.jsonObject(with:encoder.encode(snapshot)) as? [String:Any] else{throw CompanionError.storageUnavailable}
        result.removeValue(forKey:"cloudAccountID")
        return result
    }
}
