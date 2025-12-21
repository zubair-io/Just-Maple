//
//  TagListView.swift
//  Just Maple Watch App
//
//  Main view showing list of tags
//

import SwiftUI

struct TagListView: View {
    @StateObject private var viewModel = TagListViewModel()
    @StateObject private var authManager = AuthenticationManager.shared
    @EnvironmentObject var notificationManager: NotificationManager
    @State private var navigationPath = NavigationPath()

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
            .navigationTitle("Just Maple")
            .navigationDestination(for: Tag.self) { tag in
                MessageListView(tag: tag)
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
