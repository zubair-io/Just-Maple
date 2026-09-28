import Foundation
import MapleNotebooks

extension TodayDocumentCoordinator {
    public func mutateBlock(_ input:DocumentBlockMutation) async throws -> TodayDocumentSnapshot {
        guard ["clear","restore","move","copy","complete","reopen"].contains(input.kind),!input.commandID.isEmpty,input.commandID.utf8.count<=240 else {throw MapleError.invalid("Choose a supported block action and command identity.")}
        if var prior=try await store.documentOperation(commandID:input.commandID) {
            prior.input=input
            let replay=try await store.prepareDocumentOperation(prior)
            if replay.state != "committed" {try await recoverOperation(replay)}
            return try await open(documentID:input.documentID)
        }
        let source=try await open(documentID:input.documentID)
        guard !source.readOnly,source.revision==input.expectedRevision,let block=try await store.documentBlock(id:input.blockID),block.documentID==input.documentID,block.version==input.expectedBlockVersion else {throw MapleError.invalid("This block or document changed. Your draft is preserved; reload before applying this action.")}
        let segment=try ManagedMarkdown.segments(source.content).first{$0.id==input.blockID}
        if input.kind=="restore" {
            guard block.state=="cleared",segment==nil else {throw MapleError.invalid("Only a cleared block can be restored.")}
        } else {
            guard block.state=="active",let segment,segment.content==block.content else {throw MapleError.invalid("The file's block changed outside Maple. Save or reconcile it before applying an action.")}
        }
        var sourceAfter=source.content
        var target:TodayDocumentSnapshot?
        var taskID:String?
        switch input.kind {
        case "clear":sourceAfter=(source.content as NSString).replacingCharacters(in:segment!.range,with:"")
        case "restore":sourceAfter += "\n\n"+block.content
        case "move", "copy":
            guard let day=input.targetDay,day != source.day else {throw MapleError.invalid("Choose a different day for this block.")}
            target=try await open(notebookID:source.notebookID,day:day,timeZone:source.timeZone)
            guard target?.readOnly==false else {throw MapleError.invalid("Review and import the destination day before moving a block into it.")}
            if input.kind=="move" {sourceAfter=(source.content as NSString).replacingCharacters(in:segment!.range,with:"")}
        case "complete", "reopen":
            taskID=block.taskID
            if taskID != nil {guard input.expectedTaskVersion != nil else {throw MapleError.invalid("A linked task needs its current canonical version.")}}
            let regex=try NSRegularExpression(pattern:input.kind=="reopen" ? #"(?m)^(\s*[-*+] \[)[xX](\])"# : #"(?m)^(\s*[-*+] \[) (\])"#)
            let original=segment!.content,ns=original as NSString
            guard let match=regex.firstMatch(in:original,range:NSRange(location:0,length:ns.length)) else{throw MapleError.invalid("This block is not an unfinished checklist task.")}
            var completed=ns.replacingCharacters(in:NSRange(location:match.range(at:1).location+match.range(at:1).length,length:1),with:input.kind=="reopen" ? " ":"x")
            if taskID != nil {
                var fields=segment!.metadata;fields["taskCommandID"]=input.commandID
                let marker=String(decoding:try JSONSerialization.data(withJSONObject:fields,options:.sortedKeys),as:UTF8.self).replacingOccurrences(of:">",with:"\\u003e").replacingOccurrences(of:"<",with:"\\u003c")
                if let end=completed.range(of:"\n") {completed="<!-- maple:block "+marker+" -->"+completed[end.lowerBound...]}
            }
            sourceAfter=(source.content as NSString).replacingCharacters(in:segment!.range,with:completed)
        default:break
        }
        let ids=([source.documentID]+(target.map{[$0.documentID]} ?? [])).sorted()
        try await acquire(ids);defer{release(ids)}
        let now=Date()
        var files=[DocumentMutationRecord(commandID:input.commandID+":0",documentID:source.documentID,expectedRevision:source.revision,targetRevision:ManagedMarkdown.hash(sourceAfter),before:source.content,after:sourceAfter,state:"operationPrepared",createdAt:now)]
        if let target {
            let copied=try input.kind=="copy" ? ManagedMarkdown.remapCopiedIdentities(block.content,commandID:input.commandID):block.content
            let after=target.content+"\n\n"+copied
            files.append(DocumentMutationRecord(commandID:input.commandID+":1",documentID:target.documentID,expectedRevision:target.revision,targetRevision:ManagedMarkdown.hash(after),before:target.content,after:after,state:"operationPrepared",createdAt:now))
        }
        // Save all drafts before the transactional intent/reservation, then write files.
        for file in files {
            let doc=try await record(file.documentID)
            try await library.preserveCommitDraft(NotebookDocument(notebookID:doc.notebookID,path:doc.path,content:file.after,revision:file.expectedRevision ?? ""))
        }
        let operation=try await store.prepareDocumentOperation(DocumentOperation(input:input,files:files,taskID:taskID,state:"prepared"))
        try await applyOperationFiles(operation)
        try? await store.drainDocumentOutbox()
        let record=try await record(source.documentID)
        let disk=try await library.read(notebookID:record.notebookID,path:record.path)
        return try await snapshot(record,disk)
    }
    func recoverOperation(_ operation:DocumentOperation,alreadyLocked:String?=nil) async throws {
        let ids=operation.files.map(\.documentID).filter{$0 != alreadyLocked}.sorted()
        if alreadyLocked != nil {
            // An open already owns one participant. Do not wait while holding it:
            // another participant may be recovering the same operation concurrently.
            guard ids.allSatisfy({!busy.contains($0)}) else{throw MapleError.invalid("Another document in this action is busy.")}
            busy.formUnion(ids)
        } else {try await acquire(ids)}
        defer{release(ids)}
        try await applyOperationFiles(operation)
    }
    func applyOperationFiles(_ operation:DocumentOperation) async throws {
        // Preflight every participant before changing any file; still recheck inside coordination.
        for file in operation.files {
            let doc=try await record(file.documentID)
            let disk=try await library.readIfPresent(notebookID:doc.notebookID,path:doc.path)
            guard disk?.revision==file.expectedRevision || disk?.revision==file.targetRevision else {
                try await store.markDocumentOperationConflict(operation)
                throw MapleError.invalid("An external edit conflicts with this pending block action. Its before/after versions and task reservation are preserved.")
            }
        }
        for file in operation.files {
            let doc=try await record(file.documentID)
            let disk=try await library.readIfPresent(notebookID:doc.notebookID,path:doc.path)
            if disk?.revision != file.targetRevision {_ = try await library.save(notebookID:doc.notebookID,path:doc.path,content:file.after,expectedRevision:file.expectedRevision)}
        }
        try await store.finalizeDocumentOperation(operation)
    }
}

extension TodayDocumentCoordinator {
    public func resolveOperation(documentID:String,commandID:String,resolution:String) async throws -> TodayDocumentSnapshot {
        guard let operation=try await store.documentOperation(commandID:commandID),operation.files.contains(where:{$0.documentID==documentID}) else{throw MapleError.invalid("Choose a pending action belonging to this document.")}
        switch resolution {
        case "retry":try await recoverOperation(operation)
        case "abandon":
            if operation.input.kind=="move" {
                for file in operation.files {
                    let record=try await record(file.documentID)
                    guard try await library.readIfPresent(notebookID:record.notebookID,path:record.path)?.revision==file.expectedRevision else {throw MapleError.invalid("A partially written move cannot be abandoned. Restore the preserved before versions or resolve external edits and retry so its identity stays unique.")}
                }
            }
            try await store.abandonDocumentOperation(commandID:commandID)
        default:throw MapleError.invalid("Choose Retry or explicitly abandon the pending action.")
        }
        return try await open(documentID:documentID)
    }
}
