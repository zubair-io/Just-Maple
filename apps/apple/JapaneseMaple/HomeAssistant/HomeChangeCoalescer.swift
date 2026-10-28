//
//  HomeChangeCoalescer.swift
//  JapaneseMaple
//
//  Turns a stream of entity updates into few uploads, so a power sensor that reports every
//  second can't flood them.
//
//  - Updates wait for the next flush (every 10 seconds while anything is pending); an
//    entity updated many times in between is sent once, at its latest state.
//  - A change of state ("off" → "on") is also recorded as its own item. Several changes
//    between flushes become one, from the first state to the last; a light switched on
//    and back off again records nothing.
//  - Readings that move on their own (watts, degrees) never record changes, and their
//    current state goes up at most every 5 minutes.
//  - An entity records at most 20 changes an hour; a flapping sensor stops there.
//

#if os(macOS)
import Foundation

nonisolated struct HomeChangeCoalescer: Sendable {
    static let flushInterval: TimeInterval = 10
    static let measurementInterval: TimeInterval = 5 * 60
    static let maxChangesPerHour = 20

    private struct Pending {
        var latest: HomeEntityState
        /// The state before the first change in this window, if the state changed.
        var changedFrom: String?
    }

    private var pending: [String: Pending] = [:]
    /// When each measurement's state was last sent.
    private var lastSent: [String: Double] = [:]
    /// Recent change times per entity, for the hourly cap.
    private var recentChanges: [String: [Double]] = [:]

    var isEmpty: Bool { pending.isEmpty }

    /// Records an update. `before` is the entity's state before it (nil for a new one).
    mutating func observe(_ after: HomeEntityState, before: HomeEntityState?) {
        var entry = pending[after.entityId] ?? Pending(latest: after, changedFrom: nil)
        if let before, before.state != after.state, entry.changedFrom == nil,
            !after.isMeasurement
        {
            entry.changedFrom = before.state
        }
        entry.latest = after
        pending[after.entityId] = entry
    }

    /// Stops sending anything for these entities (they are no longer exposed).
    mutating func forget(_ entityIds: some Collection<String>) {
        for id in entityIds {
            pending[id] = nil
            lastSent[id] = nil
            recentChanges[id] = nil
        }
    }

    /// Items to upload now. Measurements sent less than 5 minutes ago stay pending.
    mutating func flush(now: Double, info: (String) -> HomeEntityInfo?) -> [MacDataItem] {
        var items: [MacDataItem] = []
        for (id, entry) in pending.sorted(by: { $0.key < $1.key }) {
            let state = entry.latest
            if state.isMeasurement, let sent = lastSent[id], now - sent < Self.measurementInterval {
                continue
            }
            pending[id] = nil
            items.append(HomeItems.state(state, info: info(id)))
            if state.isMeasurement { lastSent[id] = now }
            guard let from = entry.changedFrom, from != state.state else { continue }
            let hour = (recentChanges[id] ?? []).filter { now - $0 < 3600 }
            guard hour.count < Self.maxChangesPerHour else {
                recentChanges[id] = hour
                continue
            }
            recentChanges[id] = hour + [now]
            items.append(HomeItems.change(state, from: from, info: info(id)))
        }
        return items
    }
}
#endif
