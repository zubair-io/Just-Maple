import Foundation
public enum TaskReconciliationEvaluation {
    public static func run(client:ACPClient)async throws->[String:String] {
        let store=try KnowledgeStore(path:":memory:"),now=Date()
        let requests=[
            ("Return the signed release for the pottery workshop", "Please return the signed release form for your pottery workshop enrollment.","pottery"),
            ("Send your pottery workshop waiver", "Reminder: we still need the signed release form for the same pottery workshop enrollment.","pottery"),
            ("Pay Orion's equipment rental invoice", "Please pay invoice R-152 for the equipment rental from Orion.","invoice"),
            ("Return the borrowed equipment to Orion", "Please return the borrowed projector to Orion's front desk.","equipment"),
            ("Send your speaker headshot", "Please send the speaker headshot for next month's conference.","headshot"),
            ("Complete workshop registration", "Complete workshop registration: upload your photo and sign the participation agreement. Both are required.","registration"),
            ("Upload the workshop registration photo", "Please upload the photo required for workshop registration.","registration"),
            ("Submit the venue access form", "Please submit the venue access form to finish your access application.","venue")
        ]
        var ids:[String]=[]
        for (i,item) in requests.enumerated() {
            let event=Event(type:"message.received",source:Source(connector:"gmail",account:"synthetic-evaluation",externalID:"request-\(i)",revision:"1"),occurredAt:now.addingTimeInterval(Double(-1000+i)),subjects:["person:self","thread:gmail:"+item.2],content:"Direction: incoming\nTo: fixture-user\nBody:\n"+item.1)
            try await store.ingest(event)
            var s=TaskSuggestion();s.eventID=event.id;s.provider="synthetic-fixture";s.quote=item.1;s.candidate.title=item.0;s.candidate.description=item.1
            ids.append(try await store.offerTask(s).id)
        }
        for (thread,body) in [("headshot","I will send the speaker headshot tomorrow."),("registration","I uploaded the workshop photo; I have not signed the participation agreement yet."),("venue","I submitted the venue access form. The access application is now complete.")] {
            try await store.ingest(Event(type:"message.received",source:Source(connector:"gmail",account:"synthetic-evaluation",externalID:"reply-"+thread,revision:"1"),occurredAt:now.addingTimeInterval(-100),subjects:["person:self","thread:gmail:"+thread],content:"Direction: outgoing\nBody:\n"+body))
        }
        try await TaskReconciliationEngine(store:store,client:client).runOne()
        let snapshot=try await store.worldSnapshot()
        func root(_ i:Int)->String {var id="source:"+ids[i];var seen=Set<String>();while seen.insert(id).inserted,let r=snapshot.taskRelations.first(where:{$0.duplicateID==id}) {id=r.primaryID};return id}
        func status(_ i:Int)->TaskStatus? {snapshot.suggestions.first{$0.id==ids[i]}?.candidate.status}
        let duplicates=root(0)==root(1),differentActions=root(2) != root(3),promise=status(4) == .open,umbrella=root(5) != root(6) && status(5) != .completed,completed=status(7) == .completed
        return ["mode":"live provider with synthetic task fixtures","paraphraseCombined":String(duplicates),"sameCompanyDifferentActionsSeparate":String(differentActions),"promiseRemainsOpen":String(promise),"partialChecklistNotCompleted":String(umbrella),"explicitCompletionRecognized":String(completed),"passed":String(duplicates && differentActions && promise && umbrella && completed),"relations":try JSONCodec.string(snapshot.taskRelations),"progress":try JSONCodec.string(snapshot.taskProgress)]
    }
}
