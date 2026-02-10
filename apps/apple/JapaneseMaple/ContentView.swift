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
