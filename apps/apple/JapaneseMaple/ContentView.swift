//
//  ContentView.swift
//  JapaneseMaple
//
//  Created by Zubair Lawrence on 11/30/25.
//

import SwiftUI
import SwiftData
import UniformTypeIdentifiers

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var showServerSettings = false
    @StateObject private var webViewController = WebViewController()

    #if os(iOS)
    @State private var showFolderPicker = false
    #endif

    var body: some View {
        VStack(spacing: 0) {
            WebViewContainer(webViewController: webViewController)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .ignoresSafeArea(.container)
        .overlay(alignment: .topTrailing) {
            Button { showServerSettings = true } label: {
                Image(systemName: "server.rack").padding(10)
            }
            .buttonStyle(.bordered)
            .accessibilityLabel("Server settings")
            .padding(8)
        }
        .sheet(isPresented: $showServerSettings) { ServerSettingsView() }
        .onAppear {
            #if !DEBUG
            showServerSettings = !ServerConfigService.shared.hasConfiguredServer
                && ServerConfigService.shared.getToken() == nil
            #endif
        }
        .onReceive(NotificationCenter.default.publisher(for: ServerConfigService.openSettings)) { _ in
            showServerSettings = true
        }
        .onReceive(NotificationCenter.default.publisher(for: ServerConfigService.configurationDidChange)) { _ in
            webViewController.reloadFromServer()
        }
        .onReceive(NotificationCenter.default.publisher(for: ServerConfigService.connectionDidChange)) { _ in
            webViewController.refreshConnection()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { webViewController.refreshConnection() }
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
