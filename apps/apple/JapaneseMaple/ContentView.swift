//
//  ContentView.swift
//  JapaneseMaple
//
//  Created by Zubair Lawrence on 11/30/25.
//

import SwiftUI
import Combine
import SwiftData
import UniformTypeIdentifiers

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var hasConfiguredServer = ServerConfigService.shared.hasConfiguredServer
    @State private var showServerSettings = false
    @StateObject private var webViewController = WebViewController()

    #if os(iOS)
    @State private var showFolderPicker = false
    #endif

    var body: some View {
        Group {
            if hasConfiguredServer {
                WebViewContainer(webViewController: webViewController)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .ignoresSafeArea(.container)
            } else {
                ServerSettingsView()
            }
        }
        .sheet(isPresented: $showServerSettings) { ServerSettingsView() }
        .onReceive(NotificationCenter.default.publisher(for: ServerConfigService.openSettings).receive(on: RunLoop.main)) { _ in
            showServerSettings = true
        }
        .onReceive(NotificationCenter.default.publisher(for: ServerConfigService.configurationDidChange).receive(on: RunLoop.main)) { _ in
            hasConfiguredServer = ServerConfigService.shared.hasConfiguredServer
            webViewController.reloadFromServer()
        }
        .onReceive(NotificationCenter.default.publisher(for: ServerConfigService.connectionDidChange).receive(on: RunLoop.main)) { _ in
            webViewController.refreshConnection()
        }
        .task(id: scenePhase) {
            // Path monitoring cannot detect a local server or Wi-Fi route going stale.
            // Probe only while active, without running a background polling loop.
            while scenePhase == .active && !Task.isCancelled {
                webViewController.refreshConnection(force: true)
                do { try await Task.sleep(for: .seconds(15)) } catch { return }
            }
        }
        #if os(iOS)
        .onReceive(NotificationCenter.default.publisher(for: NSNotification.Name("FolderPickerRequested"))) { _ in
            showFolderPicker = true
        }
        .fileImporter(
            isPresented: $showFolderPicker,
            allowedContentTypes: [.folder],
            allowsMultipleSelection: false
        ) { result in
            switch result {
            case .success(let urls):
                guard let url = urls.first else {
                    NotificationCenter.default.post(
                        name: NSNotification.Name("FolderPickerResult"),
                        object: nil,
                        userInfo: ["path": NSNull(), "name": NSNull()]
                    )
                    return
                }

                // Start accessing the security-scoped resource
                guard url.startAccessingSecurityScopedResource() else {
                    print("[ContentView] Failed to access security-scoped resource: \(url.path)")
                    NotificationCenter.default.post(
                        name: NSNotification.Name("FolderPickerResult"),
                        object: nil,
                        userInfo: ["path": NSNull(), "name": NSNull()]
                    )
                    return
                }

                // Note: stopAccessingSecurityScopedResource() is NOT called here —
                // the NativeBridge retains the URL in grantedFolderURLs and will
                // stop access when the folder is closed or the app terminates.
                NotificationCenter.default.post(
                    name: NSNotification.Name("FolderPickerResult"),
                    object: nil,
                    userInfo: [
                        "path": url.path,
                        "name": url.lastPathComponent,
                        "url": url,
                    ]
                )
            case .failure(let error):
                print("[ContentView] Folder picker error: \(error.localizedDescription)")
                NotificationCenter.default.post(
                    name: NSNotification.Name("FolderPickerResult"),
                    object: nil,
                    userInfo: ["path": NSNull(), "name": NSNull()]
                )
            }
        }
        #endif
    }
}

#Preview {
    ContentView()
}
