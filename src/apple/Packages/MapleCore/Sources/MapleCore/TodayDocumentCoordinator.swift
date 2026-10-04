import Foundation
import MapleNotebooks

/// Internal injection seam for process-termination tests; production has no observer or environment switch.
enum DocumentCommitBoundary:String,Sendable,CaseIterable {
    case draftPersisted,journalPrepared,fileReplaced,finalized,outboxDrained
}

/// Serializes managed document commands. SQLite intent commits before coordinated file writes;
/// recovery uses before/after hashes, never a blind overwrite of an external editor's content.
public actor TodayDocumentCoordinator {
    let store:KnowledgeStore
    let library:NotebookLibrary
    var operationObserver:(@Sendable (DocumentOperationBoundary,String,Int?)->Void)?
    private let commitObserver:(@Sendable (DocumentCommitBoundary,String)->Void)?
    var busy=Set<String>()
    private struct EditorSession {
        var owner:String?
        var expires:Date
        var active:Bool
    }
    private var editorSessions:[String:EditorSession]=[:]

    private func claimEditorSession(documentID:String,owner:String?) {
        if owner == nil,let current=editorSessions[documentID],current.owner != nil,current.active {return}
        editorSessions[documentID]=EditorSession(owner:owner,expires:Date().addingTimeInterval(30),active:true)
    }

    public func setEditorSession(documentID:String,active:Bool,at:Date?=nil,editorSessionID:String?=nil) async throws {
        try await acquire([documentID]);defer{release([documentID])}
        if let current=editorSessions[documentID] {
            guard current.owner == editorSessionID else {
                if active {throw MapleError.invalid("This editor session is no longer active. Reopen the note to continue.")}
                return // A departed view cannot release its successor's claim.
            }
            if active && !current.active && editorSessionID != nil {
                throw MapleError.invalid("This editor session has ended. Reopen the note to continue.")
            }
        } else if editorSessionID != nil {
            throw MapleError.invalid("Open the note before renewing its editor session.")
        }
        editorSessions[documentID]=EditorSession(owner:editorSessionID,expires:active ? (at ?? Date()).addingTimeInterval(30):.distantPast,active:active)
    }

    func renewEditorSession(documentID:String,at:Date=Date()) {
        if var current=editorSessions[documentID],current.active {
            current.expires=at.addingTimeInterval(30);editorSessions[documentID]=current
        }
    }

    public func hasEditorSession(documentID:String,at:Date=Date()) -> Bool {
        guard let current=editorSessions[documentID] else{return false}
        return current.active && current.expires>at
    }
    private struct DocumentWaiter {
        let keys:Set<String>
        let continuation:CheckedContinuation<Void,Never>
    }
    private var waiters:[DocumentWaiter]=[]

    // Actors are reentrant across store/file awaits. Queue overlapping commands rather
    // than treating normal startup, projection, and editor overlap as a save failure.
    // Admission is atomic for multi-document actions and FIFO for overlapping keys.
    func acquire(_ ids:[String]) async throws {
        try Task.checkCancellation()
        let keys=Set(ids)
        if keys.isDisjoint(with:busy) && !waiters.contains(where:{!$0.keys.isDisjoint(with:keys)}) {
            busy.formUnion(keys)
        } else {
            await withCheckedContinuation { continuation in
                waiters.append(DocumentWaiter(keys:keys,continuation:continuation))
            }
        }
        do {try Task.checkCancellation()}
        catch {release(ids);throw error}
    }

    func release(_ ids:[String]) {
        busy.subtract(ids)
        var blocked=Set<String>()
        var pending:[DocumentWaiter]=[]
        for waiter in waiters {
            if waiter.keys.isDisjoint(with:busy) && waiter.keys.isDisjoint(with:blocked) {
                busy.formUnion(waiter.keys)
                waiter.continuation.resume()
            } else {
                blocked.formUnion(waiter.keys)
                pending.append(waiter)
            }
        }
        waiters=pending
    }
    public init(store:KnowledgeStore,library:NotebookLibrary) {self.store=store;self.library=library;self.commitObserver=nil}
    init(store:KnowledgeStore,library:NotebookLibrary,commitObserver:@escaping @Sendable (DocumentCommitBoundary,String)->Void) {
        self.store=store;self.library=library;self.commitObserver=commitObserver
    }

    public func open(notebookID:String,day requested:String?=nil,timeZone:String=TimeZone.current.identifier,migrateLegacy:Bool=false,recoveryCopy:Bool=false,collaborative:Bool=false,editorSessionID:String?=nil) async throws -> TodayDocumentSnapshot {
        let day=try requested ?? ManagedMarkdown.day(timeZone:timeZone)
        try ManagedMarkdown.validateDay(day,timeZone:timeZone)
        let key=notebookID+":"+day
        try await acquire([key]);defer{release([key])}
        if let document=try await store.managedDailyDocument(notebookID:notebookID,day:day) {return try await open(documentID:document.documentID,collaborative:collaborative,editorSessionID:editorSessionID)}
        let legacy=try await store.dailyNote(day:day,timeZone:timeZone)
        let priorImport=try await store.legacyDailyImportDocument(day:day)
        let hasLegacy = priorImport==nil && (!legacy.blocks.isEmpty || !legacy.cleared.isEmpty)
        let id=UUID().uuidString.lowercased()
        if collaborative {claimEditorSession(documentID:id,owner:editorSessionID)}
        defer {if collaborative {renewEditorSession(documentID:id)}}
        let directory=try await library.prepareDailyDirectory(notebookID:notebookID,day:day)
        let path=directory+"/"+day+(recoveryCopy ? "-recovered-"+String(id.prefix(8)):"")+".md"
        var existing=try await library.readIfPresent(notebookID:notebookID,path:path)
        var existingPath=path
        if existing==nil && !recoveryCopy {
            // Adopt an older same-notebook date file in place, preserving bytes and identity.
            // A user-owned legacy file remains a visible collision, never a silent duplicate.
            let oldPath="Daily/"+day+".md"
            if let old=try await library.readIfPresent(notebookID:notebookID,path:oldPath) {existing=old;existingPath=oldPath}
        }
        if let existing {
            if let embedded=ManagedMarkdown.documentID(existing.content) {
                try ManagedMarkdown.validate(existing.content,documentID:embedded)
                if collaborative {claimEditorSession(documentID:embedded,owner:editorSessionID)}
                defer {if collaborative {renewEditorSession(documentID:embedded)}}
                let record=ManagedDocumentRecord(documentID:embedded,notebookID:notebookID,path:existingPath,day:day,timeZone:timeZone,revision:existing.revision)
                try await store.registerManagedDocument(record,initialContent:existing.content,initialBefore:existing.content)
                return try await commit(documentID:embedded,expectedRevision:existing.revision,content:existing.content,commandID:"create:"+embedded)
            }
            return TodayDocumentSnapshot(documentID:"",notebookID:notebookID,path:existingPath,day:day,timeZone:timeZone,content:existing.content,revision:existing.revision,readOnly:true,warning:"This date already contains a user-owned file. It has not been overwritten. Open it in Notebooks, or explicitly recover legacy blocks to a separate note.",indexingPending:false,legacyMigrationAvailable:hasLegacy)
        }
        let content=try hasLegacy ? Self.export(legacy,documentID:id):ManagedMarkdown.header(documentID:id,day:day,timeZone:timeZone)+"\n"
        if hasLegacy && !migrateLegacy {
            return TodayDocumentSnapshot(documentID:"",notebookID:notebookID,path:path,day:day,timeZone:timeZone,content:content,revision:"",readOnly:true,warning:"Legacy daily blocks are available. Review this preview, then import them to Markdown. The original blocks and cleared history will be retained.",indexingPending:false,legacyMigrationAvailable:true)
        }
        let record=ManagedDocumentRecord(documentID:id,notebookID:notebookID,path:path,day:day,timeZone:timeZone,revision:nil)
        try await store.registerManagedDocument(record,initialContent:content,legacySnapshot:hasLegacy ? legacy:nil)
        var result=try await commit(documentID:id,expectedRevision:nil,content:content,commandID:"create:"+id)
        if hasLegacy {try await store.recordDailyDocumentImport(legacy,documentID:id)}
        if let priorImport,priorImport.notebookID != notebookID {
            result.warning="This day's earlier note remains at "+priorImport.path+" in its original notebook. Open it in Notebooks; its imported blocks have not been duplicated into this iCloud note."
        }
        return result
    }
    public func open(documentID:String,collaborative:Bool=false,backgroundRead:Bool=false,editorSessionID:String?=nil) async throws -> TodayDocumentSnapshot {
        try await acquire([documentID]);defer{if collaborative {renewEditorSession(documentID:documentID)};release([documentID])}
        let record=try await record(documentID)
        if collaborative {claimEditorSession(documentID:documentID,owner:editorSessionID)}
        if backgroundRead,hasEditorSession(documentID:documentID) {
            guard let disk=try await library.readIfPresent(notebookID:record.notebookID,path:record.path) else {throw MapleError.invalid("The managed file is unavailable.")}
            return try await snapshot(record,disk)
        }
        var warning:String?
        for operation in try await store.pendingDocumentOperations(documentID:documentID) {
            do {try await recoverOperation(operation,alreadyLocked:documentID)}
            catch {warning="A block action is pending reconciliation. Both file versions are preserved; a linked task remains pending until recovery completes."}
        }
        for mutation in try await store.pendingDocumentMutations(documentID:documentID) {
            let disk=try await library.readIfPresent(notebookID:record.notebookID,path:record.path)
            if disk?.revision==mutation.targetRevision {try await store.finalizeDocumentMutation(mutation)}
            else if disk?.revision==mutation.expectedRevision {
                _ = try await library.save(notebookID:record.notebookID,path:record.path,content:mutation.after,expectedRevision:mutation.expectedRevision)
                try await store.finalizeDocumentMutation(mutation)
            } else {
                try await store.markDocumentConflict(mutation)
                warning="An interrupted save conflicts with external changes. Both versions are preserved in document history; your draft is retained."
            }
        }
        do {try await store.drainDocumentOutbox()} catch {warning="The file is saved. Indexing is pending and will retry when reopened."}
        guard let disk=try await library.readIfPresent(notebookID:record.notebookID,path:record.path) else {throw MapleError.invalid("This managed file is missing. Its recoverable versions remain in document history.")}
        var result=try await snapshot(record,disk);if let warning {result.warning=warning}
        return result
    }
    public func commit(documentID:String,expectedRevision:String?,content:String,commandID:String,preserveDraft:Bool=false,backgroundWrite:Bool=false,acceptedAutomaticBlockIDs:[String]=[],acceptedReplyRunIDs:[String]=[]) async throws -> TodayDocumentSnapshot {
        try await acquire([documentID]);defer{if !backgroundWrite {renewEditorSession(documentID:documentID)};release([documentID])}
        let record=try await record(documentID)
        if backgroundWrite,hasEditorSession(documentID:documentID) {
            guard let disk=try await library.readIfPresent(notebookID:record.notebookID,path:record.path) else {throw MapleError.invalid("The managed file is unavailable.")}
            return try await snapshot(record,disk)
        }
        try ManagedMarkdown.validate(content,documentID:documentID)
        let receipts=try ManagedMarkdown.automaticReceiptIDs(acceptedAutomaticBlockIDs)
        let replyReceipts=try ManagedMarkdown.replyReceiptIDs(acceptedReplyRunIDs)
        let existing=try await library.readIfPresent(notebookID:record.notebookID,path:record.path)
        let prior=try await store.documentMutation(commandID)
        if preserveDraft || backgroundWrite,let draft=try await library.readDraft(notebookID:record.notebookID,path:record.path) {
            let pendingReceipts=try await hasPendingDraftReceipts(draft,documentID:documentID)
            if backgroundWrite,pendingReceipts,let existing {
                return try await snapshot(record,existing)
            }
            if pendingReceipts || (preserveDraft && draft.content != existing?.content && draft.content != content) {
                throw MapleError.invalid("A newer user draft is pending. The generated response is retained but cannot replace that draft.")
            }
        }
        // Generated writes and command replay never replace a newer user draft. New user
        // commands persist their draft before file mutation or revision-conflict detection.
        if prior==nil && !preserveDraft {
            try await library.preserveCommitDraft(NotebookDocument(notebookID:record.notebookID,path:record.path,content:content,revision:expectedRevision ?? "",acceptedAutomaticBlockIDs:receipts.isEmpty ? nil:receipts,acceptedReplyRunIDs:replyReceipts.isEmpty ? nil:replyReceipts))
            commitObserver?(.draftPersisted,commandID)
        }
        let proposal=DocumentMutationRecord(commandID:commandID,documentID:documentID,expectedRevision:expectedRevision,targetRevision:ManagedMarkdown.hash(content),before:existing?.content,after:content,state:"prepared",createdAt:Date(),acceptedAutomaticBlockIDs:receipts.isEmpty ? nil:receipts,acceptedReplyRunIDs:replyReceipts.isEmpty ? nil:replyReceipts)
        if let old=prior {
            let replay=try await store.prepareDocumentMutation(proposal)
            guard replay.state=="committed" || replay.state=="prepared" else {throw MapleError.invalid("This command previously conflicted. Recover the draft with a new command.")}
            if old.state=="committed" {
                guard let disk=existing else {throw MapleError.invalid("The saved file has since been removed; the original command remains committed.")}
                guard disk.revision==old.targetRevision else {throw MapleError.invalid("The original save completed, but this file has changed since then. Your draft and committed history are preserved. Reopen the current file or save a recovery copy before continuing.")}
                if !preserveDraft {
                    try await library.rebaseDraftAfterCommit(notebookID:record.notebookID,path:record.path,expectedRevision:old.expectedRevision,targetRevision:old.targetRevision)
                }
                var result=try await snapshot(record,disk);result.commandID=commandID;result.state="committed";return result
            }
        } else {
            guard existing?.revision==expectedRevision else {
                let conflict=try await store.prepareDocumentMutation(proposal)
                try await store.markDocumentConflict(conflict)
                throw MapleError.invalid("This note changed in another app. Your draft and attempted save are kept in history. Reload the file or save a recovery copy.")
            }
        }
        let mutation=try await store.prepareDocumentMutation(proposal)
        commitObserver?(.journalPrepared,commandID)
        if existing?.revision != mutation.targetRevision {
            guard existing?.revision==mutation.expectedRevision else {try await store.markDocumentConflict(mutation);throw MapleError.invalid("An interrupted save conflicts with external changes. Your draft and both revisions are retained.")}
            _ = try await library.save(notebookID:record.notebookID,path:record.path,content:mutation.after,expectedRevision:mutation.expectedRevision)
            commitObserver?(.fileReplaced,commandID)
        }
        try await store.finalizeDocumentMutation(mutation)
        commitObserver?(.finalized,commandID)
        do {
            try await store.drainDocumentOutbox()
            commitObserver?(.outboxDrained,commandID)
        } catch {} // Indexing remains recoverable; preserve the existing saved-file success contract.
        guard let disk=try await library.readIfPresent(notebookID:record.notebookID,path:record.path) else{throw MapleError.invalid("The file was removed after saving. Recover it from history.")}
        guard disk.revision==mutation.targetRevision else {throw MapleError.invalid("The save completed, but the file changed again before acknowledgment. The committed version remains in history. Reopen the current file or save a recovery copy before continuing.")}
        if !preserveDraft {
            try await library.rebaseDraftAfterCommit(notebookID:record.notebookID,path:record.path,expectedRevision:mutation.expectedRevision,targetRevision:mutation.targetRevision)
        }
        var result=try await snapshot(record,disk);result.commandID=commandID;result.state="committed";return result
    }
    public func draft(documentID:String,revision:String,content:String,acceptedAutomaticBlockIDs:[String]=[],acceptedReplyRunIDs:[String]=[]) async throws {
        let record=try await record(documentID)
        let receipts=try ManagedMarkdown.automaticReceiptIDs(acceptedAutomaticBlockIDs)
        let replyReceipts=try ManagedMarkdown.replyReceiptIDs(acceptedReplyRunIDs)
        try await library.saveDraft(NotebookDocument(notebookID:record.notebookID,path:record.path,content:content,revision:revision,acceptedAutomaticBlockIDs:receipts.isEmpty ? nil:receipts,acceptedReplyRunIDs:replyReceipts.isEmpty ? nil:replyReceipts))
    }
    public func recoveryCopy(documentID:String,content:String,recoveryKey:String?=nil) async throws -> NotebookDocument {
        try await acquire([documentID]);defer{release([documentID])}
        let record=try await record(documentID)
        if let recoveryKey {guard !recoveryKey.isEmpty,recoveryKey.utf8.count<=256 else {throw MapleError.invalid("A bounded recovery identity is required.")}}
        let suffix=recoveryKey.map {ManagedMarkdown.hash(documentID+"\n"+$0+"\n"+content)} ?? String(UUID().uuidString.prefix(8))
        let name=URL(fileURLWithPath:record.path).deletingPathExtension().lastPathComponent+"-recovery-"+suffix
        // A recovery file is deliberately unmanaged: retain exact bytes for inspection, but do not
        // register its copied identity or permit canonical mutations against it.
        let directory:String
        if let day=record.day {directory=try await library.prepareDailyDirectory(notebookID:record.notebookID,day:day)}
        else {directory=(record.path as NSString).deletingLastPathComponent}
        let path=(directory.isEmpty ? "":directory+"/")+name+".md"
        if recoveryKey != nil,let existing=try await library.readIfPresent(notebookID:record.notebookID,path:path) {
            guard existing.content==content else {throw MapleError.invalid("The recovery file was edited. Its writing has been preserved.")}
            return existing
        }
        return try await library.save(notebookID:record.notebookID,path:path,content:content,expectedRevision:nil)
    }
    public func insertSource(documentID:String,expectedRevision:String,commandID:String,eventID:String) async throws -> TodayDocumentSnapshot {
        if let prior=try await store.documentMutation(commandID) {
            let blockID="source-"+ManagedMarkdown.hash(commandID)
            guard prior.documentID==documentID,prior.expectedRevision==expectedRevision,try ManagedMarkdown.segments(prior.after).first(where:{$0.id==blockID})?.eventID==eventID else {throw MapleError.invalid("This insertion command was reused for a different source.")}
            return try await commit(documentID:documentID,expectedRevision:expectedRevision,content:prior.after,commandID:commandID)
        }
        guard let event=try await store.event(eventID) else {throw MapleError.invalid("This source is unavailable.")}
        let current=try await open(documentID:documentID)
        guard current.revision==expectedRevision else {throw MapleError.invalid("The note changed. Reload before inserting this source.")}
        let kind=ManagedMarkdown.referenceKind(connector:event.source.connector)
        let value:[String:Any] = ["v":1,"kind":kind,"eventID":eventID,"label":String(event.content.prefix(120))]
        let reference=String(decoding:try JSONSerialization.data(withJSONObject:value,options:.sortedKeys),as:UTF8.self)
        let marker=try ManagedMarkdown.marker(["id":"source-"+ManagedMarkdown.hash(commandID)])
        return try await commit(documentID:documentID,expectedRevision:expectedRevision,content:current.content+"\n\n"+marker+"```maple-ref\n"+reference+"\n```\n",commandID:commandID)
    }
    func record(_ id:String) async throws -> ManagedDocumentRecord {
        guard let record=try await store.managedDocument(id:id) else{throw MapleError.invalid("Open a registered managed document first.")};return record
    }
    private func hasPendingDraftReceipts(_ draft:NotebookDocument,documentID:String) async throws -> Bool {
        for id in draft.acceptedAutomaticBlockIDs ?? [] {
            if try await store.automaticIdentityUnused(id) {return true}
        }
        for id in draft.acceptedReplyRunIDs ?? [] {
            if let run=try? await store.inlineMapleRun(id),run.request.documentID == documentID,run.status == "unapplied" {return true}
        }
        return false
    }
    func snapshot(_ record:ManagedDocumentRecord,_ disk:NotebookDocument) async throws -> TodayDocumentSnapshot {
        var warning:String?
        do {try ManagedMarkdown.validate(disk.content,documentID:record.documentID)} catch {warning=error.localizedDescription}
        var result=TodayDocumentSnapshot(documentID:record.documentID,notebookID:record.notebookID,path:record.path,day:record.day ?? "",timeZone:record.timeZone,content:disk.content,revision:disk.revision,draft:try await library.readDraft(notebookID:record.notebookID,path:record.path),readOnly:warning != nil,warning:warning,indexingPending:try await store.documentIndexingPending(documentID:record.documentID),legacyMigrationAvailable:false)
        if result.draft?.content == disk.content {result.draft?.revision=disk.revision}
        if let receipts=result.draft?.acceptedAutomaticBlockIDs {
            var pending:[String]=[]
            for id in receipts where try await store.automaticIdentityUnused(id) {pending.append(id)}
            result.draft?.acceptedAutomaticBlockIDs=pending.isEmpty ? nil:pending
        }
        if let replies=result.draft?.acceptedReplyRunIDs {
            var pending:[String]=[]
            for id in replies {
                if let run=try? await store.inlineMapleRun(id),run.request.documentID == record.documentID,run.status == "unapplied" {pending.append(id)}
            }
            result.draft?.acceptedReplyRunIDs=pending.isEmpty ? nil:pending
        }
        let blocks=try await store.documentBlocks(documentID:record.documentID)
        result.blocks=blocks.filter{$0.state=="active"};result.cleared=blocks.filter{$0.state=="cleared"}
        return result
    }
    static func export(_ snapshot:DailyNoteSnapshot,documentID:String) throws -> String {
        var text=ManagedMarkdown.header(documentID:documentID,day:snapshot.day,timeZone:snapshot.timeZone)
        for block in snapshot.blocks {
            var fields=["id":block.id]
            if let task=block.taskNodeID {fields["taskID"]=task}
            text += try ManagedMarkdown.marker(fields)
            if let source=block.source {
                let object:[String:Any] = ["v":1,"kind":block.kind.rawValue,"eventID":source.eventID,"label":source.title ?? block.content]
                text += "```maple-ref\n"+String(decoding:try JSONSerialization.data(withJSONObject:object,options:.sortedKeys),as:UTF8.self)+"\n```\n"
                if block.userEdited {text += "\n"+block.content+"\n"}
            } else {
                switch block.kind {
                case .heading:text += "## "+block.content+"\n"
                case .task:text += "- ["+(block.completedAt == nil ? " ":"x")+"] "+block.content+"\n"
                case .code:
                    let fence=String(repeating:"`",count:max(3,(block.content.components(separatedBy:"\n").map{$0.prefix(while:{$0=="`"}).count}.max() ?? 0)+1))
                    text += fence+"\n"+block.content+"\n"+fence+"\n"
                default:text += block.content+"\n"
                }
            }
            text += "\n"
        }
        try ManagedMarkdown.validate(text,documentID:documentID)
        return text
    }
}

extension TodayDocumentCoordinator {
    /// First managed insertion into an ordinary notebook joins the same journal without
    /// changing its relative path or assigning it a daily date.
    public func register(notebookID:String,path:String,expectedRevision:String) async throws -> TodayDocumentSnapshot {
        let key="register:"+notebookID+":"+path
        try await acquire([key]);defer{release([key])}
        if let existing=try await store.managedDocument(notebookID:notebookID,path:path) {return try await open(documentID:existing.documentID)}
        let disk=try await library.read(notebookID:notebookID,path:path)
        guard disk.revision==expectedRevision else {throw MapleError.invalid("This note changed. Reload before registering its first managed block.")}
        if let id=ManagedMarkdown.documentID(disk.content) {
            try ManagedMarkdown.validate(disk.content,documentID:id)
            let record=ManagedDocumentRecord(documentID:id,notebookID:notebookID,path:path,day:nil,timeZone:TimeZone.current.identifier,revision:disk.revision)
            try await store.registerManagedDocument(record,initialContent:disk.content,initialBefore:disk.content)
            return try await commit(documentID:id,expectedRevision:disk.revision,content:disk.content,commandID:"create:"+id)
        }
        let id=UUID().uuidString.lowercased()
        let fields="maple:\n  format: 1\n  document: \"\(id)\"\n"
        let content:String
        if disk.content.hasPrefix("---\n") {
            guard let end=disk.content.dropFirst(4).range(of:"\n---\n") else{throw MapleError.invalid("This frontmatter needs source-mode review before adding managed blocks.")}
            let front=String(disk.content[..<end.lowerBound])
            guard front.range(of:#"(?m)^maple\s*:"#,options:.regularExpression)==nil else {throw MapleError.invalid("This note already uses the reserved maple frontmatter namespace. Import it explicitly without overwriting that metadata.")}
            content=front+"\n"+fields+disk.content[end.lowerBound...].dropFirst()
        } else {
            guard !disk.content.hasPrefix("---\r"),!disk.content.hasPrefix("+++") else{throw MapleError.invalid("This metadata format needs source-mode review before adding managed blocks.")}
            content="---\n"+fields+"---\n\n"+disk.content
        }
        let record=ManagedDocumentRecord(documentID:id,notebookID:notebookID,path:path,day:nil,timeZone:TimeZone.current.identifier,revision:disk.revision)
        try await store.registerManagedDocument(record,initialContent:content,initialBefore:disk.content)
        return try await commit(documentID:id,expectedRevision:disk.revision,content:content,commandID:"create:"+id)
    }
}

extension TodayDocumentCoordinator {
    /// Startup resumes journaled work without creating days or importing legacy notes.
    /// Unavailable notebooks and external conflicts stay explicit; reservations never expire.
    public func recoverPendingDocuments() async throws -> DocumentRecoveryReport {
        _ = try await library.catalog()
        let documents=try await store.pendingManagedDocuments()
        var issues:[DocumentRecoveryIssue]=[],recovered=0
        for record in documents.prefix(100) {
            do {
                if hasEditorSession(documentID:record.documentID) {continue}
                let result=try await open(documentID:record.documentID,backgroundRead:true)
                if let warning=result.warning {issues.append(.init(documentID:record.documentID,path:record.path,message:warning))}
                else {recovered += 1}
            } catch {
                issues.append(.init(documentID:record.documentID,path:record.path,message:"This document needs recovery. Reconnect its notebook or open its history to reconcile external edits. Pending linked-task actions remain unacknowledged."))
            }
        }
        return DocumentRecoveryReport(recoveredCount:recovered,issues:issues,hasMore:documents.count>100)
    }
}
