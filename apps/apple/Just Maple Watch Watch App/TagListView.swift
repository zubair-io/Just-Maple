//
//  TagListView.swift
//  JapaneseMaple Watch App
//
//  Main view showing list of tags
//

import SwiftUI

struct TagListView: View {
    @StateObject private var viewModel = TagListViewModel()
    @StateObject private var authManager = AuthenticationManager.shared
    @StateObject private var webSocketManager = WebSocketManager.shared
    @EnvironmentObject var notificationManager: NotificationManager
    @State private var navigationPath = NavigationPath()
    @State private var showDebugInfo = false

    var body: some View {
        NavigationStack(path: $navigationPath) {
            Group {
                if !authManager.isAuthenticated {
                    notAuthenticatedView
                } else if viewModel.isLoading && viewModel.tags.isEmpty {
                    loadingView
                } else if let errorMessage = viewModel.errorMessage, viewModel.tags.isEmpty {
                    errorView(errorMessage)
                } else if viewModel.tags.isEmpty {
                    emptyView
                } else {
                    tagListView
                }
            }
            .navigationTitle("JapaneseMaple")
            .navigationDestination(for: Tag.self) { tag in
                MessageListView(tag: tag)
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showDebugInfo.toggle()
                    } label: {
                        Image(systemName: showDebugInfo ? "info.circle.fill" : "info.circle")
                    }
                }
            }
            .sheet(isPresented: $showDebugInfo) {
                debugView
            }
        }
        .task {
            if authManager.isAuthenticated {
                await viewModel.loadTags()
            }
        }
        .onChange(of: notificationManager.selectedTagId) { oldValue, newValue in
            guard let tagId = newValue,
                  notificationManager.shouldOpenMessage else { return }

            print("[TagListView] 📱 Deep link to tag: \(tagId)")

            // Find the tag
            if let tag = viewModel.tags.first(where: { $0.id == tagId }) {
                // Navigate to the tag
                navigationPath.append(tag)
                print("[TagListView] ✅ Navigated to tag: \(tag.label)")
            } else {
                print("[TagListView] ⚠️ Tag not found: \(tagId)")
            }

            // Reset the flag
            notificationManager.shouldOpenMessage = false
            notificationManager.selectedTagId = nil
        }
    }

    // MARK: - Subviews

    private var notAuthenticatedView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Image(systemName: "lock.circle")
                        .font(.system(size: 32))
                        .foregroundColor(.orange)

                    Text("Not Authenticated")
                        .font(.headline)
                }

                Divider()

                Text("Debug Info:")
                    .font(.caption)
                    .fontWeight(.bold)

                if authManager.debugInfo.isEmpty {
                    Text("Tap 'Check Again' to see debug info")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(authManager.debugInfo.enumerated()), id: \.offset) { _, line in
                            Text(line)
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundColor(
                                    line.contains("✅") ? .green :
                                    line.contains("❌") ? .red :
                                    line.contains("⚠️") ? .orange :
                                    .secondary
                                )
                        }
                    }
                }

                Divider()

                Button {
                    authManager.checkAuthenticationStatus()
                } label: {
                    Label("Check Again", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.borderedProminent)
            }
            .padding()
        }
    }

    private var loadingView: some View {
        VStack(spacing: 16) {
            ProgressView()
            Text("Loading tags...")
                .font(.caption)
                .foregroundColor(.secondary)
        }
    }

    private func errorView(_ message: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 36))
                .foregroundColor(.red)

            Text(message)
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)

            Button("Retry") {
                Task {
                    await viewModel.refresh()
                }
            }
            .buttonStyle(.borderedProminent)
        }
        .padding()
    }

    private var emptyView: some View {
        VStack(spacing: 16) {
            Image(systemName: "folder")
                .font(.system(size: 48))
                .foregroundColor(.secondary)

            Text("No Tags")
                .font(.headline)

            Text("Create a tag in the iPhone app")
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
    }

    private var tagListView: some View {
        List {
            ForEach(viewModel.tags) { tag in
                Button {
                    navigationPath.append(tag)
                } label: {
                    TagRowView(tag: tag)
                }
                .buttonStyle(.plain)
            }
        }
        .refreshable {
            await viewModel.refresh()
        }
    }

    private var debugView: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // WebSocket Status
                    VStack(alignment: .leading, spacing: 8) {
                        Text("WebSocket Connection")
                            .font(.headline)

                        HStack {
                            Circle()
                                .fill(statusColor)
                                .frame(width: 8, height: 8)

                            Text(webSocketManager.connectionStatus.rawValue.capitalized)
                                .font(.caption)
                                .foregroundColor(statusColor)
                        }

                        if !webSocketManager.subscribedTags.isEmpty {
                            Text("Subscribed Tags:")
                                .font(.caption2)
                                .foregroundColor(.secondary)

                            ForEach(webSocketManager.subscribedTags, id: \.self) { tagId in
                                Text("• \(tagId)")
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundColor(.secondary)
                            }
                        }
                    }

                    Divider()

                    // WebSocket Logs
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Connection Logs")
                                .font(.headline)

                            Spacer()

                            if !webSocketManager.debugLogs.isEmpty {
                                Button {
                                    webSocketManager.debugLogs.removeAll()
                                } label: {
                                    Text("Clear")
                                        .font(.caption2)
                                }
                                .buttonStyle(.bordered)
                            }
                        }

                        if webSocketManager.debugLogs.isEmpty {
                            Text("No logs yet")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        } else {
                            VStack(alignment: .leading, spacing: 4) {
                                ForEach(Array(webSocketManager.debugLogs.enumerated()), id: \.offset) { _, log in
                                    Text(log)
                                        .font(.system(size: 9, design: .monospaced))
                                        .foregroundColor(
                                            log.contains("✅") ? .green :
                                            log.contains("❌") ? .red :
                                            log.contains("⚠️") ? .orange :
                                            log.contains("🔄") ? .blue :
                                            .secondary
                                        )
                                }
                            }
                        }
                    }

                    Divider()

                    // Actions
                    VStack(spacing: 12) {
                        Button {
                            Task {
                                await webSocketManager.connect()
                            }
                        } label: {
                            Label("Connect WebSocket", systemImage: "bolt.fill")
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(webSocketManager.connectionStatus == .connected)

                        Button {
                            webSocketManager.disconnect()
                        } label: {
                            Label("Disconnect WebSocket", systemImage: "bolt.slash.fill")
                        }
                        .buttonStyle(.bordered)
                        .disabled(webSocketManager.connectionStatus == .disconnected)
                    }

                    Divider()

                    // Authentication Info
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Authentication")
                            .font(.headline)

                        Text("Authenticated: \(authManager.isAuthenticated ? "Yes" : "No")")
                            .font(.caption)

                        if let apiUrl = authManager.apiUrl {
                            Text("API URL: \(apiUrl)")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                    }
                }
                .padding()
            }
            .navigationTitle("Debug Info")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        showDebugInfo = false
                    }
                }
            }
        }
    }

    private var statusColor: Color {
        switch webSocketManager.connectionStatus {
        case .connected:
            return .green
        case .connecting, .reconnecting:
            return .orange
        case .disconnected:
            return .red
        }
    }
}

// MARK: - Tag Row View

struct TagRowView: View {
    let tag: Tag

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(tag.label)
                    .font(.headline)

                Spacer()

                if tag.isShared {
                    Image(systemName: "person.2")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            Text(tag.value.rawValue.capitalized)
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Preview

#Preview {
    TagListView()
}
