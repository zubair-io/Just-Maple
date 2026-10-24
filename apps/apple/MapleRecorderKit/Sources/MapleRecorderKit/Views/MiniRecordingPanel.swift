#if os(macOS)
import AppKit
import SwiftUI

// MARK: - Mini Recording Controller

@Observable
@MainActor
final class MiniRecordingController {
    var recorder: AudioRecorder?
    var onStopRequested: (() -> Void)?

    private var panel: FloatingRecordPanel?
    private var resignObserver: Any?
    private var activeObserver: Any?

    func startMonitoring() {
        let center = NotificationCenter.default
        resignObserver = center.addObserver(
            forName: NSApplication.didResignActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.appDidResignActive()
            }
        }
        activeObserver = center.addObserver(
            forName: NSApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.appDidBecomeActive()
            }
        }
    }

    func stopMonitoring() {
        if let resignObserver { NotificationCenter.default.removeObserver(resignObserver) }
        if let activeObserver { NotificationCenter.default.removeObserver(activeObserver) }
        resignObserver = nil
        activeObserver = nil
        dismissPanel()
    }

    func dismissPanel() {
        guard let panel else { return }
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.2
            panel.animator().alphaValue = 0
        }, completionHandler: {
            Task { @MainActor [weak self] in
                panel.close()
                self?.panel = nil
            }
        })
    }

    func bringAppToFront() {
        NSApplication.shared.activate()
        dismissPanel()
    }

    // MARK: - Private

    private func appDidResignActive() {
        guard let recorder, recorder.isRecording else { return }
        guard panel == nil else { return }
        showPanel()
    }

    private func appDidBecomeActive() {
        dismissPanel()
    }

    private func showPanel() {
        guard let recorder else { return }
        let controller = self

        let newPanel = FloatingRecordPanel {
            MiniRecordingView(
                recorder: recorder,
                onStop: { controller.onStopRequested?() },
                onTap: { controller.bringAppToFront() }
            )
        }

        // Don't steal focus, don't close when another app is active
        newPanel.onResignKey = nil

        // Position: right edge of screen, vertically centered
        if let screen = NSScreen.main {
            let screenFrame = screen.visibleFrame
            let pillWidth: CGFloat = 40
            let pillHeight: CGFloat = 120
            let margin: CGFloat = 8
            let rect = NSRect(
                x: screenFrame.maxX - pillWidth - margin,
                y: screenFrame.midY - pillHeight / 2,
                width: pillWidth,
                height: pillHeight
            )
            newPanel.setFrame(rect, display: true)
        }

        newPanel.alphaValue = 0
        newPanel.orderFrontRegardless()

        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.2
            newPanel.animator().alphaValue = 1
        }

        self.panel = newPanel
    }
}

// MARK: - Mini Recording View

struct MiniRecordingView: View {
    var recorder: AudioRecorder
    var onStop: () -> Void
    var onTap: () -> Void

    @State private var pulsing = false

    var body: some View {
        VStack(spacing: 6) {
            // Pulsing red dot
            Circle()
                .fill(.red)
                .frame(width: 8, height: 8)
                .opacity(pulsing ? 0.3 : 1.0)
                .animation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: pulsing)
                .onAppear { pulsing = true }

            // Mini vertical waveform bars
            VStack(spacing: 1) {
                ForEach(Array(recorder.amplitudeSamples.suffix(4).enumerated()), id: \.offset) { _, sample in
                    RoundedRectangle(cornerRadius: 1)
                        .fill(MapleTheme.primary)
                        .frame(width: max(3, CGFloat(sample) * 16), height: 2)
                }
            }
            .frame(width: 16, alignment: .center)

            // Elapsed time
            Text(formatTime(recorder.elapsedTime))
                .font(.system(.caption2, design: .monospaced, weight: .medium))
                .foregroundStyle(MapleTheme.textPrimary)

            // Stop button
            Button {
                onStop()
            } label: {
                Image(systemName: "stop.fill")
                    .font(.system(size: 8))
                    .foregroundStyle(.white)
                    .frame(width: 16, height: 16)
                    .background(MapleTheme.error, in: .circle)
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 10)
        .frame(width: 40, height: 120)
        .background(.ultraThinMaterial, in: .capsule)
        .overlay(Capsule().strokeBorder(MapleTheme.border.opacity(0.3), lineWidth: 0.5))
        .contentShape(.capsule)
        .onTapGesture {
            onTap()
        }
    }

    private func formatTime(_ time: TimeInterval) -> String {
        let minutes = Int(time) / 60
        let seconds = Int(time) % 60
        return String(format: "%02d:%02d", minutes, seconds)
    }
}
#endif
