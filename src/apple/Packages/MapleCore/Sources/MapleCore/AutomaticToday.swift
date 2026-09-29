import Foundation

struct AutomaticTodayCandidate:Sendable {
    let blockID:String
    let markdown:String
    let actionItem:Bool
}

extension KnowledgeStore {
    /// Queries only classified recent observations or explicitly scheduled canonical work.
    /// The ledger and global block index are suppression records, not prose authority.
    func automaticTodayCandidates(documentID:String,content:String,at:Date) throws -> [AutomaticTodayCandidate] {
        guard let document=try managedDocument(id:documentID),let day=document.day,
              day == (try ManagedMarkdown.day(at:at,timeZone:document.timeZone)),
              let zone=TimeZone(identifier:document.timeZone) else{return []}
        var calendar=Calendar(identifier:.gregorian);calendar.timeZone=zone
        let end=calendar.date(byAdding:.day,value:1,to:calendar.startOfDay(for:at))!
        let count=Int(try db.rows("SELECT COUNT(*) AS n FROM document_auto_insertions WHERE document_id=?",[documentID]).first?["n"] ?? "0") ?? 0
        let remaining=max(0,64-count)
        guard remaining>0 else{return []}
        let cutoff=String(at.addingTimeInterval(-24*60*60).timeIntervalSince1970),now=String(at.timeIntervalSince1970)
        let segments=try ManagedMarkdown.segments(content)
        let visibleTaskIDs=Set(segments.compactMap{$0.metadata["taskID"] as? String})
        var visibleSourceKeys=Set<String>()
        for id in segments.compactMap(\.eventID) {if let source=try event(id)?.source {visibleSourceKeys.insert(try automaticSourceKey(source))}}
        let latest="NOT EXISTS (SELECT 1 FROM events newer WHERE newer.connector=e.connector AND newer.account=e.account AND newer.external_id=e.external_id AND (newer.received_at>e.received_at OR (newer.received_at=e.received_at AND newer.rowid>e.rowid)))"
        let active="NOT EXISTS (SELECT 1 FROM connector_source_records r WHERE r.connector=e.connector AND r.id=e.external_id AND r.active=0)"
        let evidence="""
        EXISTS (SELECT 1 FROM json_each(t.json,'$.evidenceIDs') evidence
          JOIN events e ON e.id=evidence.value
          JOIN processing_jobs p ON p.event_id=e.id AND p.status='succeeded'
          JOIN decisions d ON d.event_id=e.id
          WHERE e.received_at>=? AND e.received_at<=? AND e.occurred_at>=? AND e.occurred_at<=?
          AND e.connector NOT LIKE 'notes%' AND e.connector != 'user' AND \(latest) AND \(active))
        """
        let scheduled="COALESCE(json_extract(t.json,'$.scheduled'),json_extract(t.json,'$.due'))"
        let taskRows=try db.rows("""
          SELECT t.json FROM life_tasks t LEFT JOIN document_task_schedule schedule ON schedule.task_id=t.id
          WHERE json_extract(t.json,'$.status') IN ('open','in_progress')
          AND COALESCE(json_extract(t.json,'$.actionState.resurfaceAt'),0)<=?
          AND NOT EXISTS (SELECT 1 FROM document_block_index b WHERE json_extract(b.json,'$.taskID')='task:'||t.id)
          AND (\(scheduled) IS NULL OR schedule.boundary<?)
          AND (\(evidence) OR schedule.boundary<?)
          ORDER BY CASE WHEN \(scheduled) IS NOT NULL THEN 0 ELSE 1 END, json_extract(t.json,'$.priority') DESC,t.rowid DESC LIMIT 256
          """,[now,String(end.timeIntervalSince1970),cutoff,now,cutoff,now,String(end.timeIntervalSince1970)])
        var result:[AutomaticTodayCandidate]=[]
        var taskEvidenceIDs=Set<String>()
        for row in taskRows {
            let task=try JSONCodec.decode(LifeTask.self,from:Data(row["json"]!.utf8))
            guard !task.status.terminal,task.status != .waiting,!(task.actionState?.isDeferred(at:at) ?? false),!visibleTaskIDs.contains("task:"+task.id) else{continue}
            if let scheduled=task.scheduled ?? task.due {guard (try? scheduled.boundary()).map({$0<end}) == true else{continue}}
            let id="auto-task:"+ManagedMarkdown.hash(task.id)
            guard try automaticIdentityUnused(id) else{continue}
            let title=task.title.replacingOccurrences(of:"\r",with:" ").replacingOccurrences(of:"\n",with:" ").map {c in "\\`*_{}[]<>()#+-.!|~".contains(c) ? "\\"+String(c):String(c)}.joined()
            taskEvidenceIDs.formUnion(task.evidenceIDs)
            result.append(AutomaticTodayCandidate(blockID:id,markdown:(try ManagedMarkdown.marker(["id":id,"taskID":"task:"+task.id]))+"- [ ] "+title+"\n",actionItem:true))
            if result.count>=min(32,remaining) {break}
        }
        guard result.count<remaining else{return result}
        for id in visibleTaskIDs {if let task=try taskNode(id) {taskEvidenceIDs.formUnion(task.evidenceIDs)}}
        let excludedEvidence=taskEvidenceIDs.sorted()
        let selectedEvidenceClause=excludedEvidence.isEmpty ? "1=1" : "NOT EXISTS (SELECT 1 FROM events linked WHERE linked.id IN (SELECT value FROM json_each(?)) AND linked.connector=e.connector AND linked.account=e.account AND linked.external_id=e.external_id)"
        let evidenceParameters=excludedEvidence.isEmpty ? [] : [try JSONCodec.string(excludedEvidence)]
        let sourceRows=try db.rows("""
          SELECT e.json FROM events e
          JOIN processing_jobs p ON p.event_id=e.id AND p.status='succeeded'
          JOIN decisions d ON d.event_id=e.id
          WHERE e.received_at>=? AND e.received_at<=? AND e.occurred_at>=? AND e.occurred_at<=?
          AND json_extract(d.json,'$.route') IN ('notify','ask_user','summarize')
          AND EXISTS (SELECT 1 FROM work_items w WHERE w.event_id=e.id AND ((w.status='unread' AND w.kind IN ('notify','ask_user')) OR (w.status='proposed' AND w.kind='summarize')) AND w.kind=json_extract(d.json,'$.route'))
          AND e.connector NOT LIKE 'notes%' AND e.connector != 'user' AND \(latest) AND \(active)
          AND NOT EXISTS (SELECT 1 FROM document_block_index b JOIN events old ON old.id=b.event_id WHERE old.connector=e.connector AND old.account=e.account AND old.external_id=e.external_id)
          AND NOT EXISTS (SELECT 1 FROM document_block_index b JOIN life_tasks t ON json_extract(b.json,'$.taskID')='task:'||t.id JOIN json_each(t.json,'$.evidenceIDs') evidence JOIN events linked ON linked.id=evidence.value WHERE linked.connector=e.connector AND linked.account=e.account AND linked.external_id=e.external_id)
          AND \(selectedEvidenceClause)
          ORDER BY CASE WHEN json_extract(d.json,'$.route')='summarize' THEN 1 ELSE 0 END,e.received_at DESC,e.rowid DESC LIMIT 64
          """,[cutoff,now,cutoff,now]+evidenceParameters)
        var sources=0
        for row in sourceRows {
            let event=try JSONCodec.decode(Event.self,from:Data(row["json"]!.utf8))
            let key=try automaticSourceKey(event.source),id="auto-source:"+ManagedMarkdown.hash(key)
            guard !visibleSourceKeys.contains(key),try automaticIdentityUnused(id) else{continue}
            let decision=try self.decision(eventID:event.id)
            let headers=event.content.components(separatedBy:"\n").prefix(16)
            let title=headers.first(where:{$0.hasPrefix("Subject: ") || $0.hasPrefix("Title: ")}).map{String($0.dropFirst($0.hasPrefix("Subject:") ? 9:7))}
            let label=String((title ?? headers.first(where: { !$0.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty }) ?? "Captured source").prefix(180))
            let kind=ManagedMarkdown.referenceKind(connector:event.source.connector)
            let data:[String:Any]=["v":1,"kind":kind,"eventID":event.id,"label":label]
            let reference=String(decoding:try JSONSerialization.data(withJSONObject:data,options:.sortedKeys),as:UTF8.self)
            result.append(AutomaticTodayCandidate(blockID:id,markdown:(try ManagedMarkdown.marker(["id":id]))+"```maple-ref\n"+reference+"\n```\n",actionItem:decision?.route == .notify || decision?.route == .askUser));sources+=1
            if sources>=32 || result.count>=remaining {break}
        }
        return result
    }
    private func automaticIdentityUnused(_ id:String) throws -> Bool {
        try documentBlock(id:id)==nil && db.rows("SELECT block_id FROM document_auto_insertions WHERE block_id=?",[id]).isEmpty && db.rows("SELECT block_id FROM document_identities WHERE block_id=?",[id]).isEmpty
    }
    private func automaticSourceKey(_ source:Source) throws -> String {try JSONCodec.string([source.connector,source.account,source.externalID])}
}

extension TodayDocumentCoordinator {
    /// Append only; a user draft or an external edit wins over background projection.
    public func refreshAutomatic(documentID:String,at:Date=Date()) async throws -> TodayDocumentSnapshot {
        let current=try await open(documentID:documentID)
        guard !current.readOnly,current.day == (try ManagedMarkdown.day(at:at,timeZone:current.timeZone)) else{return current}
        let candidates=try await store.automaticTodayCandidates(documentID:documentID,content:current.content,at:at)
        guard !candidates.isEmpty else{return current}
        if let draft=current.draft,draft.content != current.content {
            var pending=current;pending.warning="New action items or FYIs are waiting. They will be added after your draft is saved.";return pending
        }
        var content=current.content
        for (actionItem,title) in [(true,"Action items"),(false,"FYI")] {
            let group=candidates.filter{$0.actionItem==actionItem};guard !group.isEmpty else{continue}
            let heading="auto-heading:"+ManagedMarkdown.hash(documentID+title)
            let addition=group.map(\.markdown).joined(separator:"\n")
            let segments=try ManagedMarkdown.segments(content)
            if let index=segments.firstIndex(where:{$0.id==heading}) {
                let next=segments.dropFirst(index+1).first {segment in
                    let body=segment.content.components(separatedBy:"\n").dropFirst().joined(separator:"\n").trimmingCharacters(in:.whitespacesAndNewlines)
                    return body.range(of:#"^#{1,6} "#,options:.regularExpression) != nil
                }
                let insertion=next?.range.location ?? (content as NSString).length
                content=(content as NSString).replacingCharacters(in:NSRange(location:insertion,length:0),with:"\n"+addition+"\n")
            } else if try await store.documentBlock(id:heading)==nil {
                content += "\n\n"+(try ManagedMarkdown.marker(["id":heading]))+"## "+title+"\n\n"+addition
            } else {content += "\n\n"+addition}

        }
        let command="auto-today:"+ManagedMarkdown.hash(documentID+current.revision+candidates.map(\.blockID).joined(separator:"|"))
        return try await commit(documentID:documentID,expectedRevision:current.revision,content:content,commandID:command,preserveDraft:true)
    }
}
