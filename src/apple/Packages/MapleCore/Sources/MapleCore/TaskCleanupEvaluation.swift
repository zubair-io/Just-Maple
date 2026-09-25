import Foundation

/// Public synthetic sources only. Each case owns a fresh in-memory store; no application data is loaded.
public enum TaskCleanupEvaluation {
    public struct CaseResult: Codable, Sendable {
        public let name:String
        public let passed:Bool
        public let queueStatus:String
        public let titles:[String]
        public let statuses:[String]
    }
    public struct Report: Codable, Sendable {
        public let mode:String
        public let passed:Bool
        public let cases:[CaseResult]
    }
    struct Scenario {
        let name:String
        let body:String
        let age:TimeInterval
        var history:[String]=[]
        var historyAge:TimeInterval?=nil
        var later:String?=nil
        var terms:[String]=[]
        var decisionRequired=false
        var expectsTask:Bool { !terms.isEmpty }
    }
    static let scenarios:[Scenario] = [
        .init(name:"expired-signin-code",body:"Your one-time sign-in code is 842691. It expires in 10 minutes. If you did not request it, ignore this email.",age:3*86400),
        .init(name:"issued-password-reset-link",body:"Here is the password reset link you requested. It expires in 15 minutes. If you did not request this link, ignore this email.",age:3600),
        .init(name:"compromised-account-reset",body:"We confirmed an unauthorized sign-in to your account. Your password has not been changed. Reset your password now to secure the compromised account.",age:3600,terms:["reset","password"]),
        .init(name:"optional-survey",body:"We hope you enjoyed your visit. Would you like to complete our optional satisfaction survey?",age:3600),
        .init(name:"resolved-later-reply",body:"Please send the equipment serial number so we can finish your repair.",age:2*86400,later:"Thank you for sending the serial number. We have everything needed; no further action is required."),
        .init(name:"current-renewal",body:"Your existing storage subscription expires in five days. Renew your subscription before expiry to keep your files available.",age:3600,terms:["renew","subscription"]),
        .init(name:"repeated-onboarding-fyi",body:"Your workspace remains active. Here are the onboarding guide links again for reference. No action is required.",age:3600,history:["Your workspace is active. These guide links are for reference.","Workspace status remains active. No action is required."]),
        .init(name:"onboarding-concrete-request",body:"Please upload the signed equipment agreement by Friday so we can ship your workstation.",age:3600,history:["Your workspace is active. The onboarding guide links are available for reference.","Your workspace is active. No action is required on the guide links."],terms:["upload","agreement"]),
        .init(name:"permission-decision",body:"A guest has requested access to your private photo album. Decide whether to approve or deny this access request. Do not grant access unless you choose to.",age:300,terms:["access"],decisionRequired:true),
        .init(name:"stale-session-extension",body:"Can I have another 20 minutes of usage time for this session? My time has just run out.",age:5*86400),
        .init(name:"current-session-extension",body:"Can I have another 20 minutes of usage time for this session? My time has just run out.",age:120,terms:["time"],decisionRequired:true),
        .init(name:"reaffirmed-session-extension",body:"I am using a new session now and still need your decision on an extra 20 minutes of usage time today. Can you review that request?",age:120,history:["Can I have another 20 minutes of usage time for this session? My time has just run out."],historyAge:5*86400,terms:["time"],decisionRequired:true),
        .init(name:"durable-purchase-permission",body:"Please decide whether I may buy the replacement desk for the study. The purchase is waiting for your approval; do not place the order until you have decided.",age:5*86400,terms:["desk"],decisionRequired:true),
        .init(name:"stale-current-meal-help",body:"Could you start heating the soup for our lunch now? I am setting the table for this meal.",age:5*86400),
        .init(name:"durable-overdue-paperwork",body:"The signed reimbursement form was due yesterday and remains outstanding. Please submit the form so we can reimburse your travel expenses.",age:5*86400,terms:["submit","form"]),
        .init(name:"expired-immediate-request",body:"Can you open the loading door now? I am outside for the next five minutes, then I will leave. If you miss me, no need to do anything.",age:2*86400),
        .init(name:"past-deadline-still-owed",body:"The expense receipt was due yesterday and is still missing. Please upload the receipt; we still need it to reimburse you.",age:2*86400,terms:["upload","receipt"])
    ]
    public static func run(extractor:any TaskCandidateExtractor,provider:String) async throws -> Report {
        var results:[CaseResult]=[]
        for scenario in scenarios {
            let store=try KnowledgeStore(path:":memory:"), now=Date(), sourceDate=now.addingTimeInterval(-scenario.age)
            let sender="person:email:"+ConnectorSourceRecord.identifier("sender@example.test")
            func event(_ suffix:String,_ text:String,_ date:Date)->Event {
                Event(type:"message.received",source:.init(connector:"gmail",account:"owner@example.test",externalID:scenario.name+suffix,revision:"1",timeZone:"UTC"),occurredAt:date,subjects:["person:self",sender,"thread:gmail:synthetic-cleanup"],content:"Gmail message\nDirection: incoming\nSender: Synthetic Sender <sender@example.test>\nTo: owner@example.test\nSubject: Synthetic evaluation\nBody:\n"+text)
            }
            for (index,body) in scenario.history.enumerated() {try await store.ingest(event("-history-\(index)",body,(scenario.historyAge.map{now.addingTimeInterval(-$0)} ?? sourceDate).addingTimeInterval(-Double(scenario.history.count-index)*3600)))}
            let source=event("",scenario.body,sourceDate)
            try await store.ingest(source)
            if let later=scenario.later {try await store.ingest(event("-later",later,sourceDate.addingTimeInterval(3600)))}
            try await store.requestTaskExtraction(eventID:source.id)
            _ = try await TaskExtractionEngine(store:store,extractor:extractor).runOne(eventIDs:[source.id])
            let status=try await store.taskExtractionQueue().first?.status ?? "missing"
            let suggestions=try await store.worldSnapshot().suggestions.filter{$0.reviewStatus=="pending"}
            let titles=suggestions.map{$0.candidate.title}, states=suggestions.map{$0.candidate.status.rawValue}
            let title=titles.first?.lowercased() ?? ""
            let alternatives=["upload":["upload","submit","send","provide"],"renew":["renew","extend"],"time":["time","usage","minutes"]]
            let clear=scenario.terms.allSatisfy{term in (alternatives[term] ?? [term]).contains{title.contains($0)}}
            let decides = !scenario.decisionRequired || (["decide","review","choose"].contains{title.contains($0)} && !title.hasPrefix("grant") && !title.hasPrefix("approve"))
            let passed=status=="succeeded" && (scenario.expectsTask ? suggestions.count==1 && states==["open"] && clear && decides : suggestions.isEmpty)
            results.append(.init(name:scenario.name,passed:passed,queueStatus:status,titles:titles,statuses:states))
        }
        return Report(mode:"\(provider)-synthetic-task-cleanup",passed:results.allSatisfy(\.passed),cases:results)
    }
}
