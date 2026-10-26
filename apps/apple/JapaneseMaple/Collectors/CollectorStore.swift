//
//  CollectorStore.swift
//  JapaneseMaple
//
//  A small local queue per collector, kept as a JSON file in Application Support. Items
//  recorded while offline or in the background wait here until an upload succeeds, and
//  what was already uploaded is remembered so unchanged items aren't sent again.
//

import Foundation

nonisolated struct CollectorState: Codable, Equatable, Sendable {
    /// Items waiting to upload, by id. A newer version replaces an older one.
    var pending: [String: DeviceItem] = [:]
    /// Ids to delete in the cloud (a workout removed from Health).
    var pendingRemovals: Set<String> = []
    /// The revision the server has for each item we uploaded.
    var uploaded: [String: String] = [:]
    var lastUploadAt: Date?
    /// Location only: recent visits, so a departure updates its arrival's item.
    var visits: [VisitRecord] = []

    var pendingCount: Int { pending.count + pendingRemovals.count }

    /// Queues the items the server doesn't already have at this revision.
    /// Returns how many were queued.
    @discardableResult
    mutating func enqueue(_ items: [DeviceItem]) -> Int {
        var queued = 0
        for item in items where uploaded[item.id] != item.revision {
            if pending[item.id]?.revision != item.revision { queued += 1 }
            pending[item.id] = item
            pendingRemovals.remove(item.id)
        }
        return queued
    }

    mutating func enqueueRemovals(_ ids: [String]) {
        for id in ids {
            pending[id] = nil
            if uploaded[id] != nil { pendingRemovals.insert(id) }
        }
    }

    /// Records a successful upload. Items changed again since the snapshot stay queued.
    mutating func markUploaded(_ items: [DeviceItem], removals: [String], at date: Date = Date()) {
        for item in items {
            uploaded[item.id] = item.revision
            if pending[item.id]?.revision == item.revision { pending[item.id] = nil }
        }
        for id in removals {
            uploaded[id] = nil
            pendingRemovals.remove(id)
        }
        lastUploadAt = date
    }

    /// Forgets uploads for items that have left the 30-day window (the server ages them
    /// out itself), keeping anything still queued.
    mutating func forgetUploads(except live: Set<String>) {
        uploaded = uploaded.filter { id, _ in live.contains(id) || pending[id] != nil }
    }

    /// Drops visits older than the window once they're uploaded.
    mutating func pruneVisits(before cutoff: Date) {
        visits.removeAll {
            ($0.departure ?? $0.arrival ?? .distantFuture) < cutoff && pending[$0.id] == nil
        }
        forgetUploads(except: Set(visits.map(\.id)))
    }
}

/// Loads and saves one collector's state.
nonisolated struct CollectorStateFile: Sendable {
    let url: URL

    init(url: URL) { self.url = url }

    init(name: String) {
        let base =
            FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Collectors", isDirectory: true)
        self.url = base.appendingPathComponent("\(name).json")
    }

    func load() -> CollectorState {
        guard let data = try? Data(contentsOf: url),
            let state = try? JSONDecoder().decode(CollectorState.self, from: data)
        else { return CollectorState() }
        return state
    }

    func save(_ state: CollectorState) {
        do {
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(state)
            // Readable after the first unlock, so background launches (a visit while the
            // phone is locked in a pocket) can still write.
            #if os(iOS)
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            #else
            try data.write(to: url, options: .atomic)
            #endif
        } catch {
            print("[Collectors] Could not save \(url.lastPathComponent): \(error)")
        }
    }
}

/// Loads and saves any small collector value (the named places, travel estimates) as
/// JSON next to the queues.
nonisolated struct CollectorJSONFile<Value: Codable & Sendable>: Sendable {
    let url: URL

    init(url: URL) { self.url = url }

    init(name: String) {
        self.url = CollectorStateFile(name: name).url
    }

    func load() -> Value? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Value.self, from: data)
    }

    func save(_ value: Value) {
        do {
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            let data = try JSONEncoder().encode(value)
            #if os(iOS)
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            #else
            try data.write(to: url, options: .atomic)
            #endif
        } catch {
            print("[Collectors] Could not save \(url.lastPathComponent): \(error)")
        }
    }
}

/// Uploads one collector's queue: embeds the items on the device, sends them with their
/// vectors, and records what the server accepted.
nonisolated enum CollectorUploader {
    static func flush(
        _ state: CollectorState, client: DeviceDataClient
    ) async throws -> CollectorState {
        var state = state
        let items = Array(state.pending.values).sorted { $0.occurredAt < $1.occurredAt }
        let removals = Array(state.pendingRemovals)
        guard !items.isEmpty || !removals.isEmpty else { return state }
        let vectors = CollectorEmbedding.vectors(for: items)
        try await client.upload(upserts: items, removals: removals, vectors: vectors)
        state.markUploaded(items, removals: removals)
        return state
    }
}
