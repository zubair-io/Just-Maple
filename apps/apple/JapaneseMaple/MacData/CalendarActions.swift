//
//  CalendarActions.swift
//  JapaneseMaple
//
//  "Add to calendar": the one thing that flows back from the cloud to this Mac.
//
//  1. A bot proposes an event; the user taps Add in a chat; the server queues a
//     `create_event` action for the Mac collecting their calendar.
//  2. This Mac lists its pending actions on every sync, when it connects, and when
//     the server nudges it (`GET /api/collectors/:deviceId/actions`).
//  3. It adds each event with EventKit, in the calendar chosen in settings or the
//     default one, and reports the result with the event's identifier and the item id
//     the next calendar upload will use (`POST .../actions/:id/result`).
//
//  Never twice: an added event's result is saved before reporting, and the event
//  carries the id in its URL, so a retry (lost reply, crash, reinstall) finds the event
//  it already made instead of adding another.
//
//  Undo: when the user undoes an added event in the bot action log, the server queues a
//  `delete_event` action with the event's identifier and the id of the `create_event`
//  that added it. The event is removed only if it still carries that action's marker,
//  so an event Just Maple didn't add is never touched; one already gone counts as done.
//

#if os(macOS)
import EventKit
import os
import Foundation

/// One pending action, as `GET /api/collectors/:deviceId/actions` returns it.
nonisolated struct DeviceAction: Codable, Equatable, Sendable {
    struct Event: Codable, Equatable, Sendable {
        var title: String
        /// Seconds since 1970.
        var start: Double
        var end: Double
        var allDay: Bool?
        var location: String?
        var notes: String?
        var timeZone: String?
    }

    var id: String
    /// `create_event` / `delete_event` (calendar) or `home_service` (Home Assistant,
    /// HomeActions.swift).
    var type: String
    var source: String
    /// The event to add, or (for `delete_event`) the one that was added. Optional because
    /// `home_service` actions have none; calendar actions always carry one.
    var event: Event?
    /// `delete_event`: EventKit's identifier for the event, as this Mac reported it.
    var eventIdentifier: String? = nil
    /// `delete_event`: the `create_event` action that added it (its marker).
    var createdBy: String? = nil
    /// `home_service`: the call the owner confirmed (HomeActions.swift).
    var call: HomeServiceCall? = nil
    /// ISO 8601; home actions expire 15 minutes after the tap.
    var expiresAt: String? = nil
}

nonisolated struct DeviceActionResult: Codable, Equatable, Sendable {
    var ok: Bool
    var eventIdentifier: String?
    var itemId: String?
    var error: String?
    /// `delete_event` only: "not_found" when there was nothing to remove, so the server
    /// doesn't show the event as removed.
    var outcome: String? = nil

    static let notFound = "not_found"
}

/// An event this Mac added.
nonisolated struct WrittenCalendarEvent: Equatable, Sendable {
    /// EventKit's `calendarItemIdentifier`.
    var eventIdentifier: String
    /// `calendar:<id>@<start>`, as `CalendarReader` names it in uploads.
    var itemId: String
}

/// A calendar the user can pick for added events.
nonisolated struct WritableCalendar: Codable, Equatable, Sendable {
    var id: String
    var title: String
    var account: String?
}

/// EventKit, behind a protocol so tests never touch the real calendar.
nonisolated protocol CalendarWriting: Sendable {
    func writableCalendars() -> [WritableCalendar]
    func defaultCalendarId() -> String?
    /// An event this Mac already added for `marker`, around `start`.
    func existingEvent(marker: URL, around start: Date) -> WrittenCalendarEvent?
    func create(_ event: DeviceAction.Event, calendarId: String?, marker: URL) throws
        -> WrittenCalendarEvent
    /// Removes the event this Mac added for `marker`: by `identifier`, or found again by
    /// its marker around `start`. False when it's already gone. Throws for an event that
    /// doesn't carry the marker (not ours to remove).
    func remove(identifier: String, marker: URL, around start: Date) throws -> Bool
}

/// The server's side of the queue.
nonisolated protocol DeviceActionsAPI: Sendable {
    func pendingActions() async throws -> [DeviceAction]
    func report(_ id: String, _ result: DeviceActionResult) async throws
}

/// Successful results saved before reporting, so a report that fails is sent again
/// instead of the event being added again. Failures aren't saved: when the action comes
/// back (the user tapped Try again), it is tried again.
nonisolated protocol DeviceActionLedger: Sendable {
    func result(for id: String) async throws -> DeviceActionResult?
    func save(_ result: DeviceActionResult, for id: String) async throws
}

nonisolated enum CalendarActionError: LocalizedError {
    case noAccess
    case noCalendar
    case notAddedByJustMaple
    case unsupported(String)

    var errorDescription: String? {
        switch self {
        case .noAccess:
            "Just Maple can't write to Calendar on this Mac. Turn on Calendar access in System Settings → Privacy & Security → Calendars."
        case .noCalendar:
            "This Mac has no calendar that accepts new events."
        case .notAddedByJustMaple:
            "This event wasn't added by Just Maple, so it was left alone. Remove it in Calendar."
        case .unsupported(let type):
            "This Mac doesn't know how to do \"\(type)\". Update Just Maple."
        }
    }
}

nonisolated struct CalendarActionRunner: Sendable {
    let api: DeviceActionsAPI
    let writer: CalendarWriting
    let ledger: DeviceActionLedger
    /// The calendar chosen in settings; nil (or one that's gone) means the default.
    let calendarId: String?
    /// Runs `home_service` actions; nil when this Mac isn't connected to Home Assistant.
    var home: HomeActionPerforming? = nil
    var now: @Sendable () -> Date = { Date() }

    static func marker(for id: String) -> URL {
        URL(string: "justmaple://calendar-action/\(id)")!
    }

    /// Handles every pending action. Returns how many were reported. A failed report
    /// stops the pass; the next one sends a saved success again, or tries a failure again.
    @discardableResult
    func run() async throws -> Int {
        var reported = 0
        for action in try await api.pendingActions() {
            let saved = try await ledger.result(for: action.id).flatMap { $0.ok ? $0 : nil }
            let result: DeviceActionResult
            if let saved {
                result = saved
            } else {
                result = await perform(action)
            }
            if saved == nil, result.ok { try await ledger.save(result, for: action.id) }
            try await api.report(action.id, result)
            reported += 1
        }
        return reported
    }

    private func perform(_ action: DeviceAction) async -> DeviceActionResult {
        switch (action.type, action.event) {
        case ("create_event", let event?): return add(action, event)
        case ("delete_event", let event?): return remove(action, event)
        case ("home_service", _): return await performHome(action)
        default:
            return DeviceActionResult(
                ok: false, error: CalendarActionError.unsupported(action.type).localizedDescription)
        }
    }

    /// Undo of an added event. Gone already is reported as `not_found` (nothing was
    /// removed); a repeat after a lost reply sends the saved result again.
    private func remove(_ action: DeviceAction, _ event: DeviceAction.Event) -> DeviceActionResult {
        guard let createdBy = action.createdBy, let identifier = action.eventIdentifier else {
            return DeviceActionResult(
                ok: false, error: CalendarActionError.notAddedByJustMaple.localizedDescription)
        }
        do {
            let removed = try writer.remove(
                identifier: identifier, marker: Self.marker(for: createdBy),
                around: Date(timeIntervalSince1970: event.start))
            return DeviceActionResult(
                ok: true, eventIdentifier: identifier,
                outcome: removed ? nil : DeviceActionResult.notFound)
        } catch {
            return DeviceActionResult(ok: false, error: String(error.localizedDescription.prefix(500)))
        }
    }

    private func add(_ action: DeviceAction, _ event: DeviceAction.Event) -> DeviceActionResult {
        let marker = Self.marker(for: action.id)
        if let existing = writer.existingEvent(
            marker: marker, around: Date(timeIntervalSince1970: event.start))
        {
            return DeviceActionResult(
                ok: true, eventIdentifier: existing.eventIdentifier, itemId: existing.itemId)
        }
        let chosen = calendarId.flatMap { id in
            writer.writableCalendars().contains { $0.id == id } ? id : nil
        }
        do {
            let written = try writer.create(
                event, calendarId: chosen ?? writer.defaultCalendarId(), marker: marker)
            return DeviceActionResult(
                ok: true, eventIdentifier: written.eventIdentifier, itemId: written.itemId)
        } catch {
            return DeviceActionResult(ok: false, error: String(error.localizedDescription.prefix(500)))
        }
    }

    /// A Home Assistant service call: not after it expired, and only through the
    /// connector, which checks the call and the entity's exposure again first.
    private func performHome(_ action: DeviceAction) async -> DeviceActionResult {
        guard let call = action.call else {
            return DeviceActionResult(ok: false, error: "This action has nothing to do.")
        }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let expires = action.expiresAt.flatMap {
            formatter.date(from: $0) ?? ISO8601DateFormatter().date(from: $0)
        }
        // No expiry is treated as expired: the server always sends one.
        guard let expires, expires > now() else { return HomeActionError.expired() }
        guard let home else { return HomeActionError.notConnected() }
        return await home.perform(call)
    }
}

// MARK: - EventKit

nonisolated struct EventKitCalendarWriter: CalendarWriting, @unchecked Sendable {
    let store: EKEventStore

    func writableCalendars() -> [WritableCalendar] {
        store.calendars(for: .event)
            .filter(\.allowsContentModifications)
            .map { WritableCalendar(id: $0.calendarIdentifier, title: $0.title, account: $0.source?.title) }
            .sorted { ($0.account ?? "", $0.title) < ($1.account ?? "", $1.title) }
    }

    func defaultCalendarId() -> String? {
        store.defaultCalendarForNewEvents?.calendarIdentifier
    }

    func existingEvent(marker: URL, around start: Date) -> WrittenCalendarEvent? {
        guard CalendarReader.hasAccess else { return nil }
        let predicate = store.predicateForEvents(
            withStart: start.addingTimeInterval(-2 * 24 * 60 * 60),
            end: start.addingTimeInterval(33 * 24 * 60 * 60), calendars: nil)
        return store.events(matching: predicate).first { $0.url == marker }.map(Self.written)
    }

    func create(_ draft: DeviceAction.Event, calendarId: String?, marker: URL) throws
        -> WrittenCalendarEvent
    {
        let status = EKEventStore.authorizationStatus(for: .event)
        guard status == .fullAccess || status == .writeOnly else { throw CalendarActionError.noAccess }
        guard
            let calendar = calendarId.flatMap({ store.calendar(withIdentifier: $0) })
                ?? store.defaultCalendarForNewEvents
        else { throw CalendarActionError.noCalendar }
        let event = EKEvent(eventStore: store)
        event.calendar = calendar
        event.title = draft.title
        event.isAllDay = draft.allDay == true
        event.startDate = Date(timeIntervalSince1970: draft.start)
        // EventKit ends all-day events on their last day, not the next midnight.
        event.endDate = Date(timeIntervalSince1970: draft.allDay == true ? draft.end - 1 : draft.end)
        if let zone = draft.timeZone.flatMap(TimeZone.init(identifier:)), draft.allDay != true {
            event.timeZone = zone
        }
        event.location = draft.location
        event.notes = draft.notes
        event.url = marker
        try store.save(event, span: .thisEvent, commit: true)
        return Self.written(event)
    }

    func remove(identifier: String, marker: URL, around start: Date) throws -> Bool {
        // Finding the event needs read access; write-only can't see what it added.
        guard EKEventStore.authorizationStatus(for: .event) == .fullAccess else {
            throw CalendarActionError.noAccess
        }
        let byIdentifier = store.calendarItem(withIdentifier: identifier) as? EKEvent
        let event =
            byIdentifier?.url == marker
            ? byIdentifier
            : store.events(
                matching: store.predicateForEvents(
                    withStart: start.addingTimeInterval(-2 * 24 * 60 * 60),
                    end: start.addingTimeInterval(33 * 24 * 60 * 60), calendars: nil)
            ).first { $0.url == marker }
        guard let event else {
            if byIdentifier != nil { throw CalendarActionError.notAddedByJustMaple }
            return false
        }
        try store.remove(event, span: .thisEvent, commit: true)
        return true
    }

    private static func written(_ event: EKEvent) -> WrittenCalendarEvent {
        WrittenCalendarEvent(
            eventIdentifier: event.calendarItemIdentifier,
            itemId: CalendarReader.item(from: event).id)
    }
}

// MARK: - Store and client

extension MacDataEngine {
    static let actionCalendarKey = "action_calendar_id"

    /// Does what the user confirmed in Just Maple. Overlapping calls coalesce into one
    /// extra pass. Only while this Mac collects the calendar or Home Assistant: the server
    /// gives each source's actions to its collector alone.
    func runActions() async {
        if isRunningActions {
            runActionsAgain = true
            return
        }
        isRunningActions = true
        defer { isRunningActions = false }
        repeat {
            runActionsAgain = false
            let active = registration?.activeSources ?? []
            guard active.contains(.calendar) || active.contains(.home) else { return }
            let runner = CalendarActionRunner(
                api: client, writer: EventKitCalendarWriter(store: eventStore),
                ledger: EngineActionLedger(engine: self),
                calendarId: (try? store().value(Self.actionCalendarKey)).flatMap { $0?.isEmpty == false ? $0 : nil },
                home: active.contains(.home) ? homePerformer : nil)
            do {
                try await runner.run()
            } catch {
                Self.log.error("Calendar actions failed: \(error.localizedDescription, privacy: .public)")
            }
        } while runActionsAgain
    }

    /// Calendars that accept new events, for the calendar picker in settings.
    func actionCalendars() throws -> (calendars: [WritableCalendar], selected: String?, defaultId: String?) {
        let writer = EventKitCalendarWriter(store: eventStore)
        let selected = try store().value(Self.actionCalendarKey).flatMap { $0.isEmpty ? nil : $0 }
        return (writer.writableCalendars(), selected, writer.defaultCalendarId())
    }

    /// nil goes back to the default calendar.
    func setActionCalendar(_ id: String?) throws {
        try store().setValue(id ?? "", for: Self.actionCalendarKey)
    }

    func actionResult(for id: String) throws -> DeviceActionResult? {
        guard let json = try store().value("action:\(id)"), !json.isEmpty else { return nil }
        return try? JSONDecoder().decode(DeviceActionResult.self, from: Data(json.utf8))
    }

    func saveActionResult(_ result: DeviceActionResult, for id: String) throws {
        try store().setValue(
            String(decoding: try JSONEncoder().encode(result), as: UTF8.self), for: "action:\(id)")
    }
}

/// Results live in the local store's key-value table, read through the engine.
nonisolated struct EngineActionLedger: DeviceActionLedger {
    let engine: MacDataEngine

    func result(for id: String) async throws -> DeviceActionResult? {
        try await engine.actionResult(for: id)
    }

    func save(_ result: DeviceActionResult, for id: String) async throws {
        try await engine.saveActionResult(result, for: id)
    }
}

extension DeviceDataClient: DeviceActionsAPI {
    func pendingActions() async throws -> [DeviceAction] {
        struct Reply: Decodable { var actions: [DeviceAction] }
        let reply: Reply = try await get("/api/collectors/\(Self.deviceId)/actions")
        return reply.actions
    }

    func report(_ id: String, _ result: DeviceActionResult) async throws {
        struct Reply: Decodable {}
        do {
            let _: Reply = try await post("/api/collectors/\(Self.deviceId)/actions/\(id)/result", result)
        } catch DeviceDataError.server(404, _) {
            // No longer this Mac's (moved, or the user tried again elsewhere): nothing to report.
        }
    }
}
#endif
