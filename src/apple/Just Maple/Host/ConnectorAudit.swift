import Foundation
import MapleCore

extension AppModel {
    func runConnectorAudit(query:String,local:Bool = false) async {
        guard !auditRunning,!busy,let store,let classifier else {auditStatus="Pause or finish current work and connect Jev before running the audit.";return}
        let resumeLoop=running
        auditRunning=true;busy=true;running=false
        defer {auditRunning=false;busy=false;running=resumeLoop && connected}
        var messages=0,mail=0,completed=0,deferred=0
        do {
            auditStatus="Importing 30 days of Messages history…"
            do {if !local {messages=try await IMessageConnector.poll(store:store,historyDays:30);messagesEnabled=true;messagesStatus="Audit imported \(messages) historical messages"}}
            catch {messagesError=error.localizedDescription}
            auditStatus="Reading Gmail history matching your query…"
            let events:[Event]
            if local {events=try await store.auditCommunication(query:query)}
            else {events=try await GoogleAPI(token:googleAccess()).recentMail(account:googleSettings.account,query:query,limit:100);mail=try await store.ingestGoogleMail(events)}
            var ids:[String]=[]
            for event in events {ids.append(try await store.ingest(event))}
            auditStatus="Imported \(messages) messages and \(mail) email observations. Inspecting \(ids.count) emails."
            await refresh()
            for (index,id) in ids.enumerated() {
                if Task.isCancelled {break}
                auditStatus="Classifying email \(index+1)/\(ids.count) with Jev, then extracting supported facts/tasks with the selected provider…"
                let report=try await IntelligenceEngine(store:store,classifier:classifier).run(limit:1,eventIDs:[id]);completed+=report.completed;deferred+=report.deferred
                _ = try await FactExtractionEngine(store:store,extractor:factExtractor).runOne(eventIDs:[id])
                // Explicit audit requests task review even for a previously processed source.
                if try await store.event(id)?.source.connector == "gmail" {try await store.requestTaskExtraction(eventID:id)}
                _ = try await TaskExtractionEngine(store:store,extractor:taskExtractor).runOne(eventIDs:[id])
                await refresh()
            }
            auditStatus="Audit finished: \(messages) new Messages, \(mail) new emails; \(completed) Jev classifications, \(deferred) deferred. Review source facts and suggested tasks; no replies were sent."
        } catch {auditStatus="Audit stopped: \(error.localizedDescription). Imported observations are retained."}
        await refresh()
    }
}
