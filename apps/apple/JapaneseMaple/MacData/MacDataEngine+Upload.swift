//
//  MacDataEngine+Upload.swift
//  JapaneseMaple
//
//  Uploads what this Mac collected to the cloud, where bots and pages read it.
//
//  1. Register: tell the server which sources this Mac reads. It answers with the
//     sources it takes from this Mac (each source has one collector per user).
//  2. Items: every item whose revision the server doesn't have yet
//     (`uploaded_revision`), newest first.
//  3. Removals: deletions from the change log, after a cursor kept in `kv`.
//  4. Vectors: items embedded since their last upload (`uploaded_embedding_revision`).
//
//  Progress is saved after every batch, so a failed or interrupted upload resumes where
//  it stopped, after a retry or a relaunch.
//

#if os(macOS)
import Foundation
import os

/// What the server said at the last registration.
nonisolated struct MacDataUploadRegistration: Codable, Equatable, Sendable {
    /// The enabled sources this Mac registered with.
    var sources: [MacDataSource]
    /// The ones the server takes from this Mac.
    var activeSources: [MacDataSource]
    var at: Double
}

/// Upload progress for the web app's Mac data status.
nonisolated struct MacDataUploadStatus: Codable, Equatable, Sendable {
    var lastUploadAt: Double?
    var pending: Int
    var activeSources: [MacDataSource]
    var uploading: Bool
    var error: String?
}

extension MacDataEngine {
    static let removalCursorKey = "upload_removal_seq"
    static let lastUploadKey = "upload_last_at"
    static let registrationKey = "upload_registration"
    static let firstRetryDelay: TimeInterval = 5
    static let maxRetryDelay: TimeInterval = 10 * 60
    /// Re-register now and then: the user can move a source to another device from
    /// Settings → Devices, and this Mac only hears about it when it registers.
    static let registrationRefresh: TimeInterval = 15 * 60
    /// Vectors are about 8 KB each; this keeps a request near 1 MB.
    static let vectorBatchSize = 100
    static let removalBatchSize = 1_000

    func uploadStatus() throws -> MacDataUploadStatus {
        let store = try store()
        let active = registration?.activeSources ?? []
        return MacDataUploadStatus(
            lastUploadAt: try store.value(Self.lastUploadKey).flatMap(Double.init),
            pending: try store.pendingUploadCount(sources: active),
            activeSources: active,
            uploading: isUploading,
            error: uploadError)
    }

    /// Uploads everything new since the last upload. Overlapping calls coalesce into one
    /// extra pass. On failure a retry is scheduled with a growing delay.
    /// Returns true when everything was uploaded.
    @discardableResult
    func uploadPending(now: Date = Date()) async -> Bool {
        if isUploading {
            uploadAgain = true
            return false
        }
        isUploading = true
        defer { isUploading = false }
        retryTask?.cancel()
        retryTask = nil

        repeat {
            uploadAgain = false
            do {
                try await uploadOnce(now: now)
                uploadError = nil
                retryDelay = Self.firstRetryDelay
            } catch {
                uploadError = error.localizedDescription
                Self.log.error("Upload failed: \(error.localizedDescription, privacy: .public)")
                if case DeviceDataError.server(404, _) = error {
                    // The server forgot this device (removed from Settings → Devices).
                    registration = nil
                }
                scheduleRetry(after: error)
                return false
            }
        } while uploadAgain
        return true
    }

    /// Forget the registration so the next upload registers again, for example after
    /// the enabled sources change or the user signs in.
    func registrationChanged() {
        registration = nil
        retryDelay = Self.firstRetryDelay
    }

    // MARK: - Private

    private func uploadOnce(now: Date) async throws {
        let store = try store()
        // Removals logged before the first upload are of items the server never had.
        var cursor = Int64(try store.value(Self.removalCursorKey) ?? "") ?? -1
        if cursor < 0 {
            cursor = try store.latestChangeSeq()
            try store.setValue(String(cursor), for: Self.removalCursorKey)
        }

        let enabled = try store.enabledSources().sorted { $0.rawValue < $1.rawValue }
        var active = try await registered(enabled, now: now)

        // Items
        var reregistered = false
        while !active.isEmpty {
            let batch = try store.itemsNeedingUpload(sources: active, limit: DeviceDataClient.maxUpserts)
            guard !batch.isEmpty else { break }
            let result = try await client.uploadBatch(upserts: batch.map(\.deviceItem))
            try store.markUploaded(batch.map { ($0.id, $0.revision) })
            try noteUpload(now)
            if result.skipped > 0, !reregistered {
                // The server no longer takes some of these sources from this Mac.
                reregistered = true
                active = try await registered(enabled, now: now, force: true)
            }
        }

        // Removals: only the latest entry per item matters, and only while it's still
        // gone here (a message can be removed and come back with the same id).
        while true {
            let changes = try store.changes(after: cursor, limit: Self.removalBatchSize)
            guard let last = changes.last else { break }
            var ids: [String] = []
            var seen = Set<String>()
            for change in changes.reversed() where seen.insert(change.itemId).inserted {
                guard change.kind == "removed", active.contains(change.source),
                    try store.item(id: change.itemId) == nil
                else { continue }
                ids.append(change.itemId)
            }
            if !ids.isEmpty {
                _ = try await client.uploadBatch(upserts: [], removals: ids, cursor: String(last.seq))
                try noteUpload(now)
            }
            cursor = last.seq
            try store.setValue(String(cursor), for: Self.removalCursorKey)
        }

        // Vectors: the server keeps them only for the revision it has, which the items
        // step above just made sure of.
        while !active.isEmpty {
            let pending = try store.vectorsNeedingUpload(sources: active, limit: Self.vectorBatchSize)
            guard !pending.isEmpty else { break }
            var payload: [DeviceItemVectors] = []
            for entry in pending {
                let vectors = try store.vectors(itemId: entry.id)
                // Items with no text have no vectors; there's nothing to send.
                guard let dimensions = vectors.first?.count, dimensions > 0 else { continue }
                payload.append(
                    DeviceItemVectors(
                        id: entry.id, revision: entry.revision, dimensions: dimensions,
                        vectors: DeviceEmbedding.base64(vectors)))
            }
            if !payload.isEmpty {
                _ = try await client.uploadBatch(upserts: [], vectors: payload)
                try noteUpload(now)
            }
            try store.markVectorsUploaded(pending)
        }
    }

    /// Registers when the enabled sources changed, nothing is known yet, or the last
    /// registration is old. Returns the sources to upload.
    private func registered(_ enabled: [MacDataSource], now: Date, force: Bool = false)
        async throws -> Set<MacDataSource>
    {
        let store = try store()
        if registration == nil, let saved = try store.value(Self.registrationKey) {
            registration = try? JSONDecoder().decode(
                MacDataUploadRegistration.self, from: Data(saved.utf8))
            // Saved from an earlier launch: good for comparing, not for skipping registration.
            registration?.at = 0
        }
        if !force, let registration, registration.sources == enabled,
            now.timeIntervalSince1970 - registration.at < Self.registrationRefresh
        {
            return Set(registration.activeSources)
        }

        let collector = try await client.register(
            name: deviceName(), sources: enabled.map(\.deviceSource))
        let active = enabled.filter { collector.activeSources.contains($0.deviceSource) }
        // A source taken over by another device: the server dropped this Mac's copy,
        // so everything goes up again if it ever comes back.
        for source in registration?.activeSources ?? [] where !active.contains(source) {
            try store.resetUploads(source: source)
        }
        let next = MacDataUploadRegistration(
            sources: enabled, activeSources: active, at: now.timeIntervalSince1970)
        registration = next
        try store.setValue(
            String(decoding: try JSONEncoder().encode(next), as: UTF8.self), for: Self.registrationKey)
        return Set(active)
    }

    private func noteUpload(_ now: Date) throws {
        try store().setValue(String(now.timeIntervalSince1970), for: Self.lastUploadKey)
    }

    private func scheduleRetry(after error: Error) {
        guard retriesUploads else { return }
        // Signing in triggers an upload; there's nothing to retry until then.
        if case DeviceDataError.notSignedIn = error { return }
        let delay = retryDelay
        retryDelay = min(retryDelay * 2, Self.maxRetryDelay)
        retryTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !Task.isCancelled else { return }
            await self?.retryFired()
        }
    }

    private func retryFired() async {
        // Clear first: uploadPending cancels a pending retry, which would be this one.
        retryTask = nil
        await uploadPending()
    }
}

// MARK: - Store bookkeeping

nonisolated extension MacDataStore {
    private func sourceList(_ sources: some Collection<MacDataSource>) -> (sql: String, bindings: [Any?]) {
        (sources.map { _ in "?" }.joined(separator: ","), sources.map(\.rawValue))
    }

    /// Items whose current revision the server doesn't have, newest first.
    func itemsNeedingUpload(sources: Set<MacDataSource>, limit: Int) throws -> [MacDataItem] {
        guard !sources.isEmpty else { return [] }
        let list = sourceList(sources)
        return try decodeItems(
            db.rows(
                """
                SELECT json FROM items
                WHERE source IN (\(list.sql))
                AND (uploaded_revision IS NULL OR uploaded_revision != revision)
                ORDER BY occurred_at DESC LIMIT ?
                """, list.bindings + [limit]))
    }

    /// Only marks the revision that was sent; an item changed meanwhile goes up again.
    func markUploaded(_ entries: [(id: String, revision: String)]) throws {
        try db.transaction {
            for entry in entries {
                try db.execute(
                    "UPDATE items SET uploaded_revision=? WHERE id=? AND revision=?",
                    [entry.revision, entry.id, entry.revision])
            }
        }
    }

    /// Items embedded at their current revision, whose item the server has but whose
    /// vectors it doesn't.
    func vectorsNeedingUpload(sources: Set<MacDataSource>, limit: Int) throws
        -> [(id: String, revision: String)]
    {
        guard !sources.isEmpty else { return [] }
        let list = sourceList(sources)
        return try db.rows(
            """
            SELECT id, revision FROM items
            WHERE source IN (\(list.sql)) AND embedded_revision = revision
            AND uploaded_revision = revision
            AND (uploaded_embedding_revision IS NULL OR uploaded_embedding_revision != revision)
            ORDER BY occurred_at DESC LIMIT ?
            """, list.bindings + [limit]
        ).compactMap { row in
            guard let id = row["id"]?.string, let revision = row["revision"]?.string else { return nil }
            return (id, revision)
        }
    }

    func markVectorsUploaded(_ entries: [(id: String, revision: String)]) throws {
        try db.transaction {
            for entry in entries {
                try db.execute(
                    "UPDATE items SET uploaded_embedding_revision=? WHERE id=? AND embedded_revision=?",
                    [entry.revision, entry.id, entry.revision])
            }
        }
    }

    /// Items or vectors still to upload for these sources.
    func pendingUploadCount(sources: some Collection<MacDataSource>) throws -> Int {
        guard !sources.isEmpty else { return 0 }
        let list = sourceList(sources)
        return Int(
            try db.rows(
                """
                SELECT COUNT(*) AS n FROM items WHERE source IN (\(list.sql)) AND (
                    uploaded_revision IS NULL OR uploaded_revision != revision
                    OR (embedded_revision = revision AND (uploaded_embedding_revision IS NULL
                        OR uploaded_embedding_revision != revision)))
                """, list.bindings
            ).first?["n"]?.int ?? 0)
    }

    /// Everything for this source counts as not uploaded again.
    func resetUploads(source: MacDataSource) throws {
        try db.execute(
            "UPDATE items SET uploaded_revision=NULL, uploaded_embedding_revision=NULL WHERE source=?",
            [source.rawValue])
    }
}
#endif
