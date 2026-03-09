//
//  SidebarViewModel.swift
//  JapaneseMaple
//
//  View model for the native sidebar — fetches notebooks/pages from API
//  and sends bridge messages to the web view on user interaction.
//

import Foundation
import Combine

// MARK: - Models

struct SidebarNotebook: Codable, Identifiable {
    let _id: String
    var label: String

    var id: String { _id }
}

struct SidebarPage: Codable, Identifiable {
    let id: String
    var title: String
    let type: String
    let notebookId: String?
    let isTrashed: Bool?
    let updatedAt: String?
}

// MARK: - View Model

@MainActor
class SidebarViewModel: ObservableObject {
    @Published var notebooks: [SidebarNotebook] = []
    @Published var pages: [String: [SidebarPage]] = [:] // notebookId → pages
    @Published var selectedNotebookId: String?
    @Published var selectedPageId: String?
    @Published var unreadCounts: [String: Int] = [:] // pageId → count
    @Published var expandedNotebooks: Set<String> = []
    @Published var isLoading = false
    @Published var isSidebarVisible = false

    weak var bridge: NativeBridge?

    private let decoder = JSONDecoder()

    // MARK: - Bridge Message Handling

    func handleSidebarMessage(_ message: WebToNativeMessage) {
        switch message {
        case .sidebarActiveChanged(let payload):
            selectedNotebookId = payload.notebookId
            selectedPageId = payload.pageId
            // Auto-expand the active notebook
            if let notebookId = payload.notebookId {
                expandedNotebooks.insert(notebookId)
            }
            // If notebooks haven't loaded yet (token wasn't available earlier), retry now
            if notebooks.isEmpty {
                Task { await loadInitialData() }
            }

        case .sidebarDataChanged(let payload):
            switch (payload.entity, payload.action) {
            case ("notebook", _):
                Task { await fetchNotebooks() }
            case ("page", _):
                // Refetch pages for all expanded notebooks
                Task {
                    for notebookId in expandedNotebooks {
                        await fetchPages(notebookId: notebookId)
                    }
                }
            default:
                break
            }

        case .sidebarUnreadCounts(let payload):
            var newCounts: [String: Int] = [:]
            for entry in payload.counts {
                newCounts[entry.pageId] = entry.count
            }
            unreadCounts = newCounts

        case .toggleNativeSidebar:
            isSidebarVisible.toggle()

        default:
            break
        }
    }

    // MARK: - API Calls

    func fetchNotebooks() async {
        let apiUrl = ServerConfigService.shared.getAPIUrl()
        guard let token = ServerConfigService.shared.getToken() else {
            print("[Sidebar] No auth token available")
            return
        }

        guard let url = URL(string: "\(apiUrl)/api/notebooks") else { return }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode) else {
                print("[Sidebar] Failed to fetch notebooks: HTTP \((response as? HTTPURLResponse)?.statusCode ?? 0)")
                return
            }

            struct NotebooksResponse: Codable {
                let notebooks: [SidebarNotebook]
            }

            let result = try decoder.decode(NotebooksResponse.self, from: data)
            notebooks = result.notebooks
            print("[Sidebar] Fetched \(notebooks.count) notebooks")
        } catch {
            print("[Sidebar] Error fetching notebooks: \(error.localizedDescription)")
        }
    }

    func fetchPages(notebookId: String) async {
        let apiUrl = ServerConfigService.shared.getAPIUrl()
        guard let token = ServerConfigService.shared.getToken() else { return }

        guard let url = URL(string: "\(apiUrl)/api/pages?notebookId=\(notebookId)") else { return }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode) else { return }

            struct PagesResponse: Codable {
                let pages: [SidebarPage]
            }

            let result = try decoder.decode(PagesResponse.self, from: data)
            // Filter out trashed pages
            pages[notebookId] = result.pages.filter { !($0.isTrashed ?? false) }
            print("[Sidebar] Fetched \(pages[notebookId]?.count ?? 0) pages for notebook \(notebookId)")
        } catch {
            print("[Sidebar] Error fetching pages: \(error.localizedDescription)")
        }
    }

    // MARK: - Navigation (sends bridge messages to web)

    func navigateTo(notebookId: String, pageId: String? = nil) {
        selectedNotebookId = notebookId
        selectedPageId = pageId

        // Auto-expand and fetch pages
        expandedNotebooks.insert(notebookId)
        if pages[notebookId] == nil {
            Task { await fetchPages(notebookId: notebookId) }
        }

        bridge?.send(.sidebarNavigate(NativeToWebMessage.SidebarNavigatePayload(
            notebookId: notebookId,
            pageId: pageId
        )))
    }

    func navigateToSettings() {
        selectedNotebookId = nil
        selectedPageId = nil
        bridge?.send(.sidebarNavigate(NativeToWebMessage.SidebarNavigatePayload(
            notebookId: "settings",
            pageId: nil
        )))
    }

    func requestNewPage(notebookId: String, type: String = "memo") {
        bridge?.send(.sidebarNewPage(NativeToWebMessage.SidebarNewPagePayload(
            notebookId: notebookId,
            type: type
        )))
    }

    // MARK: - Notebook CRUD

    func createNotebook(label: String) async {
        let apiUrl = ServerConfigService.shared.getAPIUrl()
        guard let token = ServerConfigService.shared.getToken() else { return }
        guard let url = URL(string: "\(apiUrl)/api/notebooks") else { return }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: String] = ["label": label]
        request.httpBody = try? JSONEncoder().encode(body)

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode) else { return }

            struct CreateResponse: Codable {
                let notebook: SidebarNotebook
            }

            let result = try decoder.decode(CreateResponse.self, from: data)
            notebooks.append(result.notebook)

            // Notify web of the new notebook
            bridge?.send(.sidebarNotebookCreated(NativeToWebMessage.SidebarNotebookCreatedPayload(
                notebook: NativeToWebMessage.SidebarNotebookCreatedPayload.SidebarNotebook(
                    _id: result.notebook._id,
                    label: result.notebook.label
                )
            )))

            print("[Sidebar] Created notebook: \(result.notebook.label)")
        } catch {
            print("[Sidebar] Error creating notebook: \(error.localizedDescription)")
        }
    }

    func renameNotebook(notebookId: String, label: String) async {
        let apiUrl = ServerConfigService.shared.getAPIUrl()
        guard let token = ServerConfigService.shared.getToken() else { return }
        guard let url = URL(string: "\(apiUrl)/api/notebooks/\(notebookId)") else { return }

        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: String] = ["label": label]
        request.httpBody = try? JSONEncoder().encode(body)

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode) else { return }

            // Update local state
            if let index = notebooks.firstIndex(where: { $0._id == notebookId }) {
                notebooks[index] = SidebarNotebook(_id: notebookId, label: label)
            }

            // Notify web
            bridge?.send(.sidebarNotebookRenamed(NativeToWebMessage.SidebarNotebookRenamedPayload(
                notebookId: notebookId,
                label: label
            )))

            print("[Sidebar] Renamed notebook \(notebookId) to \(label)")
        } catch {
            print("[Sidebar] Error renaming notebook: \(error.localizedDescription)")
        }
    }

    func deleteNotebook(notebookId: String) async {
        let apiUrl = ServerConfigService.shared.getAPIUrl()
        guard let token = ServerConfigService.shared.getToken() else { return }
        guard let url = URL(string: "\(apiUrl)/api/notebooks/\(notebookId)") else { return }

        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode) else { return }

            // Update local state
            notebooks.removeAll { $0._id == notebookId }
            pages.removeValue(forKey: notebookId)
            expandedNotebooks.remove(notebookId)

            // Notify web
            bridge?.send(.sidebarNotebookDeleted(NativeToWebMessage.SidebarNotebookDeletedPayload(
                notebookId: notebookId
            )))

            // If we deleted the active notebook, navigate to the first available
            if selectedNotebookId == notebookId {
                selectedNotebookId = nil
                selectedPageId = nil
                if let first = notebooks.first {
                    navigateTo(notebookId: first._id)
                }
            }

            print("[Sidebar] Deleted notebook \(notebookId)")
        } catch {
            print("[Sidebar] Error deleting notebook: \(error.localizedDescription)")
        }
    }

    // MARK: - Page Actions

    func trashPage(pageId: String) async {
        let apiUrl = ServerConfigService.shared.getAPIUrl()
        guard let token = ServerConfigService.shared.getToken() else { return }
        guard let url = URL(string: "\(apiUrl)/api/pages/\(pageId)/trash") else { return }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode) else { return }

            // Remove from local state
            for (notebookId, notebookPages) in pages {
                pages[notebookId] = notebookPages.filter { $0.id != pageId }
            }

            // Notify web
            bridge?.send(.sidebarPageTrashed(NativeToWebMessage.SidebarPageTrashedPayload(
                pageId: pageId
            )))

            // If we trashed the active page, clear selection
            if selectedPageId == pageId {
                selectedPageId = nil
                if let notebookId = selectedNotebookId {
                    navigateTo(notebookId: notebookId)
                }
            }

            print("[Sidebar] Trashed page \(pageId)")
        } catch {
            print("[Sidebar] Error trashing page: \(error.localizedDescription)")
        }
    }

    func renamePage(pageId: String, title: String) async {
        let apiUrl = ServerConfigService.shared.getAPIUrl()
        guard let token = ServerConfigService.shared.getToken() else { return }
        guard let url = URL(string: "\(apiUrl)/api/pages/\(pageId)") else { return }

        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: String] = ["title": title]
        request.httpBody = try? JSONEncoder().encode(body)

        do {
            let (_, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode) else { return }

            // Update local state
            for (notebookId, notebookPages) in pages {
                if let index = notebookPages.firstIndex(where: { $0.id == pageId }) {
                    var updated = notebookPages[index]
                    updated = SidebarPage(
                        id: updated.id,
                        title: title,
                        type: updated.type,
                        notebookId: updated.notebookId,
                        isTrashed: updated.isTrashed,
                        updatedAt: updated.updatedAt
                    )
                    pages[notebookId]?[index] = updated
                }
            }

            // Notify web
            bridge?.send(.sidebarPageRenamed(NativeToWebMessage.SidebarPageRenamedPayload(
                pageId: pageId,
                title: title
            )))

            print("[Sidebar] Renamed page \(pageId) to \(title)")
        } catch {
            print("[Sidebar] Error renaming page: \(error.localizedDescription)")
        }
    }

    // MARK: - Initial Load

    func loadInitialData() async {
        isLoading = true
        await fetchNotebooks()

        // Auto-expand and fetch pages for the selected notebook, or the first one
        let targetNotebookId = selectedNotebookId ?? notebooks.first?._id
        if let notebookId = targetNotebookId {
            expandedNotebooks.insert(notebookId)
            await fetchPages(notebookId: notebookId)
            if selectedNotebookId == nil {
                selectedNotebookId = notebookId
            }
        }
        isLoading = false
    }

    func toggleExpanded(notebookId: String) async {
        if expandedNotebooks.contains(notebookId) {
            expandedNotebooks.remove(notebookId)
        } else {
            expandedNotebooks.insert(notebookId)
            // Fetch pages if we don't have them yet
            if pages[notebookId] == nil {
                await fetchPages(notebookId: notebookId)
            }
        }
    }
}
