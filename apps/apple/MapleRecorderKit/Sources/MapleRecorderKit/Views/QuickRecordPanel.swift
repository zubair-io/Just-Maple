#if os(macOS)
import AppKit
import SwiftUI
import UserNotifications

// MARK: - Floating NSPanel

final class FloatingRecordPanel: NSPanel {
    var onResignKey: (() -> Void)?
    var onCancelOperation: (() -> Void)?

    init<Content: View>(content: @escaping () -> Content) {
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: 200, height: 200),
            styleMask: [.borderless, .nonactivatingPanel, .titled, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )

        isFloatingPanel = true
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle]
        titleVisibility = .hidden
        titlebarAppearsTransparent = true
        isMovableByWindowBackground = true
        hidesOnDeactivate = false
        animationBehavior = .utilityWindow
        backgroundColor = .clear
        isOpaque = false
        sharingType = .none

        for button in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
            standardWindowButton(button)?.isHidden = true
        }

        contentView = NSHostingView(rootView: content())
    }

    override func resignKey() {
        super.resignKey()
        onResignKey?()
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    override func cancelOperation(_ sender: Any?) {
        onCancelOperation?()
    }
}

// MARK: - Panel Controller

@Observable
@MainActor
final class QuickRecordController {
    private var panel: FloatingRecordPanel?
    var store: RecordingStore?
    var modelManager: ModelManager?
    var settingsManager: SettingsManager?
    var calendarManager: CalendarManager?

    var isDocked = false
    var includeSystemAudio = false
    var isOpen: Bool { panel != nil }

    /// Callback set by QuickRecordView so the controller can stop recording on dismiss.
    var stopRecordingHandler: (() -> Void)?


    private var globalMonitor: Any?
    private var localMonitor: Any?

    // MARK: - Global Hotkey

    func registerGlobalHotkey() {
        promptAccessibilityIfNeeded()

        // Catches ⌃. and ⌃/ when app is NOT focused (requires Accessibility permission)
        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard event.modifierFlags.contains(.control) else { return }
            if event.keyCode == 47 { // Period
                Task { @MainActor in self?.toggle() }
            } else if event.keyCode == 44 { // Slash
                Task { @MainActor in self?.toggleWithSystemAudio() }
            }
        }
        // Catches ⌃. and ⌃/ when app IS focused
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard event.modifierFlags.contains(.control) else { return event }
            if event.keyCode == 47 {
                Task { @MainActor in self?.toggle() }
                return nil
            } else if event.keyCode == 44 {
                Task { @MainActor in self?.toggleWithSystemAudio() }
                return nil
            }
            return event
        }
    }

    private func promptAccessibilityIfNeeded() {
        let trusted = AXIsProcessTrusted()
        if !trusted {
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue(): true] as CFDictionary
            AXIsProcessTrustedWithOptions(options)
        }
    }

    func unregisterGlobalHotkey() {
        if let globalMonitor { NSEvent.removeMonitor(globalMonitor) }
        if let localMonitor { NSEvent.removeMonitor(localMonitor) }
        globalMonitor = nil
        localMonitor = nil
    }

    // MARK: - State Transitions

    func toggle() {
        if panel != nil {
            dismiss()
        } else {
            includeSystemAudio = false
            open()
        }
    }

    func toggleWithSystemAudio() {
        if panel != nil {
            dismiss()
        } else {
            includeSystemAudio = true
            open()
        }
    }

    func open() {
        guard panel == nil else { return }
        guard let store, let modelManager, let settingsManager else { return }

        let controller = self
        let newPanel = FloatingRecordPanel {
            QuickRecordView(
                store: store,
                modelManager: modelManager,
                settingsManager: settingsManager,
                calendarManager: controller.calendarManager,
                controller: controller
            )
        }

        newPanel.onResignKey = { [weak self] in
            self?.dock()
        }
        newPanel.onCancelOperation = { [weak self] in
            self?.dismiss()
        }

        // Center 200×200 on screen
        if let screen = NSScreen.main {
            let screenFrame = screen.visibleFrame
            let size: CGFloat = 200
            let x = screenFrame.midX - size / 2
            let y = screenFrame.midY - size / 2
            newPanel.setFrame(NSRect(x: x, y: y, width: size, height: size), display: true)
        }

        newPanel.alphaValue = 0
        newPanel.makeKeyAndOrderFront(nil)
        newPanel.orderFrontRegardless()

        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.2
            newPanel.animator().alphaValue = 1
        }

        isDocked = false
        self.panel = newPanel
    }

    func dock() {
        guard let panel, !isDocked else { return }
        isDocked = true

        guard let screen = NSScreen.main else { return }
        let screenFrame = screen.visibleFrame
        let pillWidth: CGFloat = 40
        let pillHeight: CGFloat = 120
        let margin: CGFloat = 16
        let targetRect = NSRect(
            x: screenFrame.maxX - pillWidth - margin,
            y: screenFrame.midY - pillHeight / 2,
            width: pillWidth,
            height: pillHeight
        )

        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.4
            ctx.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            panel.animator().setFrame(targetRect, display: true)
        }
    }

    func undock() {
        guard let panel, isDocked else { return }
        isDocked = false

        guard let screen = NSScreen.main else { return }
        let screenFrame = screen.visibleFrame
        let size: CGFloat = 200
        let targetRect = NSRect(
            x: screenFrame.midX - size / 2,
            y: screenFrame.midY - size / 2,
            width: size,
            height: size
        )

        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.4
            ctx.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            panel.animator().setFrame(targetRect, display: true)
        }

        panel.makeKeyAndOrderFront(nil)
    }

    func dismiss() {
        stopRecordingHandler?()
        guard let panel else { return }

        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.2
            panel.animator().alphaValue = 0
        }, completionHandler: {
            Task { @MainActor [weak self] in
                panel.close()
                self?.panel = nil
                self?.isDocked = false
                self?.stopRecordingHandler = nil
            }
        })
    }

    // MARK: - Notification

    func postSavedNotification(duration: TimeInterval) {
        let content = UNMutableNotificationContent()
        content.title = "Recording saved"
        content.body = "Duration: \(Self.formatted(duration)). Transcribing\u{2026}"
        content.sound = nil
        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request)
    }

    func requestNotificationPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert]) { _, _ in }
    }

    private static func formatted(_ duration: TimeInterval) -> String {
        let minutes = Int(duration) / 60
        let seconds = Int(duration) % 60
        if minutes > 0 {
            return "\(minutes)m \(seconds)s"
        }
        return "\(seconds)s"
    }
}

// MARK: - Quick Record SwiftUI View

struct QuickRecordView: View {
    @Bindable var store: RecordingStore
    var modelManager: ModelManager
    var settingsManager: SettingsManager
    var calendarManager: CalendarManager?
    var controller: QuickRecordController

    @State private var recorder = AudioRecorder()
    @State private var recordingURL: URL?

    var body: some View {
        Group {
            if controller.isDocked {
                dockedView
            } else {
                centeredView
            }
        }
        .onAppear {
            controller.stopRecordingHandler = { [self] in
                if recorder.isRecording {
                    saveAndNotify()
                }
            }
            startRecording()
        }


    }

    // MARK: - Centered State (200×200)

    private var centeredView: some View {
        VStack(spacing: 8) {
            Text(formatTime(recorder.elapsedTime))
                .font(.system(.title3, design: .monospaced))
                .foregroundStyle(MapleTheme.textPrimary)

            ZStack {
                PulsingWaveform(audioLevel: recorder.audioLevel)

                Button {
                    saveAndNotify()
                    controller.dismiss()
                } label: {
                    Image(systemName: "stop.fill")
                        .font(.title2)
                        .foregroundStyle(.white)
                        .frame(width: 64, height: 64)
                        .background(MapleTheme.error, in: .circle)
                        .shadow(color: MapleTheme.error.opacity(0.3), radius: 8, y: 4)
                }
                .buttonStyle(.plain)
            }
            .frame(width: 160, height: 160)
        }
        .frame(width: 200, height: 200)
        .background(.ultraThinMaterial, in: .rect(cornerRadius: 20))
        .overlay(
            RoundedRectangle(cornerRadius: 20)
                .strokeBorder(MapleTheme.border.opacity(0.3), lineWidth: 0.5)
        )
    }

    // MARK: - Docked State (40×120 vertical pill)

    private var dockedView: some View {
        VStack(spacing: 6) {
            // Pulsing red dot
            Circle()
                .fill(.red)
                .frame(width: 8, height: 8)
                .opacity(recorder.isRecording ? 1 : 0.3)
                .animation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: recorder.isRecording)

            // Mini vertical waveform bars
            VStack(spacing: 1) {
                ForEach(Array(recorder.amplitudeSamples.suffix(4).enumerated()), id: \.offset) { _, sample in
                    RoundedRectangle(cornerRadius: 1)
                        .fill(MapleTheme.primary)
                        .frame(width: max(3, CGFloat(sample) * 16), height: 2)
                }
            }
            .frame(width: 16, alignment: .center)

            Text(formatTime(recorder.elapsedTime))
                .font(.system(.caption2, design: .monospaced, weight: .medium))
                .foregroundStyle(MapleTheme.textPrimary)
        }
        .padding(.vertical, 10)
        .frame(width: 40, height: 120)
        .background(.ultraThinMaterial, in: .capsule)
        .overlay(Capsule().strokeBorder(MapleTheme.border.opacity(0.3), lineWidth: 0.5))
        .onTapGesture {
            saveAndNotify()
            controller.dismiss()
        }
    }

    // MARK: - Recording

    private func startRecording() {
        recorder.includeSystemAudio = controller.includeSystemAudio
        recorder.settingsManager = settingsManager
        Task {
            do {
                recordingURL = try await recorder.startRecording()
            } catch {
                print("Quick record failed: \(error)")
                controller.dismiss()
            }
        }
    }

    private func saveAndNotify() {
        let duration = recorder.elapsedTime
        let result = recorder.stopRecording()
        guard !result.micURLs.isEmpty else { return }

        let now = Date()
        let title: String
        let calTitle = (settingsManager.calendarEnabled)
            ? calendarManager?.currentMeetingTitle(calendarIdentifiers: settingsManager.selectedCalendarIdentifiers)
            : nil
        switch settingsManager.calendarTitleMode {
        case .exactName where calTitle != nil:
            title = calTitle!
        case .hint where calTitle != nil:
            title = "\(calTitle!) — Recording"
        default:
            let formatter = DateFormatter()
            formatter.dateStyle = .medium
            formatter.timeStyle = .short
            title = "Recording \(formatter.string(from: now))"
        }

        var audioFileNames: [String] = []
        for url in result.micURLs {
            let fileName = url.lastPathComponent
            let destURL = StorageLocation.recordingsURL.appendingPathComponent(fileName)
            try? FileManager.default.copyItem(at: url, to: destURL)
            audioFileNames.append(fileName)
        }

        var systemAudioFileNames: [String] = []
        for url in result.systemURLs {
            let fileName = url.lastPathComponent
            let destURL = StorageLocation.recordingsURL.appendingPathComponent(fileName)
            try? FileManager.default.copyItem(at: url, to: destURL)
            systemAudioFileNames.append(fileName)
        }

        var recording = MapleRecording(
            id: recorder.recordingId ?? UUID(),
            title: title,
            audioFiles: audioFileNames,
            systemAudioFiles: systemAudioFileNames,
            duration: duration,
            createdAt: now,
            modifiedAt: now
        )
        recording.screenshots = persistScreenshots(result.screenshots)
        recording.userNotes = result.userNotes
        try? store.save(recording)

        // Trigger processing
        if modelManager.isReady {
            Task {
                let pipeline = modelManager.createPipeline()
                try? await store.processRecording(
                    recording,
                    pipeline: pipeline,
                    transcription: modelManager.transcriptionManager,
                    diarization: modelManager.diarizationManager,
                    summarizationProvider: settingsManager.preferredProvider
                )
            }
        }

        // Select recording in main UI and bring app to front
        store.pendingSelectionId = recording.id
        NSApplication.shared.activate()

        // Post system notification
        controller.postSavedNotification(duration: duration)
    }

    private func formatTime(_ time: TimeInterval) -> String {
        let minutes = Int(time) / 60
        let seconds = Int(time) % 60
        return String(format: "%02d:%02d", minutes, seconds)
    }

    private func persistScreenshots(_ captures: [CapturedTimelineScreenshot]) -> [TimelineScreenshot] {
        captures.compactMap { capture in
            let fileName = capture.sourceURL.lastPathComponent
            let destination = StorageLocation.recordingsURL.appendingPathComponent(fileName)
            do {
                try FileManager.default.copyItem(at: capture.sourceURL, to: destination)
                try? FileManager.default.removeItem(at: capture.sourceURL)
                return TimelineScreenshot(fileName: fileName, timestamp: capture.timestamp)
            } catch {
                print("Failed to save timeline screenshot: \(error.localizedDescription)")
                return nil
            }
        }
    }
}
#endif
