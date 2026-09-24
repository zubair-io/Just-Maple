import Foundation
import MapleCore

@main
struct JustMapleCommand {
    static func main() async {
        do { try await run() }
        catch {
            FileHandle.standardError.write(Data("just-maple: \(error.localizedDescription)\n".utf8))
            exit(1)
        }
    }

    static func run() async throws {
        var args = Array(CommandLine.arguments.dropFirst())
        guard let command = args.first, command != "help", command != "--help" else {
            print(help); return
        }
        args.removeFirst()
        func take(_ flag: String) throws -> String? {
            guard let index = args.firstIndex(of: flag) else { return nil }
            guard index + 1 < args.count, !args[index + 1].hasPrefix("--") else {
                throw MapleError.invalid("Missing value for \(flag)")
            }
            let value = args[index + 1]; args.removeSubrange(index...index + 1); return value
        }
        let suppliedDB = try take("--db")
        let live = args.contains("--live")
        args.removeAll { $0 == "--live" }
        let replay = args.contains("--replay")
        args.removeAll { $0 == "--replay" }
        guard !(live && replay) else { throw MapleError.invalid("Choose either --live or --replay.") }
        let dbPath = suppliedDB ?? (command == "demo" ? ".maple/demo-\(live ? "live" : "replay").sqlite" : ".maple/core.sqlite")
        if ["run", "demo", "evaluate"].contains(command), !live && !replay {
            throw MapleError.invalid("Select --live (TypeSafe) or --replay (synthetic demo fixtures).")
        }
        // Validate credentials before changing the database for a requested live run.
        let classifier: (any Classifier)? = live ? try TypeSafeClassifier(
            apiKey: ProcessInfo.processInfo.environment["TYPESAFE_API_KEY"] ?? "",
            model: ProcessInfo.processInfo.environment["TYPESAFE_MODEL"] ?? "jev-latest") : (replay ? DemoReplayClassifier() : nil)
        if command == "evaluate-message-screening" {
            let output = try take("--output") ?? ".maple/screening-evaluations/\(UUID().uuidString)"
            guard live, !replay, args.isEmpty, suppliedDB == nil, let classifier else { throw MapleError.invalid("Usage: evaluate-message-screening --live [--output NEW_DIRECTORY]") }
            let report = try await MessageScreeningEvaluation.run(classifier: classifier, directory: URL(fileURLWithPath: output))
            try printJSON(report)
            if report["passed"] != "true" { exit(2) }
            return
        }
        if command == "evaluate-messages" {
            let output = try take("--output") ?? ".maple/message-evaluations/\(UUID().uuidString)"
            guard live, !replay, args.isEmpty, suppliedDB == nil, let classifier else {
                throw MapleError.invalid("Usage: evaluate-messages --live [--output NEW_DIRECTORY]")
            }
            let report = try await MessageEvaluation.run(classifier: classifier, directory: URL(fileURLWithPath: output))
            try printJSON(report)
            if !report.passed { exit(2) }
            return
        }
        if command == "evaluate" {
            let output = try take("--output") ?? ".maple/evaluations/\(UUID().uuidString)"
            guard args.isEmpty, let classifier, suppliedDB == nil else {
                throw MapleError.invalid("Usage: evaluate --live|--replay [--output NEW_DIRECTORY]")
            }
            let report = try await CoreEvaluation.run(classifier: classifier, directory: URL(fileURLWithPath: output),
                                                       mode: live ? "live-typesafe" : "synthetic-replay")
            try printJSON(report)
            if !report.passed { exit(2) }
            return
        }
        if command == "evaluate-message-tasks" {
            let provider=try take("--provider") ?? "codex"
            let runner=try take("--runner")
            guard args.isEmpty,suppliedDB==nil,["apple","claude","codex"].contains(provider),provider=="apple" || runner != nil else {throw MapleError.invalid("Usage: evaluate-message-tasks --provider apple|claude|codex [--runner PATH]")}
            let extractor:any TaskCandidateExtractor = provider=="apple" ? AppleTaskExtractor() : ACPExtractor(client:ACPClient(provider:provider,runner:URL(fileURLWithPath:runner!)))
            let report=try await MessageTaskEvaluation.run(extractor:extractor,provider:provider)
            try printJSON(report);if report["passed"] != "true" {exit(2)};return
        }
        if command == "evaluate-task-reconciliation" {
            guard let runner=try take("--runner"),args.isEmpty,suppliedDB==nil else {throw MapleError.invalid("Usage: evaluate-task-reconciliation --runner PATH")}
            let report=try await TaskReconciliationEvaluation.run(client:ACPClient(provider:"codex",runner:URL(fileURLWithPath:runner)))
            try printJSON(report);if report["passed"] != "true" {exit(2)};return
        }
        if command == "evaluate-activities" {
            guard let runner=try take("--runner"),args.isEmpty,suppliedDB==nil else {throw MapleError.invalid("Usage: evaluate-activities --runner PATH")}
            let report=try await ActivityDiscoveryEvaluation.run(client:ACPClient(provider:"codex",runner:URL(fileURLWithPath:runner)))
            try printJSON(report)
            if report["passed"] != "true" {exit(2)}
            return
        }
        let store = try KnowledgeStore(path: dbPath)
        switch command {
        case "retry-task-reviews":
            guard args.isEmpty else { throw MapleError.invalid("Usage: retry-task-reviews [--db PATH]") }
            try await store.retryFailedTaskExtractions()
            try printJSON(["status":"Eligible failed task reviews queued; automatic processing will resume in the app."])
        case "reconcile-tasks":
            guard let runner=try take("--runner"),args.isEmpty else {throw MapleError.invalid("Usage: reconcile-tasks --runner PATH [--db PATH]")}
            try await TaskReconciliationEngine(store:store,client:ACPClient(provider:"codex",runner:URL(fileURLWithPath:runner))).runOne()
            let snapshot=try await store.worldSnapshot()
            struct ReconciliationResult:Encodable {let relations:[TaskRelation];let progress:[TaskProgressEvidence]}
            try printJSON(ReconciliationResult(relations:snapshot.taskRelations,progress:snapshot.taskProgress))
        case "discover-activities":
            let retry=args.contains("--retry");args.removeAll{$0=="--retry"}
            guard let runner=try take("--runner"),args.isEmpty else {throw MapleError.invalid("Usage: discover-activities [--retry] --runner PATH [--db PATH]")}
            if retry {try await store.retryActivityDiscovery()}
            try await ActivityDiscoveryEngine(store:store,client:ACPClient(provider:"codex",runner:URL(fileURLWithPath:runner))).runOne()
            try printJSON(await store.activities())
        case "remove-activity":
            guard args.count==1,let activity=try await store.activities().first(where:{$0.id==args[0]}) else {throw MapleError.invalid("Usage: remove-activity ACTIVITY_ID [--db PATH]")}
            try printJSON(await store.removeActivity(id:activity.id,expectedVersion:activity.version,requestID:UUID().uuidString))
        case "activity":
            guard let name=try take("--name"),let purpose=try take("--purpose"),args.isEmpty else {throw MapleError.invalid("Usage: activity --name NAME --purpose PURPOSE [--db PATH]")}
            if let existing=try await store.activities().first(where:{$0.name.caseInsensitiveCompare(name) == .orderedSame}) {try printJSON(existing)}
            else {
                var activity=LifeActivity();activity.name=name;activity.purpose=purpose;activity.kind = .pursuit
                try printJSON(await store.saveActivity(activity,expectedVersion:0,requestID:UUID().uuidString))
            }
        case "preview-tasks":
            guard let runner=try take("--runner"),args.count==1,let event=try await store.event(args[0]) else {throw MapleError.invalid("Usage: preview-tasks EVENT_ID --runner PATH [--db PATH]")}
            let extractor=ACPExtractor(client:ACPClient(provider:"codex",runner:URL(fileURLWithPath:runner)))
            try printJSON(await extractor.extract(store.taskModelContext(for:event.id),activities:store.activities()))
        case "reprocess-tasks":
            guard let runner=try take("--runner"),!args.isEmpty else {throw MapleError.invalid("Usage: reprocess-tasks EVENT_IDS --runner PATH [--db PATH]")}
            for id in args {
                try await store.requestTaskExtraction(eventID:id,reprocess:true)
                _ = try await TaskExtractionEngine(store:store,extractor:ACPExtractor(client:ACPClient(provider:"codex",runner:URL(fileURLWithPath:runner)))).runOne(eventIDs:[id])
            }
            try printJSON(await store.taskExtractionQueue().filter{args.contains($0.eventID)})
        case "index":
            let batches=Int(try take("--batches") ?? "1") ?? 1
            guard args.isEmpty,(1...10000).contains(batches) else {throw MapleError.invalid("Usage: index [--batches 1...10000] [--db PATH]")}
            for _ in 0..<batches {
                try await store.indexBatch(limit:32)
                if try await store.indexStatus().pending==0 {break}
            }
            try await store.prepareStateJobs()
            try printJSON(await store.indexStatus())
        case "extract-state":
            let stateEventID=try take("--event")
            guard let runner=try take("--runner"),args.isEmpty else {throw MapleError.invalid("Usage: extract-state --runner PATH [--db PATH]")}
            if let stateEventID {try await store.requestStateExtraction(eventID:stateEventID)}
            try await StateExtractionEngine(store:store,client:ACPClient(provider:"codex",runner:URL(fileURLWithPath:runner))).runOne(eventID:stateEventID)
            try printJSON(await store.indexStatus())
        case "semantic-search":
            guard args.count==1 else {throw MapleError.invalid("Usage: semantic-search QUERY [--db PATH]")}
            try printJSON(await store.semanticSearch(args[0]))
        case "check-facts":
            guard live, args.count == 1, let classifier = classifier as? TypeSafeClassifier else {
                throw MapleError.invalid("Usage: check-facts EVENT_ID --live [--db PATH]")
            }
            let context = try await store.modelContext(for: args[0])
            let check = try await classifier.checkFacts(context)
            try await store.recordFactCheck(eventID: args[0], probability: check.probability, provider: "typesafe", model: check.model, context: context, rawResponse: String(decoding: check.rawResponse, as: UTF8.self))
            try printJSON(try await store.factChecks())
        case "extract-facts":
            guard args.isEmpty else { throw MapleError.invalid("Usage: extract-facts [--db PATH]") }
            let completed = try await FactExtractionEngine(store: store, extractor: AppleFactExtractor()).runOne()
            struct ExtractionOutput: Encodable {
                let completed: Bool; let availability: String; let facts: [SourceFact]; let queue: [QueueItem]
            }
            try printJSON(ExtractionOutput(completed: completed, availability: AppleFactExtractor.availabilityDescription,
                                          facts: try await store.sourceFacts(), queue: try await store.factQueue()))
            if try await store.factQueue().contains(where: { $0.error != nil }) { exit(2) }
        case "demo", "run":
            guard args.isEmpty, let classifier else { throw MapleError.invalid("Unexpected arguments. See help.") }
            let prior = try await store.decisions()
            guard prior.allSatisfy({ $0.assessment.provider == (live ? "typesafe" : "fixture-replay") }) else {
                throw MapleError.invalid("Use a separate database for live and fixture results.")
            }
            if command == "demo" {
                for event in DemoScenario.events() { try await store.ingest(event) }
            }
            let report = try await IntelligenceEngine(store: store, classifier: classifier).run()
            let decisions = try await store.decisions()
            struct Output: Encodable {
                let mode: String; let database: String; let report: RunReport
                let state: [Claim]; let decisions: [Decision]; let workItems: [WorkItem]; let queue: [QueueItem]
                let evaluation: String
            }
            try printJSON(Output(mode: live ? "live-typesafe" : "synthetic-replay", database: dbPath, report: report,
                                 state: try await store.state(), decisions: decisions, workItems: try await store.workItems(),
                                 queue: try await store.queue(), evaluation: "Not evaluated here. Use evaluate --live for the bounded scenario rubric."))
            // Completion alone is not proof of classifier quality. Evaluate outputs against the scenario rubric.
            if report.deferred > 0 { exit(2) }
        case "ingest":
            guard args.count == 1 else { throw MapleError.invalid("Usage: ingest events.json [--db path]") }
            let data = try Data(contentsOf: URL(fileURLWithPath: args[0]))
            guard data.count <= 5_000_000 else { throw MapleError.invalid("Event batch exceeds 5 MB.") }
            let events = try JSONCodec.decode([Event].self, from: data)
            var ids: [String] = []
            for event in events { ids.append(try await store.ingest(event)) }
            try printJSON(ids)
        case "note":
            let subject = try take("--subject") ?? "person:self"
            guard args.count == 1 else { throw MapleError.invalid("Usage: note file.md --subject job:job-search") }
            let event = try NoteConnector.read(url: URL(fileURLWithPath: args[0]), subjects: [subject])
            try printJSON(["eventID": try await store.ingest(event)])
        case "correct":
            guard args.count == 3 else { throw MapleError.invalid("Usage: correct SUBJECT PREDICATE VALUE") }
            try printJSON(try await store.correct(subject: args[0], predicate: args[1], value: args[2]))
        case "inspect":
            guard args.isEmpty else { throw MapleError.invalid("Unexpected arguments.") }
            struct Inspection: Encodable {
                let eventCount: Int; let state: [Claim]; let decisions: [Decision]; let workItems: [WorkItem]; let queue: [QueueItem]
                let sourceFacts: [SourceFact]; let factQueue: [QueueItem]
            }
            try printJSON(Inspection(eventCount: try await store.eventCount(), state: try await store.state(),
                                     decisions: try await store.decisions(), workItems: try await store.workItems(), queue: try await store.queue(),
                                     sourceFacts: try await store.sourceFacts(), factQueue: try await store.factQueue()))
        case "history":
            guard args.count == 2 else { throw MapleError.invalid("Usage: history SUBJECT PREDICATE") }
            try printJSON(try await store.claimHistory(subject: args[0], predicate: args[1]))
        case "search":
            guard !args.isEmpty else { throw MapleError.invalid("Supply search text.") }
            try printJSON(try await store.search(args.joined(separator: " ")))
        case "dismiss":
            guard args.count == 1 else { throw MapleError.invalid("Usage: dismiss INBOX_ITEM_ID") }
            try await store.dismiss(args[0]); print("Dismissed.")
        case "retry":
            guard args.isEmpty else { throw MapleError.invalid("Unexpected arguments.") }
            try await store.retryFailures()
            try await store.retryFacts()
            print("Failed classifications and fact extractions are queued for retry.")
        case "export-demo":
            guard args.isEmpty else { throw MapleError.invalid("Unexpected arguments.") }
            try printJSON(DemoScenario.events())
        default: throw MapleError.invalid("Unknown command \(command). Use help.")
        }
    }

    static func printJSON<T: Encodable>(_ value: T) throws {
        let data = try JSONCodec.encode(value)
        let object = try JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed)
        let pretty = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys, .fragmentsAllowed])
        print(String(decoding: pretty, as: UTF8.self))
    }

    static let help = """
    index [--batches N] [--db PATH]       Build local semantic index
    extract-state --runner PATH [--db PATH]  Extract one queued state with ChatGPT
    semantic-search QUERY [--db PATH]    Search local vectors
    Just Maple — local intelligence core

    demo --replay                 Exercise synthetic fixtures; NOT a live intelligence test
    demo --live                   Send the three synthetic scenario events/context to TypeSafe
    evaluate --live|--replay       Run evidence, counterfactual, noise and replay checks
                                  Optional: --output NEW_DIRECTORY
    evaluate-messages --live      Test iMessage routing/feedback on synthetic messages
                                  Optional: --output NEW_DIRECTORY
    export-demo                   Print example event JSON (Unix-second dates)
    ingest events.json            Durably enqueue normalized events
    note file.md --subject ID     Import a note as one source event
    run --live                    Classify due events using TYPESAFE_API_KEY
    check-facts EVENT_ID --live    Ask Jev whether an existing source needs fact extraction
    extract-facts                 Parse one due fact job using Apple's on-device model
    inspect                       Show state, evidence, decisions, queue and inbox/proposals
    correct SUBJECT KEY VALUE     Record explicit user evidence with precedence over inference
    history SUBJECT KEY           Inspect all claims, including superseded claims
    search TEXT                   Local SQLite FTS5 search
    dismiss ID                    Dismiss an inbox item
    retry                         Requeue failed/blocked classifications

    Storage commands accept --db PATH. Evaluations use fresh output directories.
    Default database: .maple/core.sqlite.
    Demo defaults: .maple/demo-replay.sqlite or .maple/demo-live.sqlite.
    Live classification sends event/context content to https://api.typesafe.ai.
    Reasoning and summary routes are proposals, not executed model jobs in this first slice.
    """
}
