import Foundation

/// Synthetic, isolated live-provider rubric. Never imports personal Messages or writes app tasks.
public enum MessageTaskEvaluation {
    public static func run(client:ACPClient) async throws -> [String:String] {
        try await run(extractor:ACPExtractor(client:client),provider:client.provider)
    }
    public static func run(extractor:any TaskCandidateExtractor,provider:String) async throws -> [String:String] {
        let cases:[(String,Bool,String,String)] = [
            ("incoming-promise",false,"I will bring it tomorrow.","waiting_on_other"),
            ("outgoing-promise",true,"I will bring it tomorrow.","user_action"),
            ("tentative-plan",false,"Maybe I could bring it sometime next week, but I am not sure yet.","none"),
            ("direct-request",false,"Please bring the replacement cable tomorrow.","user_action")
        ]
        var result=["mode":"live-\(provider)-synthetic-message-tasks","passed":"true"]
        let combined = cases.map { ($0.0, $0.1, $0.2, $0.3, "imessage") } + cases.map { ("gmail-" + $0.0, $0.1, $0.2, $0.1 ? "none" : $0.3, "gmail") }
        for (name,outgoing,text,expected,connector) in combined {
            let store=try KnowledgeStore(path:":memory:")
            let sender = connector == "gmail" ? "Synthetic Taylor <taylor@example.test>" : "Synthetic Taylor"
            let actor = connector == "gmail" ? "person:email:" + ConnectorSourceRecord.identifier("taylor@example.test") : "person:imessage:fixture-taylor"
            let subjects=["person:self",actor,"thread:" + connector + ":fixture"]
            let history=Event(type:"message.received",source:.init(connector:connector,account:"synthetic-evaluation",externalID:name+"-prior",revision:"1",timeZone:"America/New_York"),occurredAt:Date().addingTimeInterval(-600),subjects:subjects,content:"Thread: Synthetic Taylor\nSender: \(sender)\nDirection: incoming\nBody:\nWe are discussing the replacement cable for the office monitor.")
            let source=Event(type:outgoing ? "message.sent":"message.received",source:.init(connector:connector,account:"synthetic-evaluation",externalID:name,revision:"1",timeZone:"America/New_York"),occurredAt:Date().addingTimeInterval(-30),subjects:subjects,content:"Thread: Synthetic Taylor\nSender: \(outgoing ? "Me":sender)\nDirection: \(outgoing ? "outgoing":"incoming")\nBody:\n\(text)")
            try await store.ingest(history);try await store.ingest(source)
            let tasks=try await extractor.extract(store.taskModelContext(for:source.id),activities:[])
            let passed=expected=="none" ? tasks.isEmpty : tasks.count==1 && tasks.first?.obligation==expected && tasks.first?.candidate.status == (expected=="waiting_on_other" ? .waiting:.open) && tasks.first?.candidate.title.lowercased().contains("cable")==true
            result[name]=try JSONCodec.string(tasks)
            result[name+"-passed"]=String(passed)
            if !passed {result["passed"]="false"}
        }
        return result
    }
}
