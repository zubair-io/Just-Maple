//
//  MacDataEngine+Home.swift
//  JapaneseMaple
//
//  Home Assistant's side of the engine. The connector (HomeAssistant/) hands over:
//  - the exposed list, every time it reads it: saved here, uploaded before any item, and
//    anything this Mac kept for entities no longer exposed is dropped from the local copy
//    (never reported as removed: the server keeps its copy, hidden);
//  - coalesced items, stored like any reader's pass and uploaded with the rest;
//  - its connection state, shown as the source's status.
//

#if os(macOS)
import Foundation

extension MacDataEngine {
    static let homeExposureKey = "home_exposure"
    /// The exposed list the server has, so it's only sent again when it changes.
    static let homeExposureUploadedKey = "home_exposure_uploaded"

    /// Whether the server takes Home Assistant from this Mac (one Mac per user connects).
    var homeIsActive: Bool { registration?.activeSources.contains(.home) == true }

    func setHomePerformer(_ performer: HomeActionPerforming?) {
        homePerformer = performer
    }

    func setHomeState(configured: Bool, status: HomeAssistantStatus?) {
        homeConfigured = configured
        homeStatus = status
    }

    /// The last exposed list read from Home Assistant; nil before the first one.
    func homeExposure() throws -> Set<String>? {
        guard let json = try store().value(Self.homeExposureKey), !json.isEmpty,
            let ids = try? JSONDecoder().decode([String].self, from: Data(json.utf8))
        else { return nil }
        return Set(ids)
    }

    /// Saves the exposed list and drops what's kept here for entities no longer on it.
    /// Returns true when the list changed.
    @discardableResult
    func setHomeExposure(_ exposed: Set<String>) throws -> Bool {
        let store = try store()
        let json = String(decoding: try JSONEncoder().encode(exposed.sorted()), as: UTF8.self)
        let changed = try store.value(Self.homeExposureKey) != json
        try store.setValue(json, for: Self.homeExposureKey)
        try store.dropHomeItems(notIn: exposed)
        return changed
    }

    /// Stores what the connector flushed. Only while Home Assistant is on, and only exposed
    /// entities. Returns how many items were added or changed.
    @discardableResult
    func applyHome(_ items: [MacDataItem], now: Date = Date()) throws -> Int {
        let store = try store()
        guard try store.enabledSources().contains(.home) else { return 0 }
        let exposed = try homeExposure() ?? []
        let kept = items.filter { item in
            item.source == .home && Self.homeEntityId(item).map(exposed.contains) == true
        }
        guard !kept.isEmpty else { return 0 }
        return try store.apply(
            MacDataReadResult(
                items: kept, removedIds: [], presentIds: nil, reconcileWindow: nil,
                checkpoint: "live"),
            source: .home, now: now)
    }

    /// `PUT /api/home/exposure` when the list differs from what the server has.
    func uploadHomeExposureIfChanged() async throws {
        let store = try store()
        guard let exposed = try homeExposure() else { return }
        let json = try store.value(Self.homeExposureKey) ?? ""
        guard try store.value(Self.homeExposureUploadedKey) != json else { return }
        try await client.uploadHomeExposure(exposed.sorted())
        try store.setValue(json, for: Self.homeExposureUploadedKey)
    }

    /// Leaves out home items of entities that aren't exposed (a change racing an exposure
    /// update); they are marked handled so the upload loop doesn't fetch them again.
    func withoutUnexposedHomeItems(_ items: [MacDataItem]) throws -> [MacDataItem] {
        guard items.contains(where: { $0.source == .home }) else { return items }
        let exposed = try homeExposure() ?? []
        var kept: [MacDataItem] = []
        var dropped: [(id: String, revision: String)] = []
        for item in items {
            if item.source != .home || Self.homeEntityId(item).map(exposed.contains) == true {
                kept.append(item)
            } else {
                dropped.append((item.id, item.revision))
            }
        }
        if !dropped.isEmpty { try store().markUploaded(dropped) }
        return kept
    }

    func applyHomeStatus(to status: inout MacDataSourceStatus) {
        guard homeConfigured else {
            status.state = .needsAccess
            status.message = HomeAssistantError.notConfigured.localizedDescription
            return
        }
        switch homeStatus {
        case .failed(let message, let retrying):
            status.state = retrying ? .error : .needsAccess
            status.message = message
        case .connecting:
            status.state = .syncing
        case .connected, .stopped, nil:
            break
        }
    }

    nonisolated static func homeEntityId(_ item: MacDataItem) -> String? {
        if case .string(let id) = item.extra?["entityId"] { return id }
        return nil
    }
}

nonisolated extension MacDataStore {
    /// Deletes local home items of entities not in `exposed`, without logging removals.
    func dropHomeItems(notIn exposed: Set<String>) throws {
        let rows = try db.rows(
            "SELECT id, json_extract(json, '$.extra.entityId') AS entity FROM items WHERE source='home'")
        let ids = rows.compactMap { row -> String? in
            guard let id = row["id"]?.string else { return nil }
            return row["entity"]?.string.map(exposed.contains) == true ? nil : id
        }
        guard !ids.isEmpty else { return }
        try db.transaction {
            for id in ids {
                try db.execute("DELETE FROM chunks WHERE item_id=?", [id])
                try db.execute("DELETE FROM items WHERE id=?", [id])
            }
        }
    }
}

extension DeviceDataClient {
    func uploadHomeExposure(_ entityIds: [String]) async throws {
        struct Body: Encodable {
            var deviceId: String
            var entityIds: [String]
        }
        struct Reply: Decodable {}
        let _: Reply = try await put(
            "/api/home/exposure", Body(deviceId: Self.deviceId, entityIds: entityIds))
    }
}
#endif

#if os(macOS)
/// Hands the connector's output to the engine, then tells the host what changed.
nonisolated struct HomeEngineSink: HomeAssistantSink {
    enum Change: Sendable { case items, exposure, status }

    let engine: MacDataEngine
    let changed: @MainActor @Sendable (Change) -> Void

    init(engine: MacDataEngine, changed: @escaping @MainActor @Sendable (Change) -> Void) {
        self.engine = engine
        self.changed = changed
    }

    func homeItems(_ items: [MacDataItem]) async {
        if ((try? await engine.applyHome(items)) ?? 0) > 0 { await changed(.items) }
    }

    func homeExposure(_ exposed: Set<String>) async {
        _ = try? await engine.setHomeExposure(exposed)
        // Always upload: on connect the server may not have this list yet.
        await changed(.exposure)
    }

    func homeStatus(_ status: HomeAssistantStatus) async {
        let configured = await engine.homeConfigured
        await engine.setHomeState(configured: configured, status: status)
        await changed(.status)
    }
}
#endif
