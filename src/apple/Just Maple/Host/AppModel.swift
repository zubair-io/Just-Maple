import AppKit
import CryptoKit
import MapleCore
import Observation
import PDFKit
import Security
import LocalAuthentication
import UniformTypeIdentifiers

@MainActor @Observable
final class AppModel {
    var extractionProvider = ["codex","claude"].contains(UserDefaults.standard.string(forKey:"extractionProvider") ?? "") ? UserDefaults.standard.string(forKey:"extractionProvider")! : "apple"
    var providerStatus:[String:String]=[:]
    var providerTesting=false
    var testedProviders:Set<String>=[]
    var store: KnowledgeStore?
    var companion = CompanionMacController()
    var notebooks: NotebookLibrary?
    var todayDocuments: TodayDocumentCoordinator?
    var todayEditingLeases: [String: Date] = [:]
    var automaticTodayBusy = false
    var lastAutomaticTodayTick = Date.distantPast
    var inlineTasks: [String: Task<Void, Never>] = [:]
    var localIndex: LocalIndexStatus?
    private var lastWaitingReviewTick = Date.distantPast
    private var lastGroupingProposalTick = Date.distantPast
    private var groupingProposalBusy = false
    var stateExtractionBusy=false
    var localIntelligenceStatus="Preparing local intelligence…"
    var auditRunning=false
    var auditStatus="No connector audit has run in this session."
    var name = ""
    var key = ""
    var connected = false {
        didSet {
            if !connected { running = false }
        }
    }
    var running = false
    var busy = false
    var downstreamBusy = false
    var ready = false
    var loaded = false
    var startupError: String?
    private(set) var starting = false
    private let refreshCoordinator = WorkspaceRefreshCoordinator()
    var message = "Your context database lives on this Mac."
    var error: String?
    var importantPeople: [PersonSummary] = []
    var claims: [Claim] = []
    var decisions: [Decision] = []
    var queue: [QueueItem] = []
    var processingQueueCounts: [String:Int] = [:]
    var work: [WorkItem] = []
    var count = 0
    var world: WorldSnapshot?
    var taskExtractionQueue: [QueueItem] = []
    var sourceFacts: [SourceFact] = []
    var factChecks: [FactCheck] = []
    var factQueue: [QueueItem] = []
    var importedResume: String?
    var googleSettings = GoogleSettings()
    var googleTokens: GoogleTokens?
    let googleOAuth = GoogleOAuth()
    var googleConfigured = false
    var googleBusy = false
    var googleStatus = "Not connected"
    var googleContactsStatus = "Reconnect Google to add Contacts"
    var googleMailStatus = "Not imported yet"
    var googleCalendarStatus = "Choose calendars to import"
    var googleCalendars: [GoogleCalendarChoice] = []
    var googleCalendar: [ConnectorSourceRecord] = []
    var lastGooglePoll = Date.distantPast
    var homeSettings = HomeSettings()
    var homeToken: String?
    var homeEntities: [ConnectorSourceRecord] = []
    var homeStatus = "Not connected"
    var homeImporting = false
    var lastHomePoll = Date.distantPast
    let appleConnectors = AppleConnectors()
    var contactsEnabled = false
    var calendarEnabled = false
    var selectedCalendarIDs = Set<String>()
    var calendarChoices: [CalendarChoice] = []
    var appleImporting = false
    var contactsStatus = "Not connected"
    var calendarStatus = "Not connected"
    var appleContacts: [AppleSourceRecord] = []
    var appleCalendar: [AppleSourceRecord] = []
    var lastApplePoll = Date.distantPast
    var messagesEnabled = false
    var messagesImporting = false
    var messagesStatus = "Not connected"
    var messagesError: String?
    private var lastMessagesPoll = Date.distantPast
    let directory: URL
    var classifier: (any FactCheckingClassifier)?
    var classificationProvider: String
    var classificationState = "not_loaded"
    var jevPause: ProviderPause?
    private var classificationMessage = "Preparing selected classifier…"
    var classificationStatus: String {
        get {
            if classificationProvider == "jev", connected, let pause = jevPause {
                return "Jev requests are paused. \(pause.reason) Queued events are retained."
            }
            return classificationMessage
        }
        set { classificationMessage = newValue }
    }
    var classificationCanRun = false
    var classificationLabel: String { classificationProvider == "laya" ? "Laya" : "Jev" }
    private let classificationDefaults: UserDefaults
    private let layaDirectory: URL
    private let layaLoader: @Sendable (URL) async throws -> any FactCheckingClassifier
    private var classifierLoad: Task<Void, Never>?
    private var classifierGeneration = 0
    private var processingStartupReady = false

    init(directory override: URL? = nil, classificationDefaults: UserDefaults = .standard,
         layaDirectory: URL? = nil,
         layaLoader: @escaping @Sendable (URL) async throws -> any FactCheckingClassifier = { try await LayaClassifier.load(directory: $0) }) {
        self.classificationDefaults = classificationDefaults
        let modelDirectory = layaDirectory ?? (Bundle.main.resourceURL ?? Bundle.main.bundleURL).appendingPathComponent("Laya", isDirectory: true)
        let selected = classificationDefaults.string(forKey: "classificationProvider")
        self.classificationProvider = ["laya", "jev"].contains(selected ?? "")
            ? selected! : Self.layaValidationApproved(directory: modelDirectory) ? "laya" : "jev"
        self.layaDirectory = modelDirectory
        self.layaLoader = layaLoader
        let args = ProcessInfo.processInfo.arguments
        if let override { directory = override }
        else if let index = args.firstIndex(of: "--data-directory"), args.indices.contains(index + 1) {
            directory = URL(fileURLWithPath: args[index + 1], isDirectory: true)
        } else {
            directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("Just Maple/Intelligence", isDirectory: true)
        }
    }

    /// Publish the small local shell before any folder download, companion restore,
    /// source scan or provider setup. UI snapshot polling must not wait on that work.
    func openWorkspace() async throws {
        if store == nil {
            let path=directory.appendingPathComponent("core.sqlite").path
            let directory=self.directory
            store=try await Task.detached(priority:.userInitiated) {
                try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
                return try KnowledgeStore(path:path)
            }.value
        }
        guard let store else {throw MapleError.invalid("The local workspace is unavailable.")}
        try await store.recoverInterruptedInlineMaple()
        claims=try await store.state(subjects:["person:self"])
        name=claims.first {$0.predicate=="person.name"}?.value ?? ""
        ready = !name.isEmpty
        loadAppleSettings()
        startupError=nil
        loaded=true
    }

    func start() async {
        guard !starting,!loaded else {return}
        starting=true;startupError=nil
        defer {starting=false}
        do {
            try await openWorkspace()
            beginClassifierLoad()
            // Recover journaled file/task operations before processing resumes. Unavailable
            // notebooks retain their reservations and an actionable recovery notice.
            do {
                let coordinator=try await Bridge(model:self).todayCoordinator()
                let recovery=try await coordinator.recoverPendingDocuments()
                if !recovery.issues.isEmpty || recovery.hasMore {
                    error="Some note actions need recovery. Open their notes in Today or Notebooks; pending task changes remain reserved."
                }
            } catch {
                self.error="Notebook recovery is unavailable. Reconnect your notebook folders before retrying pending note actions."
            }
            processingStartupReady = true
            if NSClassFromString("XCTestCase")==nil {await companion.restore(model:self)}
            await refresh()
            await loadHomeSettings()
            await loadGoogleSettings()
        } catch {
            if loaded {
                startupError=nil
                self.error="Your workspace is open, but saved connections could not finish restoring. Unlock or reconnect the affected service in Connections. Your notes remain available."
            } else {
                startupError="The local workspace could not be opened. Check disk access and available space, then retry. Your existing files have not been reset."
            }
        }
    }

    func refresh() async {
        guard let store else {return}
        await refreshCoordinator.run {
            do {
                jevPause = try await store.providerPause("typesafe")
                localIndex = try await store.indexStatus()
                try await store.materializeOccurrences()
                world = try await store.worldSnapshot()
                taskExtractionQueue = try await store.taskExtractionQueue()
                claims = try await store.state()
                importantPeople = try await store.people()
                decisions = try await store.recentDecisions(limit:30)
                queue = try await store.recentQueue(limit:100)
                processingQueueCounts = try await store.processingQueueCounts()
                work = try await store.workItems()
                count = try await store.eventCount()
                appleContacts = try await store.appleRecords("apple_contacts")
                appleCalendar = try await store.appleRecords("apple_calendar")
                googleCalendar = try await store.sourceRecords("google_calendar")
                sourceFacts = try await store.sourceFacts(limit: 500)
                factChecks = try await store.factChecks()
                factQueue = try await store.factQueue()
            } catch { self.error = error.localizedDescription }
        }
    }

    func introduce() async {
        let value = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, let store else { return }
        do {
            try await store.correct(subject: "person:self", predicate: "person.name", value: value)
            try await ingest(content: "The user introduced themselves as \(value).", connector: "profile", type: "profile.updated")
            name = value
            ready = true
            await refresh()
        } catch { self.error = error.localizedDescription }
    }

    static func layaValidationApproved(directory: URL) -> Bool {
        guard let data = try? Data(contentsOf: directory.appendingPathComponent("validation.json")),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              value["approved"] as? Bool == true,
              value["modelRevision"] as? String == LayaClassifier.modelRevision,
              value["adapter"] as? String == LayaClassifier.adapterVersion else { return false }
        return true
    }

    static func layaValidationReason(directory: URL) -> String? {
        guard let data = try? Data(contentsOf: directory.appendingPathComponent("validation.json")),
              let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let reason = value["reason"] as? String else { return nil }
        let text = String(reason.prefix(512)).trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : text
    }

    func selectClassificationProvider(_ provider: String) throws {
        guard ["laya", "jev"].contains(provider) else { throw MapleError.invalid("Unknown classification provider.") }
        guard !busy, !auditRunning else { throw MapleError.invalid("Wait for the current classification or audit to finish before changing providers.") }
        classificationProvider = provider
        classificationDefaults.set(provider, forKey: "classificationProvider")
        beginClassifierLoad()
    }

    /// Loading the local model never waits on cloud restore, Google or the Keychain.
    func beginClassifierLoad() {
        classifierGeneration += 1
        let generation = classifierGeneration, provider = classificationProvider
        classifierLoad?.cancel()
        classifier = nil; connected = false; running = false; classificationCanRun = false
        classificationState = "loading"
        classificationStatus = provider == "laya" ? "Loading bundled Laya on this Mac…" : "Opening the explicitly selected Jev connection…"
        classifierLoad = Task { await self.loadClassifier(provider: provider, generation: generation) }
    }

    private func loadClassifier(provider: String, generation: Int) async {
        do {
            let adapter: any FactCheckingClassifier
            if provider == "laya" {
                guard FileManager.default.fileExists(atPath: layaDirectory.path) else {
                    if generation == classifierGeneration {
                        classificationState = "model_missing"
                        classificationStatus = "The bundled Laya model is missing. Rebuild or reinstall Just Maple with its model resources. Queued events are retained."
                    }
                    return
                }
                adapter = try await layaLoader(layaDirectory)
            } else {
                let saved = try await Task.detached { try KeyStore.read(allowAuthentication: false) }.value ?? ProcessInfo.processInfo.environment["TYPESAFE_API_KEY"]
                guard let saved, !saved.isEmpty else {
                    if generation == classifierGeneration {
                        classificationState = "credentials_required"
                        classificationStatus = "Jev needs an API key. Enter a key or unlock a saved key to use remote classification."
                    }
                    return
                }
                adapter = try TypeSafeClassifier(apiKey: saved)
            }
            let pause = try await store?.providerPause("typesafe")
            guard generation == classifierGeneration, classificationProvider == provider, !Task.isCancelled else { return }
            jevPause = pause
            classifier = adapter
            classificationCanRun = provider == "jev" || Self.layaValidationApproved(directory: layaDirectory)
            connected = true
            running = classificationCanRun
            classificationState = classificationCanRun ? "ready" : "validation_required"
            classificationStatus = provider == "jev" ? "Jev is selected. Classification sends relevant source context to Jev." : classificationCanRun ? "Laya is ready. Classification runs locally on this Mac." : "Experimental Laya loaded. \(Self.layaValidationReason(directory: layaDirectory) ?? "This model has not passed quality validation.") Automatic processing is disabled and queued events are retained."
        } catch {
            guard generation == classifierGeneration else { return }
            classifier = nil; connected = false; running = false; classificationCanRun = false
            classificationState = "load_failed"
            classificationStatus = provider == "laya" ? "Laya could not load. Rebuild or reinstall its bundled model, then retry. Queued events are retained." : error.localizedDescription
        }
    }

    func unlockSavedKey() async {
        guard !busy, !auditRunning else { error = "Wait for current classification to finish before changing providers."; return }
        classifierGeneration += 1
        let generation = classifierGeneration
        classifierLoad?.cancel()
        classificationProvider = "jev"; classificationDefaults.set("jev", forKey: "classificationProvider")
        classifier = nil; connected = false; running = false; classificationCanRun = false
        classificationState = "loading"
        classificationStatus = "Unlocking the explicitly selected Jev connection…"
        do {
            let saved = try await Task.detached { try KeyStore.read(allowAuthentication: true) }.value
            guard generation == classifierGeneration else { return }
            guard let saved else { classificationState = "credentials_required"; classificationStatus = "No saved Jev key was found. Enter a key to use remote classification."; return }
            activateJev(try TypeSafeClassifier(apiKey: saved))
        } catch {
            guard generation == classifierGeneration else { return }
            classificationState = "load_failed"; classificationStatus = error.localizedDescription
        }
    }

    private func activateJev(_ adapter: TypeSafeClassifier) {
        classifier = adapter; classificationProvider = "jev"
        classificationDefaults.set("jev", forKey: "classificationProvider")
        classificationCanRun = true; connected = true; running = true
        classificationState = "ready"
        classificationStatus = "Jev is selected. Classification sends relevant source context to Jev."
        error = nil
        Task { await refreshJevPause() }
    }

    func refreshJevPause() async {
        do { jevPause = try await store?.providerPause("typesafe") }
        catch { self.error = error.localizedDescription }
    }

    func resumeJevRequests() async throws {
        guard !busy, !auditRunning, classificationProvider == "jev", connected, classificationCanRun, let store else {
            throw MapleError.invalid("Select a ready Jev connection and wait for current processing to finish before retrying Jev requests.")
        }
        try await store.clearProviderPause("typesafe")
        await refreshJevPause()
        message = "Jev requests may retry. Queued events are retained. Your processing-loop setting is unchanged."
    }

    func connect() {
        guard !busy, !auditRunning else { error = "Wait for current classification to finish before changing providers."; return }
        do {
            let value = key.trimmingCharacters(in: .whitespacesAndNewlines)
            let adapter = try TypeSafeClassifier(apiKey: value)
            try KeyStore.save(value)
            classifierGeneration += 1; classifierLoad?.cancel()
            activateJev(adapter)
            key = ""
            message = "Jev selected explicitly. Queued events will use remote classification."
        } catch { self.error = error.localizedDescription }
    }

    func disconnect() {
        do {
            try KeyStore.remove()
            if classificationProvider == "jev" {
                classifierGeneration += 1; classifierLoad?.cancel()
                classifier = nil; connected = false; running = false; classificationCanRun = false
                classificationState = "credentials_required"; classificationStatus = "Jev disconnected. Choose Laya or provide a Jev key to resume classification."
            }
        } catch { self.error = error.localizedDescription }
    }

    func waitingReviewTick(at:Date=Date()) async {
        guard let store,at.timeIntervalSince(lastWaitingReviewTick)>=15 else {return}
        lastWaitingReviewTick=at
        do {
            if try await store.materializeWaitingFollowUps(at:at) {world=try await store.worldSnapshot(at:at)}
        } catch {localIntelligenceStatus="Waiting reviews need attention. Maple will retry; your original obligations are preserved."}
    }

    func indexTick() async {
        guard !starting,let store else {return}
        await waitingReviewTick()
        await automaticTodayTick()
        do {
            try await store.excludeExpiredAIWork()
            try await store.indexBatch()
            try await store.prepareStateJobs()
            try await store.prepareIMessageTaskJobs()
            localIndex = try await store.indexStatus()
        } catch {localIntelligenceStatus = "Local indexing needs attention. Retry from Processing."}
    }

    func groupingProposalTick(provider:(any ObligationGroupingProvider)?=nil,at:Date=Date()) async {
        guard running,!groupingProposalBusy,let store,at.timeIntervalSince(lastGroupingProposalTick)>=15 else {return}
        do {
            guard try await store.obligationGroupingConfiguration() != nil else {return}
            guard provider != nil || ["codex","claude"].contains(extractionProvider) else {return}
            groupingProposalBusy=true;lastGroupingProposalTick=at
            defer {groupingProposalBusy=false}
            let selected=provider ?? ACPObligationGroupingProvider(client:ACPClient(provider:extractionProvider,runner:acpRunner))
            try await ObligationGroupingEngine(store:store,provider:selected).runOne(at:at)
        } catch {localIntelligenceStatus="Task grouping needs attention. The failed work is saved for retry; no task action was applied."}
    }

    func stateTick() async {
        guard !starting else {return}
        await groupingProposalTick()
        guard running, !stateExtractionBusy, !auditRunning, let store else {return}
        guard ["codex","claude"].contains(extractionProvider) else {
            localIntelligenceStatus="State extraction needs a connected ChatGPT or Claude provider."
            return
        }
        stateExtractionBusy=true
        defer {stateExtractionBusy=false}
        do {
            try await StateExtractionEngine(store:store,client:ACPClient(provider:extractionProvider,runner:acpRunner)).runOne()
            if running {try await TaskReconciliationEngine(store:store,client:ACPClient(provider:extractionProvider,runner:acpRunner)).runOne()}
            if running {try await ActivityDiscoveryEngine(store:store,client:ACPClient(provider:extractionProvider,runner:acpRunner)).runOne()}
            localIntelligenceStatus="State and activity discovery use recent source evidence."
            await refresh()
        } catch {localIntelligenceStatus="State or task learning needs attention. Evidence is saved; retry from Processing."}
    }

    func tick(classifier override: (any Classifier)? = nil) async {
        guard (!starting || processingStartupReady),running, (override != nil || classificationCanRun), !busy, let classifier = override ?? classifier, let store else { return }
        busy = true
        defer { busy = false }
        do {
            let result = try await withThrowingTaskGroup(of: RunReport.self) { group in
                for _ in 0..<2 {
                    group.addTask { try await IntelligenceEngine(store: store, classifier: classifier).run(limit: 4) }
                }
                var total = (completed: 0, deferred: 0)
                for try await report in group {
                    total.completed += report.completed; total.deferred += report.deferred
                }
                return total
            }
            await refreshJevPause()
            guard result.completed > 0 || result.deferred > 0 else {return}
            if result.completed > 0 { message = "\(classificationLabel) classified \(result.completed) events. Decisions and evidence are in History." }
            if result.deferred > 0 { message = "\(classificationLabel) could not complete a request. The event is saved for retry." }
            await refresh()
        } catch { self.error = error.localizedDescription; await refreshJevPause() }
    }

    func extractionTick() async {
        guard (!starting || processingStartupReady),running, !downstreamBusy, let store else {return}
        downstreamBusy = true
        defer {downstreamBusy = false}
        do {
            if running {
                if try await FactExtractionEngine(store: store, extractor: factExtractor).runOne() {
                    message = "Fact extraction finished. Source-linked assertions are available in People & context."
                }
            }
            if running { _ = try await TaskExtractionEngine(store: store, extractor: taskExtractor).runOne() }
            await refresh()
        } catch { self.error = error.localizedDescription }
    }

    func checkFacts(for eventID: String) async {
        guard classificationCanRun, !busy, let store, let classifier else { return }
        busy = true
        defer { busy = false }
        do {
            let result = try await store.checkSourceFacts(eventID:eventID,classifier:classifier)
            message = result.probability >= 0.85 ? "Facts worth extracting. Extraction is queued for the selected provider." : "\(classificationLabel) did not find enough new factual content to schedule extraction."
            await refresh()
        } catch { self.error = error.localizedDescription; await refreshJevPause() }
    }

    func retryFactExtraction() async {
        do { try await store?.retryFacts(); await refresh() }
        catch { self.error = error.localizedDescription }
    }

    func enableMessages() async {
        messagesEnabled = true
        await pollMessages(force: true)
    }

    func pollMessages(force: Bool = false) async {
        guard messagesEnabled, !messagesImporting, let store,
              force || Date().timeIntervalSince(lastMessagesPoll) >= 60 else { return }
        messagesImporting = true
        messagesStatus = "Reading local Messages…"
        defer { messagesImporting = false; lastMessagesPoll = Date() }
        do {
            let count = try await IMessageConnector.poll(store: store)
            messagesStatus = "Last import: \(count) new messages · \(Date().formatted(date: .omitted, time: .shortened))"
            messagesError = nil
            await refresh()
        } catch {
            messagesStatus = "Needs attention"
            messagesError = error.localizedDescription
        }
    }

    func ingest(content: String, connector: String = "notes", type: String = "note.created", subjects: [String] = ["person:self"], externalID: String = UUID().uuidString) async throws {
        guard let store else { throw MapleError.invalid("Local storage is unavailable.") }
        let hash = SHA256.hash(data: Data(content.utf8)).map { String(format: "%02x", $0) }.joined()
        try await store.ingest(Event(type: type, source: Source(connector: connector, account: "local", externalID: externalID, revision: hash),
                                     occurredAt: Date(), subjects: subjects, content: content))
        await refresh()
    }

    func capture(_ text: String) async -> Bool {
        do {
            try await ingest(content: text, subjects: ["person:self"])
            message = "Observation saved. \(running ? "The loop will process it next." : "Processing will resume when the selected classifier is ready and the loop is not paused.")"
            return true
        } catch { self.error = error.localizedDescription; return false }
    }

    func importFile(resume: Bool) async {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = resume ? [.pdf, .plainText] : [.plainText, UTType(filenameExtension: "md") ?? .plainText]
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.message = resume ? "Choose a résumé PDF or text file. Text will enter your local context." : "Import a Markdown or text note."
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            guard size <= 10_000_000 else { throw MapleError.invalid("Choose a file smaller than 10 MB.") }
            let content: String
            if url.pathExtension.lowercased() == "pdf" {
                guard let text = PDFDocument(url: url)?.string, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    throw MapleError.invalid("This PDF has no selectable text. Export it as text first.")
                }
                content = text
            } else { content = try String(contentsOf: url, encoding: .utf8) }
            let pathID = SHA256.hash(data: Data(url.standardizedFileURL.path.utf8)).map { String(format: "%02x", $0) }.joined()
            try await ingest(content: content, connector: resume ? "resume" : "notes", type: resume ? "resume.imported" : "note.imported", externalID: pathID)
            if resume { importedResume = url.lastPathComponent }
            message = "Imported \(url.lastPathComponent). Source text is now available as evidence."
        } catch { self.error = error.localizedDescription }
    }

    func savePerson(id: String, name: String, relationship: String) async -> Bool {
        guard let store else { return false }
        do {
            guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  name.utf8.count <= 1024, relationship.utf8.count <= 1024 else {
                throw MapleError.invalid("Enter a name and keep each field under 1 KB.")
            }
            try await store.correct(subject: id, predicate: "person.name", value: name.trimmingCharacters(in: .whitespacesAndNewlines))
            try await store.correct(subject: id, predicate: "person.relationship", value: relationship.isEmpty ? "contact" : relationship)
            try await ingest(content: "User supplied contact: \(name). Relationship: \(relationship).", connector: "people", type: "contact.updated", subjects: ["person:self", id])
            await refresh()
            return true
        } catch { self.error = error.localizedDescription; return false }
    }

    func answer(_ item: WorkItem, text: String) async {
        do {
            try await store?.respond(to: item.id, text: text)
            await refresh()
            message = "Your answer is saved and queued as new context."
        } catch { self.error = error.localizedDescription }
    }

    func retry() async {
        do { try await store?.retryLocalIntelligence(); try await store?.retryFailures(); await refresh() }
        catch { self.error = error.localizedDescription }
    }
}

enum KeyStore {
    static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "com.just.maple.JapaneseMaple.jev-development",
         kSecAttrAccount as String: "typesafe"]
    }
    static func read(allowAuthentication: Bool = false) throws -> String? {
        var q = query
        if !allowAuthentication {
            let context = LAContext()
            context.interactionNotAllowed = true
            q[kSecUseAuthenticationContext as String] = context
        }
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        if status == errSecInteractionNotAllowed || status == errSecAuthFailed { throw MapleError.invalid("Your saved Jev key needs Keychain access after this app rebuild. Open Connections and choose Unlock saved key.") }
        guard status == errSecSuccess, let data = result as? Data else { throw MapleError.invalid("Could not read the Jev key from Keychain (\(status)).") }
        return String(data: data, encoding: .utf8)
    }
    static func save(_ value: String) throws {
        let data = Data(value.utf8)
        var q = query
        q[kSecValueData as String] = data
        let status = SecItemAdd(q as CFDictionary, nil)
        let final = status == errSecDuplicateItem ? SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary) : status
        guard final == errSecSuccess else { throw MapleError.invalid("Could not save the Jev key to Keychain (\(final)).") }
    }
    static func remove() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw MapleError.invalid("Could not remove the Jev key (\(status)).") }
    }
}

/// Coalesce overlapping context reads, but wait for a trailing pass when a mutation
/// requests refresh after an earlier pass has already read some of the state.
@MainActor final class WorkspaceRefreshCoordinator {
    private var running=false
    private var requested=false
    private(set) var waitingCount=0
    private var waiters:[CheckedContinuation<Void,Never>]=[]
    func run(_ operation: () async -> Void) async {
        if running {
            requested=true
            waitingCount += 1
            await withCheckedContinuation {waiters.append($0)}
            return
        }
        running=true
        repeat {
            requested=false
            await operation()
        } while requested
        running=false
        let completed=waiters;waiters=[];waitingCount=0
        for continuation in completed {continuation.resume()}
    }
}
