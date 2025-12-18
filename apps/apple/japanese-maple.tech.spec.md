# Living Documents: Technical Specification

## Swift + WKWebView Architecture

**Version:** 0.1  
**Target Platform:** macOS 14.0+ (Sonoma)  
**Language:** Swift 5.9+ / TypeScript 5.x

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Project Structure](#project-structure)
3. [Native Layer (Swift)](#native-layer-swift)
4. [Web Layer (TypeScript/HTML)](#web-layer-typescripthtml)
5. [Native Bridge Protocol](#native-bridge-protocol)
6. [Core Services](#core-services)
7. [Data Model & Storage](#data-model--storage)
8. [Widget System](#widget-system)
9. [Build & Development](#build--development)
10. [Security Considerations](#security-considerations)

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│                      macOS Application                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Swift App Shell                        │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │  │
│  │  │   AppKit    │  │   Menu Bar  │  │  Keyboard   │      │  │
│  │  │   Window    │  │   Controls  │  │  Shortcuts  │      │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                      WKWebView                            │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │              Web Application (TS/HTML)              │  │  │
│  │  │  ┌────────────┐ ┌────────────┐ ┌────────────┐     │  │  │
│  │  │  │   Editor   │ │  Widgets   │ │   State    │     │  │  │
│  │  │  │  (BlockNote)│ │  Runtime   │ │   Store    │     │  │  │
│  │  │  └────────────┘ └────────────┘ └────────────┘     │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                    NativeBridge (IPC)                          │
│                              │                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   Native Services                         │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │  │
│  │  │  Audio   │ │Transcribe│ │  Home    │ │   File   │   │  │
│  │  │ Recorder │ │ (Whisper)│ │ Assistant│ │  System  │   │  │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Data Layer                             │  │
│  │  ┌──────────────────┐  ┌──────────────────┐             │  │
│  │  │  SQLite + GRDB   │  │   File Storage   │             │  │
│  │  │  (Documents DB)  │  │  (Media/Assets)  │             │  │
│  │  └──────────────────┘  └──────────────────┘             │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

### Design Principles

1. **Web-first UI**: All document editing and widget rendering in web layer
2. **Native for hardware**: Audio, file system, system integration in Swift
3. **Thin bridge**: Minimal, well-defined IPC protocol
4. **Offline-first**: All data local, sync optional
5. **Hot-reloadable web**: Dev server for rapid UI iteration

---

## Project Structure

```
LivingDocuments/
├── LivingDocuments.xcodeproj
├── LivingDocuments/
│   ├── App/
│   │   ├── LivingDocumentsApp.swift      # App entry point
│   │   ├── AppDelegate.swift             # App lifecycle, menu bar
│   │   └── AppState.swift                # Global app state
│   │
│   ├── Windows/
│   │   ├── MainWindow.swift              # Primary document window
│   │   ├── WebViewController.swift       # WKWebView container
│   │   └── QuickCapturePanel.swift       # Floating quick-capture
│   │
│   ├── Bridge/
│   │   ├── NativeBridge.swift            # WKScriptMessageHandler
│   │   ├── BridgeProtocol.swift          # Message types & codables
│   │   └── BridgeRouter.swift            # Route messages to services
│   │
│   ├── Services/
│   │   ├── AudioRecorderService.swift    # AVFoundation recording
│   │   ├── TranscriptionService.swift    # Whisper.cpp integration
│   │   ├── HomeAssistantService.swift    # HA WebSocket client
│   │   ├── FileSystemService.swift       # Document storage
│   │   ├── CalendarService.swift         # EventKit integration
│   │   └── NotificationService.swift     # UNUserNotificationCenter
│   │
│   ├── Models/
│   │   ├── Document.swift                # Document model
│   │   ├── Widget.swift                  # Widget configuration
│   │   └── Workspace.swift               # Workspace/folder model
│   │
│   ├── Storage/
│   │   ├── Database.swift                # GRDB setup
│   │   ├── DocumentStore.swift           # Document CRUD
│   │   └── MediaStore.swift              # Binary asset storage
│   │
│   └── Resources/
│       ├── Assets.xcassets
│       ├── Whisper/                      # Whisper model files
│       │   └── ggml-base.en.bin
│       └── WebApp/                       # Bundled web app (prod)
│           └── index.html
│
├── WebApp/                               # Separate web project
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.ts                       # Entry point
│       ├── editor/
│       │   ├── Editor.tsx                # BlockNote wrapper
│       │   ├── extensions/               # Custom blocks/widgets
│       │   └── schema.ts                 # Document schema
│       ├── widgets/
│       │   ├── WidgetRuntime.ts          # Widget lifecycle manager
│       │   ├── WidgetRegistry.ts         # Widget type registry
│       │   ├── base/
│       │   │   └── BaseWidget.ts         # Widget base class
│       │   └── builtin/
│       │       ├── AudioRecorderWidget.tsx
│       │       ├── DropdownWidget.tsx
│       │       ├── AISummaryWidget.tsx
│       │       └── HomeAssistantWidget.tsx
│       ├── bridge/
│       │   ├── NativeBridge.ts           # JS side of bridge
│       │   ├── types.ts                  # Shared types
│       │   └── mock.ts                   # Browser dev mocks
│       ├── state/
│       │   ├── store.ts                  # Zustand store
│       │   ├── documentSlice.ts          # Document state
│       │   └── widgetSlice.ts            # Widget state
│       ├── context/
│       │   └── DocumentContext.ts        # Context inference
│       └── styles/
│           └── main.css
│
├── Shared/                               # Shared type definitions
│   └── BridgeTypes.ts                    # Generate Swift + TS types
│
└── Scripts/
    ├── build-web.sh                      # Build web app
    ├── dev.sh                            # Run dev server
    └── bundle-whisper.sh                 # Download Whisper model
```

---

## Native Layer (Swift)

### App Entry Point

```swift
// LivingDocumentsApp.swift
import SwiftUI

@main
struct LivingDocumentsApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var appState = AppState.shared

    var body: some Scene {
        WindowGroup {
            MainWindow()
                .environmentObject(appState)
        }
        .commands {
            CommandGroup(replacing: .newItem) {
                Button("New Document") {
                    appState.createNewDocument()
                }
                .keyboardShortcut("n", modifiers: .command)
            }
        }

        // Menu bar quick capture
        MenuBarExtra("Living Docs", systemImage: "doc.text") {
            QuickCaptureMenu()
        }

        Settings {
            SettingsView()
        }
    }
}
```

### AppDelegate

```swift
// AppDelegate.swift
import AppKit

class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Register global keyboard shortcuts
        KeyboardShortcuts.register()

        // Initialize services
        ServiceContainer.shared.initialize()

        // Start Home Assistant connection if configured
        if let haConfig = UserDefaults.standard.homeAssistantConfig {
            HomeAssistantService.shared.connect(config: haConfig)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false  // Keep running for menu bar
    }

    func applicationWillTerminate(_ notification: Notification) {
        // Cleanup
        AudioRecorderService.shared.stopIfRecording()
        HomeAssistantService.shared.disconnect()
    }
}
```

### WebView Controller

```swift
// WebViewController.swift
import WebKit

class WebViewController: NSViewController {
    private var webView: WKWebView!
    private var bridge: NativeBridge!

    override func loadView() {
        // Configure WKWebView
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")

        // Setup user content controller for bridge
        let contentController = WKUserContentController()
        bridge = NativeBridge(webView: nil)  // Set after webView init
        contentController.add(bridge, name: "native")
        config.userContentController = contentController

        // Allow local file access
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self

        #if DEBUG
        // Enable Web Inspector
        webView.isInspectable = true
        #endif

        bridge.webView = webView
        self.view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        loadWebApp()
    }

    private func loadWebApp() {
        #if DEBUG
        // Dev server for hot reload
        if let devURL = URL(string: "http://localhost:5173") {
            webView.load(URLRequest(url: devURL))
            return
        }
        #endif

        // Production: load bundled app
        if let indexURL = Bundle.main.url(forResource: "index",
                                          withExtension: "html",
                                          subdirectory: "WebApp") {
            webView.loadFileURL(indexURL,
                               allowingReadAccessTo: indexURL.deletingLastPathComponent())
        }
    }
}

extension WebViewController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Inject initial state
        let initialState = AppState.shared.getInitialWebState()
        bridge.send(.initialize(initialState))
    }
}
```

---

## Native Bridge Protocol

### Message Types

```swift
// BridgeProtocol.swift
import Foundation

// MARK: - Messages from Web → Native

enum WebToNativeMessage: Codable {
    // Audio
    case startRecording(StartRecordingPayload)
    case stopRecording(widgetId: String)
    case pauseRecording(widgetId: String)
    case resumeRecording(widgetId: String)

    // Transcription
    case transcribeAudio(TranscribePayload)

    // Home Assistant
    case subscribeEntity(entityId: String, widgetId: String)
    case unsubscribeEntity(entityId: String, widgetId: String)
    case callService(CallServicePayload)

    // File System
    case saveDocument(SaveDocumentPayload)
    case loadDocument(documentId: String)
    case listDocuments(folderId: String?)
    case deleteDocument(documentId: String)

    // AI
    case requestAISummary(AISummaryPayload)

    // System
    case showNotification(NotificationPayload)
    case copyToClipboard(text: String)
    case openExternal(url: String)

    // Calendar
    case getCalendarEvents(CalendarQueryPayload)
    case createCalendarEvent(CalendarEventPayload)
}

struct StartRecordingPayload: Codable {
    let widgetId: String
    let options: RecordingOptions?
}

struct RecordingOptions: Codable {
    let transcribeRealtime: Bool
    let language: String?
    let inputDevice: String?
}

struct TranscribePayload: Codable {
    let audioPath: String
    let language: String?
    let widgetId: String
}

struct CallServicePayload: Codable {
    let domain: String
    let service: String
    let entityId: String?
    let data: [String: AnyCodable]?
}

struct SaveDocumentPayload: Codable {
    let documentId: String?  // nil for new doc
    let title: String
    let content: String  // JSON string of editor state
    let widgetStates: [String: AnyCodable]
}

struct AISummaryPayload: Codable {
    let widgetId: String
    let context: [String]  // Text chunks to summarize
    let prompt: String?
    let model: String?
}

// MARK: - Messages from Native → Web

enum NativeToWebMessage: Codable {
    // Initialization
    case initialize(InitialState)
    case documentLoaded(DocumentData)

    // Audio
    case recordingStarted(widgetId: String)
    case recordingStopped(widgetId: String, audioPath: String, duration: Double)
    case recordingError(widgetId: String, error: String)
    case audioLevel(widgetId: String, level: Float)

    // Transcription
    case transcriptionProgress(widgetId: String, text: String, isFinal: Bool)
    case transcriptionComplete(widgetId: String, text: String)
    case transcriptionError(widgetId: String, error: String)

    // Home Assistant
    case entityStateChanged(entityId: String, state: EntityState)
    case homeAssistantConnected
    case homeAssistantDisconnected(error: String?)

    // AI
    case aiSummaryProgress(widgetId: String, text: String)
    case aiSummaryComplete(widgetId: String, text: String)
    case aiSummaryError(widgetId: String, error: String)

    // File System
    case documentSaved(documentId: String)
    case documentsList(documents: [DocumentMetadata])

    // Calendar
    case calendarEvents(events: [CalendarEvent])

    // System
    case error(code: String, message: String)
}

struct InitialState: Codable {
    let recentDocuments: [DocumentMetadata]
    let workspaces: [Workspace]
    let homeAssistantConnected: Bool
    let subscribedEntities: [String: EntityState]
}

struct EntityState: Codable {
    let entityId: String
    let state: String
    let attributes: [String: AnyCodable]
    let lastChanged: Date
}
```

### Native Bridge Implementation

```swift
// NativeBridge.swift
import WebKit

class NativeBridge: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?
    private let router = BridgeRouter()
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init(webView: WKWebView?) {
        self.webView = webView
        super.init()
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601
    }

    // MARK: - Receive from Web

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? String,
              let data = body.data(using: .utf8) else {
            print("Invalid message format")
            return
        }

        do {
            let message = try decoder.decode(WebToNativeMessage.self, from: data)
            Task {
                await router.handle(message, bridge: self)
            }
        } catch {
            print("Failed to decode message: \(error)")
            send(.error(code: "DECODE_ERROR", message: error.localizedDescription))
        }
    }

    // MARK: - Send to Web

    func send(_ message: NativeToWebMessage) {
        guard let webView = webView else { return }

        do {
            let data = try encoder.encode(message)
            guard let json = String(data: data, encoding: .utf8) else { return }

            let js = "window.__nativeBridge__.receive(\(json))"

            DispatchQueue.main.async {
                webView.evaluateJavaScript(js) { _, error in
                    if let error = error {
                        print("JS eval error: \(error)")
                    }
                }
            }
        } catch {
            print("Failed to encode message: \(error)")
        }
    }
}
```

### Bridge Router

```swift
// BridgeRouter.swift
import Foundation

actor BridgeRouter {
    private let audioService = AudioRecorderService.shared
    private let transcriptionService = TranscriptionService.shared
    private let homeAssistantService = HomeAssistantService.shared
    private let fileService = FileSystemService.shared
    private let aiService = AIService.shared

    func handle(_ message: WebToNativeMessage, bridge: NativeBridge) async {
        switch message {

        // MARK: Audio
        case .startRecording(let payload):
            do {
                try await audioService.startRecording(
                    widgetId: payload.widgetId,
                    options: payload.options,
                    onLevel: { level in
                        bridge.send(.audioLevel(widgetId: payload.widgetId, level: level))
                    },
                    onRealtimeTranscript: payload.options?.transcribeRealtime == true ? { text in
                        bridge.send(.transcriptionProgress(
                            widgetId: payload.widgetId,
                            text: text,
                            isFinal: false
                        ))
                    } : nil
                )
                bridge.send(.recordingStarted(widgetId: payload.widgetId))
            } catch {
                bridge.send(.recordingError(widgetId: payload.widgetId, error: error.localizedDescription))
            }

        case .stopRecording(let widgetId):
            do {
                let result = try await audioService.stopRecording(widgetId: widgetId)
                bridge.send(.recordingStopped(
                    widgetId: widgetId,
                    audioPath: result.path,
                    duration: result.duration
                ))
            } catch {
                bridge.send(.recordingError(widgetId: widgetId, error: error.localizedDescription))
            }

        // MARK: Transcription
        case .transcribeAudio(let payload):
            do {
                let transcript = try await transcriptionService.transcribe(
                    audioPath: payload.audioPath,
                    language: payload.language
                ) { progress in
                    bridge.send(.transcriptionProgress(
                        widgetId: payload.widgetId,
                        text: progress,
                        isFinal: false
                    ))
                }
                bridge.send(.transcriptionComplete(widgetId: payload.widgetId, text: transcript))
            } catch {
                bridge.send(.transcriptionError(widgetId: payload.widgetId, error: error.localizedDescription))
            }

        // MARK: Home Assistant
        case .subscribeEntity(let entityId, let widgetId):
            homeAssistantService.subscribe(entityId: entityId) { state in
                bridge.send(.entityStateChanged(entityId: entityId, state: state))
            }

        case .unsubscribeEntity(let entityId, _):
            homeAssistantService.unsubscribe(entityId: entityId)

        case .callService(let payload):
            do {
                try await homeAssistantService.callService(
                    domain: payload.domain,
                    service: payload.service,
                    entityId: payload.entityId,
                    data: payload.data
                )
            } catch {
                bridge.send(.error(code: "HA_SERVICE_ERROR", message: error.localizedDescription))
            }

        // MARK: File System
        case .saveDocument(let payload):
            do {
                let id = try await fileService.saveDocument(payload)
                bridge.send(.documentSaved(documentId: id))
            } catch {
                bridge.send(.error(code: "SAVE_ERROR", message: error.localizedDescription))
            }

        case .loadDocument(let documentId):
            do {
                let doc = try await fileService.loadDocument(id: documentId)
                bridge.send(.documentLoaded(doc))
            } catch {
                bridge.send(.error(code: "LOAD_ERROR", message: error.localizedDescription))
            }

        case .listDocuments(let folderId):
            do {
                let docs = try await fileService.listDocuments(folderId: folderId)
                bridge.send(.documentsList(documents: docs))
            } catch {
                bridge.send(.error(code: "LIST_ERROR", message: error.localizedDescription))
            }

        // MARK: AI
        case .requestAISummary(let payload):
            do {
                let summary = try await aiService.generateSummary(
                    context: payload.context,
                    prompt: payload.prompt,
                    model: payload.model
                ) { progress in
                    bridge.send(.aiSummaryProgress(widgetId: payload.widgetId, text: progress))
                }
                bridge.send(.aiSummaryComplete(widgetId: payload.widgetId, text: summary))
            } catch {
                bridge.send(.aiSummaryError(widgetId: payload.widgetId, error: error.localizedDescription))
            }

        // ... other cases
        default:
            bridge.send(.error(code: "UNKNOWN_MESSAGE", message: "Unhandled message type"))
        }
    }
}
```

---

## Core Services

### Audio Recorder Service

```swift
// AudioRecorderService.swift
import AVFoundation

class AudioRecorderService {
    static let shared = AudioRecorderService()

    private var audioEngine: AVAudioEngine?
    private var audioFile: AVAudioFile?
    private var activeRecordings: [String: RecordingSession] = [:]

    struct RecordingSession {
        let widgetId: String
        let startTime: Date
        let filePath: URL
        var audioFile: AVAudioFile
    }

    struct RecordingResult {
        let path: String
        let duration: Double
    }

    func startRecording(
        widgetId: String,
        options: RecordingOptions?,
        onLevel: @escaping (Float) -> Void,
        onRealtimeTranscript: ((String) -> Void)?
    ) async throws {
        // Check permissions
        guard await requestMicrophonePermission() else {
            throw RecordingError.permissionDenied
        }

        let audioEngine = AVAudioEngine()
        let inputNode = audioEngine.inputNode
        let format = inputNode.outputFormat(forBus: 0)

        // Create output file
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let fileName = "\(widgetId)_\(Date().timeIntervalSince1970).m4a"
        let filePath = documentsPath.appendingPathComponent("Recordings").appendingPathComponent(fileName)

        // Ensure directory exists
        try FileManager.default.createDirectory(at: filePath.deletingLastPathComponent(),
                                                 withIntermediateDirectories: true)

        // Create audio file
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 44100.0,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ]

        let audioFile = try AVAudioFile(forWriting: filePath, settings: settings)

        // Install tap for recording and level metering
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, time in
            // Write to file
            try? audioFile.write(from: buffer)

            // Calculate level
            let level = self?.calculateLevel(buffer: buffer) ?? 0
            DispatchQueue.main.async {
                onLevel(level)
            }

            // Real-time transcription if enabled
            if let onTranscript = onRealtimeTranscript {
                Task {
                    // Buffer audio and send to Whisper in chunks
                    // Implementation depends on whisper.cpp streaming support
                }
            }
        }

        try audioEngine.start()

        let session = RecordingSession(
            widgetId: widgetId,
            startTime: Date(),
            filePath: filePath,
            audioFile: audioFile
        )

        activeRecordings[widgetId] = session
        self.audioEngine = audioEngine
    }

    func stopRecording(widgetId: String) async throws -> RecordingResult {
        guard let session = activeRecordings[widgetId] else {
            throw RecordingError.noActiveRecording
        }

        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine = nil

        let duration = Date().timeIntervalSince(session.startTime)
        activeRecordings.removeValue(forKey: widgetId)

        return RecordingResult(path: session.filePath.path, duration: duration)
    }

    private func calculateLevel(buffer: AVAudioPCMBuffer) -> Float {
        guard let channelData = buffer.floatChannelData?[0] else { return 0 }
        let frameLength = Int(buffer.frameLength)

        var sum: Float = 0
        for i in 0..<frameLength {
            sum += channelData[i] * channelData[i]
        }

        let rms = sqrt(sum / Float(frameLength))
        let db = 20 * log10(rms)

        // Normalize to 0-1 range (assuming -60db to 0db range)
        return max(0, min(1, (db + 60) / 60))
    }

    private func requestMicrophonePermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                continuation.resume(returning: granted)
            }
        }
    }
}

enum RecordingError: Error {
    case permissionDenied
    case noActiveRecording
    case engineStartFailed
}
```

### Transcription Service (Whisper)

```swift
// TranscriptionService.swift
import Foundation

class TranscriptionService {
    static let shared = TranscriptionService()

    private var whisperContext: OpaquePointer?
    private let modelPath: URL

    init() {
        // Load model from bundle
        modelPath = Bundle.main.url(forResource: "ggml-base.en",
                                    withExtension: "bin",
                                    subdirectory: "Whisper")!
    }

    func loadModel() async throws {
        guard whisperContext == nil else { return }

        // whisper.cpp initialization
        whisperContext = whisper_init_from_file(modelPath.path)

        guard whisperContext != nil else {
            throw TranscriptionError.modelLoadFailed
        }
    }

    func transcribe(
        audioPath: String,
        language: String?,
        onProgress: @escaping (String) -> Void
    ) async throws -> String {
        try await loadModel()

        // Load audio file and convert to format Whisper expects
        let audioData = try loadAndConvertAudio(path: audioPath)

        // Configure Whisper parameters
        var params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY)
        params.print_progress = false
        params.print_timestamps = false
        params.language = language.map { UnsafePointer(strdup($0)) }

        // Run transcription
        let result = audioData.withUnsafeBufferPointer { buffer in
            whisper_full(whisperContext, params, buffer.baseAddress, Int32(buffer.count))
        }

        guard result == 0 else {
            throw TranscriptionError.transcriptionFailed
        }

        // Extract text segments
        var fullText = ""
        let segmentCount = whisper_full_n_segments(whisperContext)

        for i in 0..<segmentCount {
            if let text = whisper_full_get_segment_text(whisperContext, i) {
                let segment = String(cString: text)
                fullText += segment
                onProgress(fullText)
            }
        }

        return fullText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func loadAndConvertAudio(path: String) throws -> [Float] {
        // Use AVFoundation to load and convert to 16kHz mono float32
        let url = URL(fileURLWithPath: path)
        let file = try AVAudioFile(forReading: url)

        let format = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                   sampleRate: 16000,
                                   channels: 1,
                                   interleaved: false)!

        let converter = AVAudioConverter(from: file.processingFormat, to: format)!

        let frameCount = AVAudioFrameCount(file.length)
        let inputBuffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: frameCount)!
        try file.read(into: inputBuffer)

        let ratio = 16000.0 / file.processingFormat.sampleRate
        let outputFrameCount = AVAudioFrameCount(Double(frameCount) * ratio)
        let outputBuffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: outputFrameCount)!

        var error: NSError?
        converter.convert(to: outputBuffer, error: &error) { _, outStatus in
            outStatus.pointee = .haveData
            return inputBuffer
        }

        guard let channelData = outputBuffer.floatChannelData?[0] else {
            throw TranscriptionError.audioConversionFailed
        }

        return Array(UnsafeBufferPointer(start: channelData, count: Int(outputBuffer.frameLength)))
    }
}

enum TranscriptionError: Error {
    case modelLoadFailed
    case transcriptionFailed
    case audioConversionFailed
}
```

### Home Assistant Service

```swift
// HomeAssistantService.swift
import Foundation

class HomeAssistantService {
    static let shared = HomeAssistantService()

    private var webSocket: URLSessionWebSocketTask?
    private var session: URLSession?
    private var messageId = 0
    private var subscriptions: [String: [(EntityState) -> Void]] = [:]
    private var entityStates: [String: EntityState] = [:]

    struct Config {
        let host: String
        let port: Int
        let accessToken: String
        let useSSL: Bool

        var wsURL: URL {
            let scheme = useSSL ? "wss" : "ws"
            return URL(string: "\(scheme)://\(host):\(port)/api/websocket")!
        }
    }

    func connect(config: Config) {
        session = URLSession(configuration: .default)
        webSocket = session?.webSocketTask(with: config.wsURL)
        webSocket?.resume()

        // Start receiving messages
        receiveMessages()

        // Authenticate after connection
        authenticate(token: config.accessToken)
    }

    func disconnect() {
        webSocket?.cancel(with: .normalClosure, reason: nil)
        webSocket = nil
        session = nil
    }

    func subscribe(entityId: String, callback: @escaping (EntityState) -> Void) {
        if subscriptions[entityId] == nil {
            subscriptions[entityId] = []

            // Send subscription message
            messageId += 1
            let message: [String: Any] = [
                "id": messageId,
                "type": "subscribe_entities",
                "entity_ids": [entityId]
            ]
            sendMessage(message)
        }

        subscriptions[entityId]?.append(callback)

        // Send current state immediately if available
        if let currentState = entityStates[entityId] {
            callback(currentState)
        }
    }

    func unsubscribe(entityId: String) {
        subscriptions.removeValue(forKey: entityId)
        // Could send unsubscribe message to HA if needed
    }

    func callService(domain: String, service: String, entityId: String?, data: [String: AnyCodable]?) async throws {
        messageId += 1
        var message: [String: Any] = [
            "id": messageId,
            "type": "call_service",
            "domain": domain,
            "service": service
        ]

        var serviceData: [String: Any] = [:]
        if let entityId = entityId {
            serviceData["entity_id"] = entityId
        }
        if let data = data {
            for (key, value) in data {
                serviceData[key] = value.value
            }
        }

        if !serviceData.isEmpty {
            message["service_data"] = serviceData
        }

        sendMessage(message)
    }

    private func authenticate(token: String) {
        // HA sends auth_required first, then we respond
        // This is handled in receiveMessages
    }

    private func sendMessage(_ message: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: message),
              let string = String(data: data, encoding: .utf8) else { return }

        webSocket?.send(.string(string)) { error in
            if let error = error {
                print("WebSocket send error: \(error)")
            }
        }
    }

    private func receiveMessages() {
        webSocket?.receive { [weak self] result in
            switch result {
            case .success(let message):
                self?.handleMessage(message)
                self?.receiveMessages()  // Continue receiving
            case .failure(let error):
                print("WebSocket receive error: \(error)")
            }
        }
    }

    private func handleMessage(_ message: URLSessionWebSocketTask.Message) {
        guard case .string(let text) = message,
              let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }

        let type = json["type"] as? String

        switch type {
        case "auth_required":
            // Send auth
            sendMessage([
                "type": "auth",
                "access_token": UserDefaults.standard.homeAssistantConfig?.accessToken ?? ""
            ])

        case "auth_ok":
            print("Home Assistant authenticated")
            NotificationCenter.default.post(name: .homeAssistantConnected, object: nil)

        case "event":
            if let event = json["event"] as? [String: Any],
               let eventData = event["data"] as? [String: Any],
               let newState = eventData["new_state"] as? [String: Any],
               let entityId = newState["entity_id"] as? String {

                let state = EntityState(
                    entityId: entityId,
                    state: newState["state"] as? String ?? "unknown",
                    attributes: (newState["attributes"] as? [String: Any])?.mapValues { AnyCodable($0) } ?? [:],
                    lastChanged: ISO8601DateFormatter().date(from: newState["last_changed"] as? String ?? "") ?? Date()
                )

                entityStates[entityId] = state
                subscriptions[entityId]?.forEach { $0(state) }
            }

        default:
            break
        }
    }
}

extension Notification.Name {
    static let homeAssistantConnected = Notification.Name("homeAssistantConnected")
    static let homeAssistantDisconnected = Notification.Name("homeAssistantDisconnected")
}
```

---

## Web Layer (TypeScript/HTML)

### Native Bridge (JS Side)

```typescript
// bridge/NativeBridge.ts

type MessageHandler = (message: NativeToWebMessage) => void;

class NativeBridge {
    private handlers: Map<string, Set<MessageHandler>> = new Map();
    private pendingCallbacks: Map<string, (result: any) => void> = new Map();

    constructor() {
        // Register global receiver for native messages
        (window as any).__nativeBridge__ = {
            receive: this.handleNativeMessage.bind(this),
        };
    }

    // Send message to native
    send(message: WebToNativeMessage): void {
        if (this.isNativeAvailable()) {
            const json = JSON.stringify(message);
            (window as any).webkit.messageHandlers.native.postMessage(json);
        } else {
            // Dev mode: use mock
            MockBridge.handle(message, this);
        }
    }

    // Subscribe to native messages
    on<T extends NativeToWebMessage['type']>(
        type: T,
        handler: (message: Extract<NativeToWebMessage, { type: T }>) => void,
    ): () => void {
        if (!this.handlers.has(type)) {
            this.handlers.set(type, new Set());
        }
        this.handlers.get(type)!.add(handler as MessageHandler);

        // Return unsubscribe function
        return () => {
            this.handlers.get(type)?.delete(handler as MessageHandler);
        };
    }

    // Handle incoming native message
    private handleNativeMessage(message: NativeToWebMessage): void {
        const handlers = this.handlers.get(message.type);
        handlers?.forEach((handler) => handler(message));
    }

    private isNativeAvailable(): boolean {
        return !!(window as any).webkit?.messageHandlers?.native;
    }
}

// Singleton instance
export const bridge = new NativeBridge();

// Typed helper functions
export const native = {
    // Audio
    startRecording: (widgetId: string, options?: RecordingOptions) => {
        bridge.send({ type: 'startRecording', payload: { widgetId, options } });
    },
    stopRecording: (widgetId: string) => {
        bridge.send({ type: 'stopRecording', widgetId });
    },

    // Home Assistant
    subscribeEntity: (entityId: string, widgetId: string) => {
        bridge.send({ type: 'subscribeEntity', entityId, widgetId });
    },
    unsubscribeEntity: (entityId: string, widgetId: string) => {
        bridge.send({ type: 'unsubscribeEntity', entityId, widgetId });
    },
    callService: (
        domain: string,
        service: string,
        entityId?: string,
        data?: Record<string, any>,
    ) => {
        bridge.send({ type: 'callService', payload: { domain, service, entityId, data } });
    },

    // Documents
    saveDocument: (doc: SaveDocumentPayload) => {
        bridge.send({ type: 'saveDocument', payload: doc });
    },
    loadDocument: (documentId: string) => {
        bridge.send({ type: 'loadDocument', documentId });
    },

    // AI
    requestSummary: (widgetId: string, context: string[], prompt?: string) => {
        bridge.send({ type: 'requestAISummary', payload: { widgetId, context, prompt } });
    },
};
```

### Mock Bridge (for browser development)

```typescript
// bridge/mock.ts

export class MockBridge {
    static handle(message: WebToNativeMessage, bridge: NativeBridge): void {
        console.log('[MockBridge] Received:', message);

        switch (message.type) {
            case 'startRecording':
                setTimeout(() => {
                    bridge.handleNativeMessage({
                        type: 'recordingStarted',
                        widgetId: message.payload.widgetId,
                    });

                    // Simulate audio levels
                    const levelInterval = setInterval(() => {
                        bridge.handleNativeMessage({
                            type: 'audioLevel',
                            widgetId: message.payload.widgetId,
                            level: Math.random() * 0.8 + 0.1,
                        });
                    }, 100);

                    (window as any).__mockRecordingInterval = levelInterval;
                }, 100);
                break;

            case 'stopRecording':
                clearInterval((window as any).__mockRecordingInterval);
                setTimeout(() => {
                    bridge.handleNativeMessage({
                        type: 'recordingStopped',
                        widgetId: message.widgetId,
                        audioPath: '/mock/recording.m4a',
                        duration: 30.5,
                    });

                    // Simulate transcription
                    setTimeout(() => {
                        bridge.handleNativeMessage({
                            type: 'transcriptionComplete',
                            widgetId: message.widgetId,
                            text: 'This is a mock transcription of the recorded audio. In production, this would be the actual transcribed text from Whisper.',
                        });
                    }, 1000);
                }, 100);
                break;

            case 'subscribeEntity':
                // Simulate Home Assistant entity
                const mockState = {
                    entityId: message.entityId,
                    state: message.entityId.includes('light') ? 'on' : '72',
                    attributes: {
                        friendly_name: message.entityId.split('.')[1].replace(/_/g, ' '),
                        unit_of_measurement: message.entityId.includes('temp') ? '°F' : undefined,
                    },
                    lastChanged: new Date().toISOString(),
                };

                setTimeout(() => {
                    bridge.handleNativeMessage({
                        type: 'entityStateChanged',
                        entityId: message.entityId,
                        state: mockState,
                    });
                }, 100);
                break;

            case 'requestAISummary':
                setTimeout(() => {
                    const mockSummary = `Based on the provided context, here is a summary:

The candidate demonstrated strong communication skills and provided thoughtful answers to the behavioral questions. Key strengths include problem-solving ability and team collaboration. Areas for follow-up include technical depth in distributed systems.`;

                    bridge.handleNativeMessage({
                        type: 'aiSummaryComplete',
                        widgetId: message.payload.widgetId,
                        text: mockSummary,
                    });
                }, 1500);
                break;
        }
    }
}
```

### Widget Base Class

```typescript
// widgets/base/BaseWidget.ts

import { bridge, native } from '../bridge/NativeBridge';

export interface WidgetConfig {
    id: string;
    type: string;
    props: Record<string, any>;
}

export interface DocumentContext {
    documentId: string;
    title: string;
    inferredType: string;
    sections: Section[];
    getContent: (sectionId?: string) => string;
}

export abstract class BaseWidget {
    protected id: string;
    protected config: WidgetConfig;
    protected context: DocumentContext;
    protected subscriptions: (() => void)[] = [];

    constructor(config: WidgetConfig, context: DocumentContext) {
        this.id = config.id;
        this.config = config;
        this.context = context;
    }

    // Lifecycle methods
    abstract render(): React.ReactNode;

    onMount(): void {
        // Override in subclasses
    }

    onUnmount(): void {
        // Cleanup subscriptions
        this.subscriptions.forEach((unsub) => unsub());
        this.subscriptions = [];
    }

    onContextChange(newContext: DocumentContext): void {
        this.context = newContext;
    }

    // Helper methods
    protected subscribeToNative<T extends NativeToWebMessage['type']>(
        type: T,
        handler: (msg: Extract<NativeToWebMessage, { type: T }>) => void,
    ): void {
        const unsub = bridge.on(type, handler);
        this.subscriptions.push(unsub);
    }

    protected emitEvent(eventType: string, payload: any): void {
        // Emit to document event bus
        window.dispatchEvent(
            new CustomEvent('widget:event', {
                detail: { widgetId: this.id, eventType, payload },
            }),
        );
    }

    protected writeToDocument(location: string, content: string): void {
        window.dispatchEvent(
            new CustomEvent('widget:write', {
                detail: { widgetId: this.id, location, content },
            }),
        );
    }

    // Get output value (for other widgets to consume)
    abstract getOutput(): Record<string, any>;
}
```

### Audio Recorder Widget

```typescript
// widgets/builtin/AudioRecorderWidget.tsx

import React, { useState, useEffect, useCallback } from 'react';
import { BaseWidget, WidgetConfig, DocumentContext } from '../base/BaseWidget';
import { bridge, native } from '../../bridge/NativeBridge';

interface AudioRecorderState {
  status: 'idle' | 'recording' | 'paused' | 'processing';
  duration: number;
  audioLevel: number;
  transcript: string;
  audioPath: string | null;
}

export class AudioRecorderWidget extends BaseWidget {
  private state: AudioRecorderState = {
    status: 'idle',
    duration: 0,
    audioLevel: 0,
    transcript: '',
    audioPath: null
  };

  private durationInterval: number | null = null;
  private updateCallback: ((state: AudioRecorderState) => void) | null = null;

  onMount(): void {
    // Subscribe to native audio events
    this.subscribeToNative('recordingStarted', (msg) => {
      if (msg.widgetId === this.id) {
        this.setState({ status: 'recording' });
        this.startDurationTimer();
      }
    });

    this.subscribeToNative('recordingStopped', (msg) => {
      if (msg.widgetId === this.id) {
        this.stopDurationTimer();
        this.setState({
          status: 'processing',
          audioPath: msg.audioPath,
          duration: msg.duration
        });
      }
    });

    this.subscribeToNative('audioLevel', (msg) => {
      if (msg.widgetId === this.id) {
        this.setState({ audioLevel: msg.level });
      }
    });

    this.subscribeToNative('transcriptionProgress', (msg) => {
      if (msg.widgetId === this.id) {
        this.setState({ transcript: msg.text });
      }
    });

    this.subscribeToNative('transcriptionComplete', (msg) => {
      if (msg.widgetId === this.id) {
        this.setState({
          status: 'idle',
          transcript: msg.text
        });

        // Write transcript to document if configured
        if (this.config.props.writeTranscriptTo) {
          this.writeToDocument(this.config.props.writeTranscriptTo, msg.text);
        }

        // Emit completion event
        this.emitEvent('transcriptionComplete', { transcript: msg.text });
      }
    });
  }

  onUnmount(): void {
    super.onUnmount();
    this.stopDurationTimer();
  }

  private setState(partial: Partial<AudioRecorderState>): void {
    this.state = { ...this.state, ...partial };
    this.updateCallback?.(this.state);
  }

  private startDurationTimer(): void {
    const startTime = Date.now();
    this.durationInterval = window.setInterval(() => {
      this.setState({ duration: (Date.now() - startTime) / 1000 });
    }, 100);
  }

  private stopDurationTimer(): void {
    if (this.durationInterval) {
      clearInterval(this.durationInterval);
      this.durationInterval = null;
    }
  }

  startRecording = (): void => {
    native.startRecording(this.id, {
      transcribeRealtime: this.config.props.realtimeTranscription ?? false,
      language: this.config.props.language
    });
  };

  stopRecording = (): void => {
    native.stopRecording(this.id);
  };

  getOutput(): Record<string, any> {
    return {
      transcript: this.state.transcript,
      audioPath: this.state.audioPath,
      duration: this.state.duration
    };
  }

  render(): React.ReactNode {
    return (
      <AudioRecorderUI
        state={this.state}
        onStart={this.startRecording}
        onStop={this.stopRecording}
        onStateChange={(cb) => { this.updateCallback = cb; }}
      />
    );
  }
}

// React UI Component
interface AudioRecorderUIProps {
  state: AudioRecorderState;
  onStart: () => void;
  onStop: () => void;
  onStateChange: (cb: (state: AudioRecorderState) => void) => void;
}

const AudioRecorderUI: React.FC<AudioRecorderUIProps> = ({
  state: initialState,
  onStart,
  onStop,
  onStateChange
}) => {
  const [state, setState] = useState(initialState);

  useEffect(() => {
    onStateChange(setState);
  }, [onStateChange]);

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="audio-recorder-widget">
      <div className="recorder-controls">
        {state.status === 'idle' && (
          <button onClick={onStart} className="record-button">
            <span className="record-icon">●</span>
            Start Recording
          </button>
        )}

        {state.status === 'recording' && (
          <>
            <button onClick={onStop} className="stop-button">
              <span className="stop-icon">■</span>
              Stop
            </button>
            <div className="duration">{formatDuration(state.duration)}</div>
            <div className="audio-level">
              <div
                className="level-bar"
                style={{ width: `${state.audioLevel * 100}%` }}
              />
            </div>
          </>
        )}

        {state.status === 'processing' && (
          <div className="processing">
            <span className="spinner" />
            Transcribing...
          </div>
        )}
      </div>

      {state.transcript && (
        <div className="transcript-preview">
          <strong>Transcript:</strong>
          <p>{state.transcript.slice(0, 200)}...</p>
        </div>
      )}
    </div>
  );
};
```

### Dropdown Widget (for interview scoring)

```typescript
// widgets/builtin/DropdownWidget.tsx

import React, { useState } from 'react';
import { BaseWidget, WidgetConfig, DocumentContext } from '../base/BaseWidget';

interface DropdownWidgetProps {
  options: string[];
  label?: string;
  defaultValue?: string;
  onChange?: {
    action: 'aiSummarize' | 'writeToSection' | 'emit';
    target?: string;
    context?: string[];
  };
}

export class DropdownWidget extends BaseWidget {
  private selectedValue: string | null = null;

  getOutput(): Record<string, any> {
    return {
      selected: this.selectedValue
    };
  }

  handleChange = (value: string): void => {
    this.selectedValue = value;
    this.emitEvent('valueChanged', { value });

    const onChange = this.config.props.onChange as DropdownWidgetProps['onChange'];
    if (onChange) {
      switch (onChange.action) {
        case 'aiSummarize':
          // Gather context from document and request AI summary
          const contextParts = (onChange.context || []).map(ref => {
            if (ref === 'this_section') {
              // Get current section content
              return this.context.getContent(this.getSectionId());
            }
            return this.context.getContent(ref);
          });

          // Add the selection itself as context
          contextParts.push(`Rating: ${value}`);

          native.requestSummary(
            this.id,
            contextParts,
            `Based on the interview transcript and a rating of "${value}", provide a brief assessment.`
          );
          break;

        case 'writeToSection':
          if (onChange.target) {
            this.writeToDocument(onChange.target, value);
          }
          break;

        case 'emit':
          // Just emit, already done above
          break;
      }
    }
  };

  private getSectionId(): string {
    // Determine which section this widget is in
    // This would be set by the editor when the widget is placed
    return this.config.props._sectionId || 'unknown';
  }

  render(): React.ReactNode {
    const props = this.config.props as DropdownWidgetProps;

    return (
      <DropdownUI
        options={props.options}
        label={props.label}
        defaultValue={props.defaultValue}
        onChange={this.handleChange}
      />
    );
  }
}

interface DropdownUIProps {
  options: string[];
  label?: string;
  defaultValue?: string;
  onChange: (value: string) => void;
}

const DropdownUI: React.FC<DropdownUIProps> = ({
  options,
  label,
  defaultValue,
  onChange
}) => {
  const [selected, setSelected] = useState(defaultValue || '');

  const handleSelect = (value: string) => {
    setSelected(value);
    onChange(value);
  };

  return (
    <div className="dropdown-widget">
      {label && <label>{label}</label>}
      <div className="options">
        {options.map(option => (
          <button
            key={option}
            className={`option ${selected === option ? 'selected' : ''}`}
            onClick={() => handleSelect(option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
};
```

### Home Assistant Widget

```typescript
// widgets/builtin/HomeAssistantWidget.tsx

import React, { useState, useEffect } from 'react';
import { BaseWidget, WidgetConfig, DocumentContext } from '../base/BaseWidget';
import { bridge, native } from '../../bridge/NativeBridge';

interface HAWidgetProps {
  entityId: string;
  displayType: 'state' | 'toggle' | 'slider' | 'button';
  name?: string;
  icon?: string;
}

interface EntityState {
  entityId: string;
  state: string;
  attributes: Record<string, any>;
  lastChanged: string;
}

export class HomeAssistantWidget extends BaseWidget {
  private entityState: EntityState | null = null;

  onMount(): void {
    const props = this.config.props as HAWidgetProps;

    // Subscribe to entity state changes
    this.subscribeToNative('entityStateChanged', (msg) => {
      if (msg.entityId === props.entityId) {
        this.entityState = msg.state;
        this.emitEvent('stateChanged', msg.state);
      }
    });

    // Request initial subscription
    native.subscribeEntity(props.entityId, this.id);
  }

  onUnmount(): void {
    super.onUnmount();
    const props = this.config.props as HAWidgetProps;
    native.unsubscribeEntity(props.entityId, this.id);
  }

  handleToggle = (): void => {
    const props = this.config.props as HAWidgetProps;
    const domain = props.entityId.split('.')[0];
    const service = this.entityState?.state === 'on' ? 'turn_off' : 'turn_on';
    native.callService(domain, service, props.entityId);
  };

  handleSliderChange = (value: number): void => {
    const props = this.config.props as HAWidgetProps;
    const domain = props.entityId.split('.')[0];

    if (domain === 'light') {
      native.callService('light', 'turn_on', props.entityId, {
        brightness_pct: value
      });
    } else if (domain === 'cover') {
      native.callService('cover', 'set_cover_position', props.entityId, {
        position: value
      });
    }
  };

  getOutput(): Record<string, any> {
    return {
      state: this.entityState?.state,
      attributes: this.entityState?.attributes
    };
  }

  render(): React.ReactNode {
    const props = this.config.props as HAWidgetProps;

    return (
      <HomeAssistantUI
        entityId={props.entityId}
        displayType={props.displayType}
        name={props.name}
        icon={props.icon}
        state={this.entityState}
        onToggle={this.handleToggle}
        onSliderChange={this.handleSliderChange}
      />
    );
  }
}

interface HomeAssistantUIProps {
  entityId: string;
  displayType: 'state' | 'toggle' | 'slider' | 'button';
  name?: string;
  icon?: string;
  state: EntityState | null;
  onToggle: () => void;
  onSliderChange: (value: number) => void;
}

const HomeAssistantUI: React.FC<HomeAssistantUIProps> = ({
  entityId,
  displayType,
  name,
  icon,
  state,
  onToggle,
  onSliderChange
}) => {
  const [currentState, setCurrentState] = useState(state);

  useEffect(() => {
    setCurrentState(state);
  }, [state]);

  const displayName = name || currentState?.attributes?.friendly_name || entityId;
  const stateValue = currentState?.state || 'unknown';
  const unit = currentState?.attributes?.unit_of_measurement || '';

  return (
    <div className={`ha-widget ha-widget--${displayType}`}>
      {icon && <span className="ha-icon">{icon}</span>}
      <span className="ha-name">{displayName}</span>

      {displayType === 'state' && (
        <span className="ha-state">
          {stateValue}{unit && ` ${unit}`}
        </span>
      )}

      {displayType === 'toggle' && (
        <button
          className={`ha-toggle ${stateValue === 'on' ? 'on' : 'off'}`}
          onClick={onToggle}
        >
          {stateValue === 'on' ? 'ON' : 'OFF'}
        </button>
      )}

      {displayType === 'slider' && (
        <input
          type="range"
          min="0"
          max="100"
          value={currentState?.attributes?.brightness_pct || 0}
          onChange={(e) => onSliderChange(parseInt(e.target.value))}
          className="ha-slider"
        />
      )}

      {displayType === 'button' && (
        <button className="ha-button" onClick={onToggle}>
          {currentState?.attributes?.friendly_name || 'Activate'}
        </button>
      )}
    </div>
  );
};
```

---

## Data Model & Storage

### SQLite Schema

```sql
-- Documents table
CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,  -- JSON: BlockNote editor state
    widget_states TEXT,     -- JSON: { widgetId: state }
    parent_id TEXT REFERENCES documents(id),
    workspace_id TEXT REFERENCES workspaces(id),
    template_id TEXT,
    inferred_type TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE INDEX idx_documents_parent ON documents(parent_id);
CREATE INDEX idx_documents_workspace ON documents(workspace_id);
CREATE INDEX idx_documents_updated ON documents(updated_at DESC);

-- Workspaces table
CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT,
    color TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Templates table
CREATE TABLE templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    trigger_pattern TEXT,  -- Regex for title matching
    trigger_parent TEXT,   -- Parent folder path
    content TEXT NOT NULL, -- JSON: template definition
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Media/Assets table
CREATE TABLE media (
    id TEXT PRIMARY KEY,
    document_id TEXT REFERENCES documents(id),
    widget_id TEXT,
    type TEXT NOT NULL,    -- audio, image, file
    filename TEXT NOT NULL,
    path TEXT NOT NULL,    -- Local file path
    size INTEGER,
    duration REAL,         -- For audio/video
    metadata TEXT,         -- JSON: additional metadata
    created_at TEXT NOT NULL
);

CREATE INDEX idx_media_document ON media(document_id);

-- Settings table
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

### Swift Data Models

```swift
// Models/Document.swift
import Foundation
import GRDB

struct Document: Codable, FetchableRecord, PersistableRecord {
    var id: String
    var title: String
    var content: String  // JSON
    var widgetStates: String?  // JSON
    var parentId: String?
    var workspaceId: String?
    var templateId: String?
    var inferredType: String?
    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?

    static let databaseTableName = "documents"

    // Computed property for parsed content
    var editorContent: EditorContent? {
        guard let data = content.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(EditorContent.self, from: data)
    }
}

struct EditorContent: Codable {
    let blocks: [Block]
    let version: Int
}

struct Block: Codable {
    let id: String
    let type: String
    let props: [String: AnyCodable]
    let content: [InlineContent]?
    let children: [Block]?
}
```

---

## Build & Development

### Development Workflow

```bash
# Terminal 1: Run Vite dev server for web app
cd WebApp
npm run dev  # Runs on http://localhost:5173

# Terminal 2: Run Swift app in Xcode
# Xcode will connect to dev server for hot reload
open LivingDocuments.xcodeproj
# Cmd+R to run
```

### Build Scripts

```bash
#!/bin/bash
# Scripts/build-web.sh

cd WebApp
npm run build

# Copy to Swift bundle location
rm -rf ../LivingDocuments/Resources/WebApp
cp -r dist ../LivingDocuments/Resources/WebApp
```

```bash
#!/bin/bash
# Scripts/bundle-whisper.sh

# Download Whisper model
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
MODEL_DIR="../LivingDocuments/Resources/Whisper"

mkdir -p "$MODEL_DIR"
curl -L "$MODEL_URL" -o "$MODEL_DIR/ggml-base.en.bin"
```

### Xcode Build Phases

1. **Pre-build**: Run `Scripts/build-web.sh` (Release only)
2. **Copy Files**: Bundle WebApp and Whisper model
3. **Code Sign**: Sign with Developer ID for distribution

### Package.json (WebApp)

```json
{
    "name": "living-documents-web",
    "version": "0.1.0",
    "scripts": {
        "dev": "vite",
        "build": "tsc && vite build",
        "preview": "vite preview",
        "typecheck": "tsc --noEmit"
    },
    "dependencies": {
        "@blocknote/core": "^0.12.0",
        "@blocknote/react": "^0.12.0",
        "react": "^18.2.0",
        "react-dom": "^18.2.0",
        "zustand": "^4.4.0",
        "immer": "^10.0.0"
    },
    "devDependencies": {
        "@types/react": "^18.2.0",
        "@types/react-dom": "^18.2.0",
        "@vitejs/plugin-react": "^4.2.0",
        "typescript": "^5.3.0",
        "vite": "^5.0.0"
    }
}
```

---

## Security Considerations

### WebView Sandboxing

```swift
// WebViewController.swift - Security configuration

private func configureSecurityPolicy(_ config: WKWebViewConfiguration) {
    // Disable JavaScript ability to open windows
    config.preferences.javaScriptCanOpenWindowsAutomatically = false

    // Only allow loading from our bundle or dev server
    #if DEBUG
    let allowedOrigins = ["http://localhost:5173", "file://"]
    #else
    let allowedOrigins = ["file://"]
    #endif

    // Content Security Policy via WKContentRuleList
    let rules = """
    [{
        "trigger": { "url-filter": ".*" },
        "action": { "type": "block" }
    },
    {
        "trigger": { "url-filter": "^file://.*" },
        "action": { "type": "ignore-previous-rules" }
    }]
    """

    WKContentRuleListStore.default().compileContentRuleList(
        forIdentifier: "SecurityRules",
        encodedContentRuleList: rules
    ) { list, error in
        if let list = list {
            config.userContentController.add(list)
        }
    }
}
```

### Native Bridge Security

```swift
// Validate all incoming messages
func userContentController(_ controller: WKUserContentController,
                           didReceive message: WKScriptMessage) {
    // Only accept messages from our known message handler
    guard message.name == "native" else {
        print("Rejected message from unknown handler: \(message.name)")
        return
    }

    // Validate message structure
    guard let body = message.body as? String,
          body.count < 1_000_000 else {  // 1MB limit
        print("Rejected oversized message")
        return
    }

    // ... process message
}
```

### File System Access

```swift
// FileSystemService.swift - Restrict to app sandbox

func saveDocument(_ payload: SaveDocumentPayload) throws -> String {
    let documentsDir = FileManager.default.urls(
        for: .documentDirectory,
        in: .userDomainMask
    )[0].appendingPathComponent("LivingDocuments")

    // Validate path stays within sandbox
    let targetPath = documentsDir.appendingPathComponent(payload.documentId ?? UUID().uuidString)

    guard targetPath.path.hasPrefix(documentsDir.path) else {
        throw FileError.pathTraversal
    }

    // ... save file
}
```

---

## Performance Considerations

### WebView Optimization

1. **Lazy widget loading**: Only instantiate visible widgets
2. **Debounced saves**: Batch document saves (500ms debounce)
3. **Virtual scrolling**: For long documents with many widgets
4. **Web Worker transcription**: Offload heavy processing

### Native Optimization

1. **Audio buffer pooling**: Reuse AVAudioPCMBuffer instances
2. **Background transcription**: Use GCD for Whisper processing
3. **Database batching**: Use GRDB transactions for bulk operations
4. **Entity state caching**: Don't re-fetch unchanged HA states

---

## Future Considerations

### Sync (Phase 2+)

- CloudKit for Apple ecosystem sync
- CRDT-based conflict resolution (Yjs)
- Selective sync for large media files

### Mobile (Phase 3+)

- iOS app with same WebView architecture
- Shared Swift core via framework
- Reduced widget set for mobile

### Plugins (Phase 4+)

- Widget SDK for third-party widgets
- Sandboxed JavaScript widget runtime
- Widget marketplace/registry

---

_Last updated: November 2024_
