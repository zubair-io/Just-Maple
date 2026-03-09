//
//  NativeSidebarView.swift
//  JapaneseMaple
//
//  Native SwiftUI sidebar showing notebooks and pages.
//

import SwiftUI

struct NativeSidebarView: View {
    @ObservedObject var viewModel: SidebarViewModel
    @State private var showNewNotebookAlert = false
    @State private var newNotebookName = ""
    @State private var renamingNotebookId: String?
    @State private var renamingNotebookLabel = ""
    @State private var renamingPageId: String?
    @State private var renamingPageTitle = ""

    var body: some View {
        VStack(spacing: 0) {
            // Logo header
            HStack(spacing: 10) {
                Image("MapleLeaf")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 32, height: 32)

                Text("Just Maple")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(MapleTheme.textMain)

                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, 8)

            // Notebook list
            ScrollView {
                LazyVStack(spacing: 2) {
                    ForEach(viewModel.notebooks) { notebook in
                        notebookSection(notebook: notebook)
                    }
                }
                .padding(.horizontal, 8)
                .padding(.top, 4)
            }

            Spacer(minLength: 0)

            // Settings footer
            Divider()
                .overlay(MapleTheme.border)

            Button {
                handleSettingsNavigate()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "gearshape")
                        .font(.body)
                        .foregroundStyle(MapleTheme.textMuted)

                    Text("Settings")
                        .font(.body)
                        .foregroundStyle(MapleTheme.textMuted)

                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .background(MapleTheme.sidebarBackground)
        #if os(macOS)
        .navigationSplitViewColumnWidth(min: 200, ideal: 240, max: 360)
        #endif
        .alert("New Notebook", isPresented: $showNewNotebookAlert) {
            TextField("Notebook name", text: $newNotebookName)
            Button("Create") {
                let name = newNotebookName.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !name.isEmpty else { return }
                Task {
                    await viewModel.createNotebook(label: name)
                }
            }
            Button("Cancel", role: .cancel) {}
        }
        .alert("Rename Notebook", isPresented: Binding(
            get: { renamingNotebookId != nil },
            set: { if !$0 { renamingNotebookId = nil } }
        )) {
            TextField("Name", text: $renamingNotebookLabel)
            Button("Rename") {
                guard let id = renamingNotebookId else { return }
                let label = renamingNotebookLabel.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !label.isEmpty else { return }
                Task {
                    await viewModel.renameNotebook(notebookId: id, label: label)
                }
                renamingNotebookId = nil
            }
            Button("Cancel", role: .cancel) {
                renamingNotebookId = nil
            }
        }
        .alert("Rename Page", isPresented: Binding(
            get: { renamingPageId != nil },
            set: { if !$0 { renamingPageId = nil } }
        )) {
            TextField("Title", text: $renamingPageTitle)
            Button("Rename") {
                guard let id = renamingPageId else { return }
                let title = renamingPageTitle.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !title.isEmpty else { return }
                Task {
                    await viewModel.renamePage(pageId: id, title: title)
                }
                renamingPageId = nil
            }
            Button("Cancel", role: .cancel) {
                renamingPageId = nil
            }
        }
        .task {
            await viewModel.loadInitialData()
        }
    }

    // MARK: - Notebook Section

    @ViewBuilder
    private func notebookSection(notebook: SidebarNotebook) -> some View {
        let isExpanded = viewModel.expandedNotebooks.contains(notebook._id)

        VStack(spacing: 0) {
            notebookHeader(notebook: notebook)

            if isExpanded {
                let notebookPages = viewModel.pages[notebook._id] ?? []
                ForEach(notebookPages) { page in
                    pageRow(page: page, notebookId: notebook._id)
                }
            }
        }
    }

    // MARK: - Notebook Header

    @ViewBuilder
    private func notebookHeader(notebook: SidebarNotebook) -> some View {
        let isExpanded = viewModel.expandedNotebooks.contains(notebook._id)
        let isSelected = viewModel.selectedNotebookId == notebook._id && viewModel.selectedPageId == nil

        HStack(spacing: 6) {
            Button {
                Task {
                    await viewModel.toggleExpanded(notebookId: notebook._id)
                }
            } label: {
                Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                    .font(.caption)
                    .foregroundStyle(MapleTheme.textMuted)
                    .frame(width: 16, height: 16)
            }
            .buttonStyle(.plain)

            Button {
                handleNavigate(notebookId: notebook._id)
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "book.closed")
                        .font(.body)
                        .foregroundStyle(isSelected ? MapleTheme.primary : MapleTheme.textMuted)

                    Text(notebook.label)
                        .font(.body)
                        .fontWeight(isSelected ? .semibold : .regular)
                        .foregroundStyle(isSelected ? MapleTheme.textMain : MapleTheme.textMuted)
                        .lineLimit(1)

                    Spacer()

                    let notebookUnread = totalUnread(for: notebook._id)
                    if notebookUnread > 0 {
                        Text("\(notebookUnread)")
                            .font(.caption)
                            .fontWeight(.bold)
                            .foregroundStyle(MapleTheme.badgeText)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(MapleTheme.primary, in: Capsule())
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(isSelected ? MapleTheme.surface : Color.clear)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(isSelected ? MapleTheme.border : Color.clear, lineWidth: 1)
        )
        .contextMenu {
            Button {
                viewModel.requestNewPage(notebookId: notebook._id, type: "memo")
            } label: {
                Label("New Page", systemImage: "doc.badge.plus")
            }

            Divider()

            Button {
                renamingNotebookLabel = notebook.label
                renamingNotebookId = notebook._id
            } label: {
                Label("Rename", systemImage: "pencil")
            }

            Button(role: .destructive) {
                Task {
                    await viewModel.deleteNotebook(notebookId: notebook._id)
                }
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }

    // MARK: - Page Row

    @ViewBuilder
    private func pageRow(page: SidebarPage, notebookId: String) -> some View {
        let isSelected = viewModel.selectedPageId == page.id

        Button {
            handleNavigate(notebookId: notebookId, pageId: page.id)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: pageIcon(for: page.type))
                    .font(.body)
                    .foregroundStyle(MapleTheme.textMuted)

                Text(page.title.isEmpty ? "Untitled" : page.title)
                    .font(.body)
                    .lineLimit(1)
                    .foregroundStyle(
                        page.title.isEmpty
                            ? MapleTheme.textMuted
                            : (isSelected ? MapleTheme.textMain : MapleTheme.textMuted)
                    )
                    .fontWeight(isSelected ? .medium : .regular)

                Spacer()

                if let count = viewModel.unreadCounts[page.id], count > 0 {
                    Text("\(count)")
                        .font(.caption)
                        .fontWeight(.bold)
                        .foregroundStyle(MapleTheme.badgeText)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(MapleTheme.primary, in: Capsule())
                }
            }
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .padding(.leading, 22)
        .background(
            isSelected
                ? HStack(spacing: 0) {
                    Rectangle()
                        .fill(MapleTheme.primary)
                        .frame(width: 2)
                    MapleTheme.surfaceHover
                }
                .clipShape(RoundedRectangle(cornerRadius: 6))
                : nil
        )
        .contextMenu {
            Button {
                renamingPageTitle = page.title
                renamingPageId = page.id
            } label: {
                Label("Rename", systemImage: "pencil")
            }

            Divider()

            Button(role: .destructive) {
                Task {
                    await viewModel.trashPage(pageId: page.id)
                }
            } label: {
                Label("Move to Trash", systemImage: "trash")
            }
        }
    }

    // MARK: - Helpers

    private func handleNavigate(notebookId: String, pageId: String? = nil) {
        #if os(iOS)
        viewModel.navigateAndCloseSidebar(notebookId: notebookId, pageId: pageId)
        #else
        viewModel.navigateTo(notebookId: notebookId, pageId: pageId)
        #endif
    }

    private func handleSettingsNavigate() {
        #if os(iOS)
        viewModel.navigateToSettings()
        withAnimation(.easeInOut(duration: 0.25)) {
            viewModel.isSidebarVisible = false
        }
        #else
        viewModel.navigateToSettings()
        #endif
    }

    private func pageIcon(for type: String) -> String {
        switch type {
        case "memo": return "doc.text"
        case "whiteboard": return "scribble"
        case "kanban": return "rectangle.split.3x1"
        case "message": return "message"
        case "recording": return "waveform"
        case "canvas": return "square.grid.3x3"
        default: return "doc"
        }
    }

    private func totalUnread(for notebookId: String) -> Int {
        let notebookPages = viewModel.pages[notebookId] ?? []
        return notebookPages.reduce(0) { sum, page in
            sum + (viewModel.unreadCounts[page.id] ?? 0)
        }
    }
}
