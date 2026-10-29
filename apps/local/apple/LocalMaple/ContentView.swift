import SwiftUI
import UniformTypeIdentifiers
import MapleRecorderKit

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var webViewController = WebViewController()
    @State private var workspace = Workspace.notes
    #if os(iOS)
    @State private var showFolderPicker = false
    #endif

    private enum Workspace: String, CaseIterable { case notes = "Notes", recorder = "Recorder" }

    var body: some View {
        VStack(spacing: 0) {
            Picker("Workspace", selection: $workspace) {
                ForEach(Workspace.allCases, id: \.self) { item in Text(item.rawValue).tag(item) }
            }
            .pickerStyle(.segmented)
            .padding(10)
            ZStack {
                // Keep both views mounted: switching workspaces preserves dirty edits and capture.
                WebViewContainer(webViewController: webViewController)
                    .opacity(workspace == .notes ? 1 : 0)
                    .allowsHitTesting(workspace == .notes)
                    .accessibilityHidden(workspace != .notes)
                MapleRecorderView(prepareModelsAutomatically: false, registerGlobalHotkeys: false)
                    .opacity(workspace == .recorder ? 1 : 0)
                    .allowsHitTesting(workspace == .recorder)
                    .accessibilityHidden(workspace != .recorder)
            }
        }
        .frame(minWidth: 360, minHeight: 480)
        .onChange(of: scenePhase) { _, phase in
            if phase != .active {
                Task { try? await webViewController.flushPendingSaves() }
            }
        }
        #if os(iOS)
        .onReceive(NotificationCenter.default.publisher(for: NSNotification.Name("FolderPickerRequested"))) { _ in
            showFolderPicker = true
        }
        .fileImporter(isPresented: $showFolderPicker, allowedContentTypes: [.folder]) { result in
            var info: [String: Any] = ["path": NSNull(), "name": NSNull()]
            if case .success(let url) = result, url.startAccessingSecurityScopedResource() {
                info = ["path": url.path, "name": url.lastPathComponent, "url": url]
            }
            NotificationCenter.default.post(name: NSNotification.Name("FolderPickerResult"), object: nil, userInfo: info)
        }
        #endif
    }
}
