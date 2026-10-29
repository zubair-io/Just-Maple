import SwiftUI

/// Native recording library and on-device post-processing embedded in Just Maple.
/// State is shared across app windows and survives switching back to the web app.
@MainActor
public struct MapleRecorderView: View {
    @State private var session = RecorderSession.shared

    private let prepareModelsAutomatically: Bool
    private let registerGlobalHotkeys: Bool
    public init(prepareModelsAutomatically: Bool = true, registerGlobalHotkeys: Bool = true) {
        self.prepareModelsAutomatically = prepareModelsAutomatically
        self.registerGlobalHotkeys = registerGlobalHotkeys
    }

    public var body: some View {
        Group {
            #if os(macOS)
            RecordingListView(
                store: session.store,
                modelManager: session.models,
                settingsManager: session.settings,
                promptStore: session.prompts,
                autoProcessor: session.processor,
                calendarManager: session.calendar,
                miniRecordingController: session.miniRecorder
            )
            #else
            RecordingListView(
                store: session.store,
                modelManager: session.models,
                settingsManager: session.settings,
                promptStore: session.prompts,
                autoProcessor: session.processor,
                calendarManager: session.calendar
            )
            #endif
        }
        .task { await session.start(prepareModelsAutomatically: prepareModelsAutomatically, registerGlobalHotkeys: registerGlobalHotkeys) }
    }
}

@MainActor
@Observable
final class RecorderSession {
    static let shared = RecorderSession()
    let store: RecordingStore
    init(store: RecordingStore = RecordingStore()) { self.store = store }
    let models = ModelManager()
    let settings = SettingsManager()
    let prompts = PromptStore()
    let calendar = CalendarManager()
    private(set) var processor: AutoProcessor?
    private var syncMonitor: ICloudSyncMonitor?
    private var started = false
    #if os(macOS)
    let miniRecorder = MiniRecordingController()
    private let quickRecorder = QuickRecordController()
    #endif

    func connectLibrary() {
        guard syncMonitor == nil else { return }
        let monitor = ICloudSyncMonitor(store: store)
        monitor.startMonitoring()
        syncMonitor = monitor
    }

    func start(prepareModelsAutomatically: Bool = true, registerGlobalHotkeys: Bool = true) async {
        guard !started else { return }
        started = true
        connectLibrary()
        #if os(macOS)
        quickRecorder.store = store
        quickRecorder.modelManager = models
        quickRecorder.settingsManager = settings
        quickRecorder.calendarManager = calendar
        if registerGlobalHotkeys { quickRecorder.registerGlobalHotkey() }
        miniRecorder.startMonitoring()
        #endif
        if prepareModelsAutomatically { await models.ensureModelsReady() }
        let processor = AutoProcessor(store: store, modelManager: models, settingsManager: settings)
        self.processor = processor
        if prepareModelsAutomatically { processor.startWatching() }
    }
}
