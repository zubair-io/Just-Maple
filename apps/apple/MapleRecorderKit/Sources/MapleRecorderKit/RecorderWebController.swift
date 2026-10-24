import Foundation

/// The webview owns presentation; audio, model execution, and secrets stay native.
@MainActor
public final class RecorderWebController {
    public static let shared = RecorderWebController()
    private let session: RecorderSession
    private let monitorsLibrary: Bool
    private let recorder = AudioRecorder()
    private let player = AudioPlayer()
    private var playingID: UUID?
    private var selectedID: UUID?
    private var job: Task<Void, Never>?
    private var jobID: UUID?
    private var processingQueue: [UUID] = []
    private var pipeline: ProcessingPipeline?
    private var status = ""
    private var lastError: String?
    private var initialized = false
    private var starting = false
    private var cleaningNote = false

    init(session: RecorderSession = .shared, monitorsLibrary: Bool = true) {
        self.session = session
        self.monitorsLibrary = monitorsLibrary
    }

    public private(set) var webOpenRequested = false

    public func markWebWorkspaceOpened() { webOpenRequested = false }

    /// Cleans text from an open Just Maple note with the shared on-device S1 model.
    public func cleanNote(_ text: String) async throws -> String {
        let input = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !input.isEmpty else { throw WebError.message("The note has no text to clean.") }
        guard job == nil, !cleaningNote else {
            throw WebError.message("Wait for the current local AI task to finish.")
        }

        cleaningNote = true
        defer { cleaningNote = false }
        try await session.models.textNormalizer.initialize()
        return try await session.models.textNormalizer.normalize(text: input)
    }

    public func performShortcut(start: Bool) async throws {
        _ = try await execute(start ? "start" : "stop", [:])
        webOpenRequested = true
        NotificationCenter.default.post(name: Notification.Name("MapleRecorderWebOpen"), object: nil)
    }

    /// Always produces a correlated response, including validation and runtime errors.
    public func handle(_ data: Data) async -> Data {
        var requestID = ""
        var response: [String: Any] = [:]
        do {
            guard let request = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let id = request["requestId"] as? String, !id.isEmpty,
                  let operation = request["operation"] as? String else { throw WebError.invalidRequest }
            requestID = id
            response = try await execute(operation, request)
            response["state"] = try snapshot()
        } catch {
            response["error"] = error.localizedDescription
        }
        response["requestId"] = requestID
        return (try? JSONSerialization.data(withJSONObject: response)) ?? Data("{}".utf8)
    }

    private func execute(_ operation: String, _ request: [String: Any]) async throws -> [String: Any] {
        if !initialized {
            initialized = true
            if monitorsLibrary { session.connectLibrary() }
            await session.store.reload()
        }
        if let id = request["recordingId"] as? String {
            guard let uuid = UUID(uuidString: id) else { throw WebError.invalidRequest }
            selectedID = uuid
        }
        switch operation {
        case "state": break
        case "refresh": await session.store.reload()
        case "prepareModels":
            try launchJob(id: nil, label: "Preparing local models…") {
                await self.session.models.ensureModelsReady()
                guard self.session.models.isReady else {
                    throw WebError.message(self.session.models.error ?? "Models could not be loaded.")
                }
                self.processingQueue = self.session.store.recordings.filter { !$0.audioFiles.isEmpty && $0.transcript.isEmpty }.map(\.id)
            }
        case "start":
            guard !starting, !recorder.isRecording else { throw WebError.message("A recording is already in progress.") }
            starting = true
            defer { starting = false }
            player.pause()
            #if os(macOS)
            recorder.includeSystemAudio = request["includeSystemAudio"] as? Bool ?? false
            recorder.settingsManager = session.settings
            recorder.inlinePresentation = true
            #endif
            _ = try await recorder.startRecording(chunkDurationMinutes: session.settings.settings.chunkDurationMinutes)
        case "liveNotes", "liveAssist", "autoAssist":
            #if os(macOS)
            guard recorder.isRecording else { throw WebError.message("Start a recording first.") }
            if operation == "liveNotes" { recorder.updateLiveNotes(request["value"] as? String ?? "") }
            if operation == "liveAssist" { recorder.requestLiveAssist() }
            if operation == "autoAssist" { recorder.setAutomaticAssist(request["flag"] as? Bool ?? false) }
            #else
            throw WebError.message("Presentation Assist is available on Mac.")
            #endif
        case "stop":
            guard recorder.isRecording else { throw WebError.message("No recording is running.") }
            let duration = recorder.elapsedTime
            let result = recorder.stopRecording()
            try StorageLocation.ensureDirectoryExists()
            let mic = try persistAudio(result.micURLs)
            let system = try persistAudio(result.systemURLs)
            var recording = MapleRecording(id: recorder.recordingId ?? UUID(), title: recordingTitle(),
                audioFiles: mic, systemAudioFiles: system, duration: duration)
            #if os(macOS)
            recording.userNotes = result.userNotes
            for screenshot in result.screenshots {
                let name = screenshot.sourceURL.lastPathComponent
                let destination = StorageLocation.recordingsURL.appendingPathComponent(name)
                if !FileManager.default.fileExists(atPath: destination.path) {
                    try FileManager.default.copyItem(at: screenshot.sourceURL, to: destination)
                }
                recording.screenshots.append(TimelineScreenshot(fileName: name, timestamp: screenshot.timestamp))
            }
            #endif
            try session.store.save(recording)
            selectedID = recording.id
            if job == nil { try process(recording) }
            else { processingQueue.append(recording.id) }
        case "process": try process(try recording())
        case "summarize", "clean", "runPrompt", "ask":
            let recording = try recording()
            guard !recording.transcript.isEmpty else { throw WebError.message("Transcribe this recording first.") }
            let provider: LLMProvider
            if operation == "clean" { provider = .none }
            else { provider = try self.provider(request) }
            try launchJob(id: recording.id, label: operation == "clean" ? "Cleaning transcript…" : "Generating response…") {
                switch operation {
                case "summarize":
                    let result = try await Summarizer.summarize(transcript: recording.transcript,
                        speakers: recording.speakers, provider: provider)
                    var current = try self.recording(recording.id)
                    current.summary = result.summary
                    current.tags = result.tags
                    if !result.title.isEmpty { current.title = RecordingStore.stripMarkdown(result.title) }
                    try self.session.store.update(current)
                case "clean":
                    try await self.session.models.textNormalizer.initialize()
                    let notes = try await self.session.models.textNormalizer.normalize(
                        transcript: recording.transcript, speakers: recording.speakers)
                    var current = try self.recording(recording.id)
                    current.notes = notes
                    try self.session.store.update(current)
                default:
                    let prompt: CustomPrompt
                    if operation == "ask" {
                        prompt = CustomPrompt(id: UUID(), name: "Ask AI", systemPrompt: try self.requiredString(request, "body"), createdAt: Date())
                    } else {
                        guard let id = request["promptId"] as? String,
                              let saved = self.session.prompts.prompts.first(where: { $0.id.uuidString == id }) else { throw WebError.invalidRequest }
                        prompt = saved
                    }
                    let result = try await PromptRunner.execute(prompt: prompt, additionalContext: request["context"] as? String,
                        transcript: recording.transcript, speakers: recording.speakers, provider: provider)
                    var current = try self.recording(recording.id)
                    current.promptResults.append(result)
                    try self.session.store.update(current)
                }
            }
        case "edit":
            var recording = try editableRecording()
            let field = try requiredString(request, "field")
            let value = request["value"] as? String ?? ""
            switch field {
            case "title":
                guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw WebError.invalidRequest }
                recording.title = value
            case "summary": recording.summary = value
            case "notes": recording.notes = value
            case "userNotes": recording.userNotes = value
            case "tags": recording.tags = (request["tags"] as? [String] ?? []).filter { !$0.isEmpty }
            case "speaker":
                guard let id = request["speakerId"] as? String,
                      let index = recording.speakers.firstIndex(where: { $0.id == id }), !value.isEmpty else { throw WebError.invalidRequest }
                recording.speakers[index].displayName = value
            case "segment":
                guard let index = request["segmentIndex"] as? Int, recording.transcript.indices.contains(index) else { throw WebError.invalidRequest }
                recording.transcript[index].text = value
                // Word timing no longer describes an edited sentence.
                recording.transcript[index].words = []
            default: throw WebError.invalidRequest
            }
            try session.store.update(recording)
        case "delete":
            let recording = try editableRecording()
            if playingID == recording.id { player.pause(); playingID = nil }
            try session.store.delete(recording)
            selectedID = nil
        case "play", "seek", "rate":
            let recording = try recording()
            if playingID != recording.id {
                player.pause()
                let mic = recording.audioFiles.map { StorageLocation.recordingsURL.appendingPathComponent($0) }
                let system = recording.systemAudioFiles.map { StorageLocation.recordingsURL.appendingPathComponent($0) }
                try await ICloudFileDownloader.ensureAllDownloaded(urls: mic + system)
                try player.loadWithSystemTracks(micURLs: mic, systemURLs: system)
                playingID = recording.id
            }
            switch operation {
            case "play":
                if player.currentTime >= player.duration { player.seek(to: 0) }
                player.togglePlayPause()
            case "seek": player.seek(to: request["number"] as? Double ?? 0)
            default: player.setRate(Float(request["number"] as? Double ?? 1))
            }
        case "pause": player.pause()
        case "export": return ["exported": MarkdownSerializer.serialize(try recording())]
        case "screenshot":
            let recording = try recording()
            let name = try requiredString(request, "value")
            guard recording.screenshots.contains(where: { $0.fileName == name }),
                  name == (name as NSString).lastPathComponent else { throw WebError.invalidRequest }
            let url = StorageLocation.recordingsURL.appendingPathComponent(name)
            try await ICloudFileDownloader.ensureAllDownloaded(urls: [url])
            let data = try Data(contentsOf: url)
            guard data.count <= 8 * 1024 * 1024 else { throw WebError.message("Screenshot is too large to preview.") }
            return ["image": "data:image/jpeg;base64,\(data.base64EncodedString())"]
        case "savePrompt":
            let name = try requiredString(request, "name")
            let body = try requiredString(request, "body")
            if let id = request["promptId"] as? String, let existing = session.prompts.prompts.first(where: { $0.id.uuidString == id }) {
                var prompt = existing
                prompt.name = name; prompt.systemPrompt = body
                try session.prompts.update(prompt)
            } else {
                try session.prompts.add(CustomPrompt(id: UUID(), name: name, systemPrompt: body, createdAt: Date()))
            }
        case "deletePrompt":
            guard let id = request["promptId"] as? String,
                  let prompt = session.prompts.prompts.first(where: { $0.id.uuidString == id }) else { throw WebError.invalidRequest }
            try session.prompts.delete(prompt)
        case "deleteResult":
            var recording = try editableRecording()
            let id = try requiredString(request, "value")
            recording.promptResults.removeAll { $0.id.uuidString == id }
            try session.store.update(recording)
        case "settings": try updateSettings(request)
        case "calendarAccess":
            guard await session.calendar.requestAccess() else { throw WebError.message("Calendar access was denied. You can enable it in System Settings.") }
        case "dismissError": lastError = nil
        default: throw WebError.invalidRequest
        }
        return [:]
    }

    private func process(_ recording: MapleRecording) throws {
        try launchJob(id: recording.id, label: "Preparing transcription…") {
            await self.session.models.ensureModelsReady()
            guard self.session.models.isReady else { throw WebError.message(self.session.models.error ?? "Models are unavailable.") }
            let urls = (recording.audioFiles + recording.systemAudioFiles).map { StorageLocation.recordingsURL.appendingPathComponent($0) }
            try await ICloudFileDownloader.ensureAllDownloaded(urls: urls)
            let pipeline = self.session.models.createPipeline()
            self.pipeline = pipeline
            try await self.session.store.processRecording(recording, pipeline: pipeline,
                transcription: self.session.models.transcriptionManager, diarization: self.session.models.diarizationManager,
                summarizationProvider: self.session.settings.preferredProvider)
        }
    }

    private func launchJob(id: UUID?, label: String, work: @escaping @MainActor () async throws -> Void) throws {
        guard job == nil else { throw WebError.message("Wait for the current processing task to finish.") }
        lastError = nil; status = label; jobID = id
        job = Task {
            defer {
                self.job = nil; self.jobID = nil; self.pipeline = nil; self.status = ""
                self.processNextQueuedRecording()
            }
            do { try await work() } catch { self.lastError = error.localizedDescription }
        }
    }

    private func processNextQueuedRecording() {
        while !processingQueue.isEmpty {
            let id = processingQueue.removeFirst()
            guard let recording = session.store.recordings.first(where: { $0.id == id }) else { continue }
            do { try process(recording) } catch { lastError = error.localizedDescription }
            return
        }
    }

    private func editableRecording() throws -> MapleRecording {
        let recording = try recording()
        guard jobID != recording.id else { throw WebError.message("Wait for this recording to finish processing before editing it.") }
        return recording
    }

    private func recording(_ id: UUID? = nil) throws -> MapleRecording {
        guard let id = id ?? selectedID, let recording = session.store.recordings.first(where: { $0.id == id }) else {
            throw WebError.message("Recording no longer exists. Refresh the library.")
        }
        return recording
    }

    private func requiredString(_ request: [String: Any], _ key: String) throws -> String {
        guard let value = request[key] as? String, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw WebError.invalidRequest }
        return value
    }

    private func provider(_ request: [String: Any]) throws -> LLMProvider {
        let provider = (request["provider"] as? String).flatMap(LLMProvider.init(rawValue:)) ?? session.settings.preferredProvider
        if provider != .none, LLMServiceFactory.service(for: provider)?.isAvailable == true { return provider }
        throw WebError.message("Choose an available AI provider in Recorder settings first.")
    }

    private func persistAudio(_ urls: [URL]) throws -> [String] {
        try urls.map { url in
            let destination = StorageLocation.recordingsURL.appendingPathComponent(url.lastPathComponent)
            if url != destination, !FileManager.default.fileExists(atPath: destination.path) {
                try FileManager.default.copyItem(at: url, to: destination)
            }
            return url.lastPathComponent
        }
    }

    private func recordingTitle() -> String {
        if session.settings.calendarEnabled, session.settings.calendarTitleMode != .off,
           let title = session.calendar.currentMeetingTitle(calendarIdentifiers: session.settings.selectedCalendarIdentifiers) {
            return session.settings.calendarTitleMode == .exactName ? title : "\(title) — Recording"
        }
        return "Recording \(Date().formatted(date: .abbreviated, time: .shortened))"
    }

    private func updateSettings(_ request: [String: Any]) throws {
        guard let values = request["settings"] as? [String: Any] else { throw WebError.invalidRequest }
        var settings = session.settings.settings
        if let provider = values["provider"] as? String {
            guard let parsed = LLMProvider(rawValue: provider) else { throw WebError.invalidRequest }
            settings.preferredLLMProvider = parsed
        }
        if let minutes = values["chunkMinutes"] as? Int {
            guard (1...120).contains(minutes) else { throw WebError.invalidRequest }
            settings.chunkDurationMinutes = minutes
        }
        if let enabled = values["calendarEnabled"] as? Bool { settings.calendarEnabled = enabled }
        if let mode = values["calendarTitleMode"] as? String, let parsed = CalendarTitleMode(rawValue: mode) { settings.calendarTitleMode = parsed }
        if let ids = values["calendarIds"] as? [String] { settings.selectedCalendarIdentifiers = ids }
        if let prompt = values["assistPrompt"] as? String { settings.assistPrompt = prompt }
        if let share = values["shareScreenshots"] as? Bool { settings.shareAssistScreenshotsWithCloudAI = share }
        session.settings.settings = settings
        try session.settings.save()
        // Keys are write-only across the bridge; never include them in state or logs.
        if let key = values["claudeKey"] as? String {
            if key.isEmpty { KeychainManager.delete(key: .claudeAPIKey) }
            else { try KeychainManager.save(key: .claudeAPIKey, value: key) }
        }
        if let key = values["openAIKey"] as? String {
            if key.isEmpty { KeychainManager.delete(key: .openAIAPIKey) }
            else { try KeychainManager.save(key: .openAIAPIKey, value: key) }
        }
    }

    private func json<T: Encodable>(_ value: T) throws -> Any {
        let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
        return try JSONSerialization.jsonObject(with: encoder.encode(value))
    }

    private func snapshot() throws -> [String: Any] {
        let settings = session.settings.settings
        var state: [String: Any] = [
            "recordings": session.store.recordings.map { recording -> [String: Any] in
                ["id": recording.id.uuidString, "title": recording.title, "duration": recording.duration,
                 "createdAt": ISO8601DateFormatter().string(from: recording.createdAt), "tags": recording.tags,
                 "hasTranscript": !recording.transcript.isEmpty, "hasSystemAudio": !recording.systemAudioFiles.isEmpty]
            },
            "isRecording": recorder.isRecording, "elapsed": recorder.elapsedTime, "audioLevel": recorder.audioLevel,
            "warning": recorder.recordingWarning as Any? ?? NSNull(),
            "queueCount": processingQueue.count,
            "busy": job != nil, "jobId": jobID?.uuidString as Any? ?? NSNull(),
            "status": session.models.isDownloading ? session.models.downloadStep.rawValue : (pipeline?.progress.isEmpty == false ? pipeline!.progress : status),
            "error": lastError as Any? ?? NSNull(), "modelsReady": session.models.isReady,
            "modelProgress": session.models.downloadProgress,
            "prompts": try json(session.prompts.prompts),
            "playback": ["recordingId": playingID?.uuidString as Any? ?? NSNull(), "playing": player.isPlaying,
                         "time": player.currentTime, "duration": player.duration, "rate": player.playbackRate],
            "settings": ["provider": settings.preferredLLMProvider.rawValue, "chunkMinutes": settings.chunkDurationMinutes,
                "calendarEnabled": settings.calendarEnabled, "calendarTitleMode": settings.calendarTitleMode.rawValue,
                "calendarIds": settings.selectedCalendarIdentifiers, "assistPrompt": settings.assistPrompt,
                "shareScreenshots": settings.shareAssistScreenshotsWithCloudAI,
                "hasClaudeKey": !session.settings.claudeAPIKey.isEmpty, "hasOpenAIKey": !session.settings.openAIAPIKey.isEmpty],
            "providers": LLMProvider.allCases.map { provider in
                ["id": provider.rawValue, "name": provider.displayName,
                 "available": provider == .none || LLMServiceFactory.service(for: provider)?.isAvailable == true] as [String: Any]
            },
            "calendars": session.calendar.calendars.map { ["id": $0.id, "title": $0.title, "source": $0.sourceName] }
        ]
        #if os(macOS)
        state["systemAudioSupported"] = true
        state["assist"] = recorder.liveAssistState
        #else
        state["systemAudioSupported"] = false
        #endif
        if let id = selectedID, let recording = session.store.recordings.first(where: { $0.id == id }) {
            var detail = try json(recording.metadata) as! [String: Any]
            detail["title"] = recording.title; detail["summary"] = recording.summary
            state["selected"] = detail
        } else { state["selected"] = NSNull() }
        return state
    }

    enum WebError: LocalizedError {
        case invalidRequest, message(String)
        var errorDescription: String? {
            switch self {
            case .invalidRequest: "Invalid recorder request."
            case .message(let message): message
            }
        }
    }
}
