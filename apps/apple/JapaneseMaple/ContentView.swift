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
    @StateObject private var sidebarVM = SidebarViewModel()

    #if os(iOS)
    @State private var showFolderPicker = false
    #endif

    var body: some View {
        #if os(macOS)
        macOSLayout
        #else
        iOSLayout
        #endif
    }

    // MARK: - macOS: NavigationSplitView

    #if os(macOS)
    private var macOSLayout: some View {
        NavigationSplitView {
            NativeSidebarView(viewModel: sidebarVM)
        } detail: {
            WebViewContainer(webViewController: webViewController)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .onAppear { wireBridge() }
    }
    #endif

    // MARK: - iOS: ZStack overlay sidebar

    #if os(iOS)
    private var iOSLayout: some View {
        ZStack(alignment: .leading) {
            // Web view (always full screen)
            WebViewContainer(webViewController: webViewController)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .ignoresSafeArea(.container)

            // Dimmed backdrop
            if sidebarVM.isSidebarVisible {
                Color.black.opacity(0.4)
                    .ignoresSafeArea()
                    .onTapGesture {
                        withAnimation(.easeInOut(duration: 0.25)) {
                            sidebarVM.isSidebarVisible = false
                        }
                    }
                    .transition(.opacity)
            }

            // Sidebar panel sliding from left
            if sidebarVM.isSidebarVisible {
                NavigationStack {
                    NativeSidebarView(viewModel: sidebarVM)
                }
                .frame(width: 300)
                .background(MapleTheme.sidebarBackground)
                .transition(.move(edge: .leading))
            }
        }
        .animation(.easeInOut(duration: 0.25), value: sidebarVM.isSidebarVisible)
        .onAppear { wireBridge() }
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

                guard url.startAccessingSecurityScopedResource() else {
                    print("[ContentView] Failed to access security-scoped resource: \(url.path)")
                    NotificationCenter.default.post(
                        name: NSNotification.Name("FolderPickerResult"),
                        object: nil,
                        userInfo: ["path": NSNull(), "name": NSNull()]
                    )
                    return
                }

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
    }
    #endif

    // MARK: - Bridge Wiring

    private func wireBridge() {
        sidebarVM.bridge = webViewController.bridge
        webViewController.bridge?.onSidebarMessage = { [weak sidebarVM] message in
            Task { @MainActor in
                sidebarVM?.handleSidebarMessage(message)
            }
        }
        webViewController.bridge?.onTokenSaved = { [weak sidebarVM] in
            Task { @MainActor in
                guard let vm = sidebarVM, vm.notebooks.isEmpty else { return }
                await vm.loadInitialData()
            }
        }
    }
}

// MARK: - Close sidebar on navigation

extension SidebarViewModel {
    func navigateAndCloseSidebar(notebookId: String, pageId: String? = nil) {
        navigateTo(notebookId: notebookId, pageId: pageId)
        withAnimation(.easeInOut(duration: 0.25)) {
            isSidebarVisible = false
        }
    }
}

#Preview {
    ContentView()
}
