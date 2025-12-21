//
//  TagListViewModel.swift
//  Just Maple Watch App
//
//  View model for tag list
//

import Foundation
import Combine

@MainActor
class TagListViewModel: ObservableObject {
    @Published var tags: [Tag] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    private let apiClient = APIClient.shared

    /// Load tags from API
    func loadTags() async {
        isLoading = true
        errorMessage = nil

        do {
            tags = try await apiClient.getTags()
            print("[TagList] ✅ Loaded \(tags.count) tags")
        } catch let error as APIClientError {
            errorMessage = error.localizedDescription
            print("[TagList] ❌ Failed to load tags: \(error.localizedDescription)")
        } catch {
            errorMessage = "Failed to load tags"
            print("[TagList] ❌ Failed to load tags: \(error)")
        }

        isLoading = false
    }

    /// Refresh tags
    func refresh() async {
        await loadTags()
    }
}
