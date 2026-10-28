//
//  CalendarActionTests.swift
//  JapaneseMapleTests
//
//  "Add to calendar" on the Mac: actions from the server become events, once each,
//  through fakes for EventKit and the server. The real calendar is never touched.
//

#if os(macOS)
import Foundation
import Testing

@testable import JapaneseMaple

/// A calendar in memory. Events are found again by their marker URL, like EventKit's.
private final class FakeCalendar: CalendarWriting, @unchecked Sendable {
    var calendars = [
        WritableCalendar(id: "home", title: "Home", account: "iCloud"),
        WritableCalendar(id: "kids", title: "Kids", account: "iCloud"),
    ]
    var events: [(event: DeviceAction.Event, calendarId: String?, marker: URL, written: WrittenCalendarEvent)] = []
    var failure: Error?

    func writableCalendars() -> [WritableCalendar] { calendars }
    func defaultCalendarId() -> String? { "home" }

    func existingEvent(marker: URL, around start: Date) -> WrittenCalendarEvent? {
        events.first { $0.marker == marker }?.written
    }

    func create(_ event: DeviceAction.Event, calendarId: String?, marker: URL) throws
        -> WrittenCalendarEvent
    {
        if let failure { throw failure }
        let written = WrittenCalendarEvent(
            eventIdentifier: "EK-\(events.count + 1)",
            itemId: "calendar:UID-\(events.count + 1)@\(Int(event.start))")
        events.append((event, calendarId, marker, written))
        return written
    }

    /// Events someone added in Calendar itself, without a marker.
    var foreign: [String] = []

    func remove(identifier: String, marker: URL, around start: Date) throws -> Bool {
        if let failure { throw failure }
        if let index = events.firstIndex(where: { $0.marker == marker }) {
            events.remove(at: index)
            return true
        }
        if foreign.contains(identifier) { throw CalendarActionError.notAddedByJustMaple }
        return false
    }
}

/// The server's queue: actions stay pending until a report gets through.
private actor FakeServer: DeviceActionsAPI {
    var pending: [DeviceAction]
    var reports: [(id: String, result: DeviceActionResult)] = []
    var failReports = false

    init(_ pending: [DeviceAction]) { self.pending = pending }

    func pendingActions() async throws -> [DeviceAction] { pending }

    func report(_ id: String, _ result: DeviceActionResult) async throws {
        if failReports { throw DeviceDataError.server(503, "Unavailable") }
        reports.append((id, result))
        pending.removeAll { $0.id == id }
    }

    func setFailReports(_ value: Bool) { failReports = value }
    func requeue(_ action: DeviceAction) { pending.append(action) }
}

private final class MemoryLedger: DeviceActionLedger, @unchecked Sendable {
    var results: [String: DeviceActionResult] = [:]
    func result(for id: String) async throws -> DeviceActionResult? { results[id] }
    func save(_ result: DeviceActionResult, for id: String) async throws { results[id] = result }
}

private let party = DeviceAction(
    id: "7d1e3a52-6c55-4a8e-9b1a-0d4f3c2b1a00", type: "create_event", source: "calendar",
    event: .init(
        title: "Greyson's soccer pizza party", start: 1_793_214_000, end: 1_793_217_600,
        allDay: nil, location: "The Commons", notes: "pickup 4:15–4:30, bring jersey",
        timeZone: "America/New_York"))

@Suite("Calendar actions")
struct CalendarActionTests {
    private func runner(
        _ server: FakeServer, _ calendar: FakeCalendar, _ ledger: MemoryLedger,
        calendarId: String? = nil
    ) -> CalendarActionRunner {
        CalendarActionRunner(api: server, writer: calendar, ledger: ledger, calendarId: calendarId)
    }

    @Test func addsTheEventAndReportsItsIdentifiers() async throws {
        let server = FakeServer([party])
        let calendar = FakeCalendar()
        let ledger = MemoryLedger()
        #expect(try await runner(server, calendar, ledger).run() == 1)

        #expect(calendar.events.count == 1)
        let added = try #require(calendar.events.first)
        #expect(added.event == party.event)
        #expect(added.calendarId == "home")
        #expect(added.marker.absoluteString == "justmaple://calendar-action/\(party.id)")
        let reports = await server.reports
        #expect(reports.map(\.id) == [party.id])
        #expect(
            reports.first?.result
                == DeviceActionResult(ok: true, eventIdentifier: "EK-1", itemId: "calendar:UID-1@1793214000"))
        // Nothing left: the next sync does nothing.
        #expect(try await runner(server, calendar, ledger).run() == 0)
        #expect(calendar.events.count == 1)
    }

    @Test func aReportThatFailsIsSentAgainWithoutAddingTwice() async throws {
        let server = FakeServer([party])
        let calendar = FakeCalendar()
        let ledger = MemoryLedger()
        await server.setFailReports(true)
        await #expect(throws: DeviceDataError.self) { try await runner(server, calendar, ledger).run() }
        #expect(calendar.events.count == 1)

        await server.setFailReports(false)
        try await runner(server, calendar, ledger).run()
        #expect(calendar.events.count == 1)
        #expect(await server.reports.first?.result.eventIdentifier == "EK-1")
    }

    @Test func findsAnEventItAlreadyMadeEvenWithoutItsRecords() async throws {
        let calendar = FakeCalendar()
        try await runner(FakeServer([party]), calendar, MemoryLedger()).run()
        // Say the app was reinstalled and the server offers the action again.
        let server = FakeServer([party])
        try await runner(server, calendar, MemoryLedger()).run()
        #expect(calendar.events.count == 1)
        #expect(await server.reports.first?.result.itemId == "calendar:UID-1@1793214000")
    }

    @Test func usesTheCalendarChosenInSettingsWhileItExists() async throws {
        let calendar = FakeCalendar()
        try await runner(FakeServer([party]), calendar, MemoryLedger(), calendarId: "kids").run()
        #expect(calendar.events.last?.calendarId == "kids")

        var other = party
        other.id = "8e2f4b63-7d66-4b9f-8c2b-1e5a4d3c2b11"
        calendar.calendars.removeAll { $0.id == "kids" }
        try await runner(FakeServer([other]), calendar, MemoryLedger(), calendarId: "kids").run()
        #expect(calendar.events.last?.calendarId == "home")
    }

    @Test func reportsWhyItCouldNotAddTheEvent() async throws {
        let server = FakeServer([party])
        let calendar = FakeCalendar()
        calendar.failure = CalendarActionError.noAccess
        try await runner(server, calendar, MemoryLedger()).run()
        let result = try #require(await server.reports.first?.result)
        #expect(result.ok == false)
        #expect(result.error?.contains("Calendar access") == true)
        #expect(calendar.events.isEmpty)
    }

    @Test func tryAgainAfterAFailureAddsTheEvent() async throws {
        let server = FakeServer([party])
        let calendar = FakeCalendar()
        let ledger = MemoryLedger()
        calendar.failure = CalendarActionError.noAccess
        try await runner(server, calendar, ledger).run()
        #expect(await server.reports.last?.result.ok == false)
        #expect(ledger.results[party.id] == nil)

        // The user grants access and taps Try again: the same action comes back.
        calendar.failure = nil
        await server.requeue(party)
        try await runner(server, calendar, ledger).run()
        #expect(calendar.events.count == 1)
        #expect(await server.reports.last?.result.ok == true)
        #expect(ledger.results[party.id]?.ok == true)
    }

    @Test func ignoresAFailureSavedByAnEarlierVersion() async throws {
        let server = FakeServer([party])
        let calendar = FakeCalendar()
        let ledger = MemoryLedger()
        ledger.results[party.id] = DeviceActionResult(ok: false, error: "old")
        try await runner(server, calendar, ledger).run()
        #expect(calendar.events.count == 1)
        #expect(await server.reports.last?.result.ok == true)
    }

    @Test func refusesActionsItDoesNotKnow() async throws {
        var unknown = party
        unknown.type = "rename_event"
        let server = FakeServer([unknown])
        let calendar = FakeCalendar()
        try await runner(server, calendar, MemoryLedger()).run()
        #expect(calendar.events.isEmpty)
        #expect(await server.reports.first?.result.ok == false)
    }

    // MARK: - Undo

    private func removal(of action: DeviceAction, identifier: String = "EK-1") -> DeviceAction {
        DeviceAction(
            id: "0c9d8e7f-1a2b-4c3d-8e4f-5a6b7c8d9e0f", type: "delete_event", source: "calendar",
            event: action.event, eventIdentifier: identifier, createdBy: action.id)
    }

    @Test func undoRemovesTheEventItAdded() async throws {
        let calendar = FakeCalendar()
        try await runner(FakeServer([party]), calendar, MemoryLedger()).run()
        #expect(calendar.events.count == 1)

        let server = FakeServer([removal(of: party)])
        let ledger = MemoryLedger()
        #expect(try await runner(server, calendar, ledger).run() == 1)
        #expect(calendar.events.isEmpty)
        #expect(await server.reports.first?.result == DeviceActionResult(ok: true, eventIdentifier: "EK-1"))
        #expect(ledger.results[removal(of: party).id]?.ok == true)
    }

    @Test func undoOfAnEventAlreadyGoneReportsNotFound() async throws {
        let calendar = FakeCalendar()
        let server = FakeServer([removal(of: party)])
        try await runner(server, calendar, MemoryLedger()).run()
        let result = try #require(await server.reports.first?.result)
        #expect(result.ok == true)
        #expect(result.outcome == DeviceActionResult.notFound)

        // Repeated (a lost reply): still fine, nothing else touched.
        try await runner(FakeServer([party]), calendar, MemoryLedger()).run()
        var other = party
        other.id = "8e2f4b63-7d66-4b9f-8c2b-1e5a4d3c2b11"
        let again = FakeServer([removal(of: other)])
        try await runner(again, calendar, MemoryLedger()).run()
        #expect(await again.reports.first?.result.outcome == DeviceActionResult.notFound)
        #expect(calendar.events.count == 1)
    }

    @Test func undoNeverRemovesAnEventJustMapleDidNotAdd() async throws {
        let calendar = FakeCalendar()
        calendar.foreign = ["EK-9"]
        let server = FakeServer([removal(of: party, identifier: "EK-9")])
        try await runner(server, calendar, MemoryLedger()).run()
        let result = try #require(await server.reports.first?.result)
        #expect(result.ok == false)
        #expect(result.error?.contains("wasn't added by Just Maple") == true)
        #expect(calendar.foreign == ["EK-9"])
    }

    @Test func undoReportsWhyItCouldNotRemove() async throws {
        let calendar = FakeCalendar()
        calendar.failure = CalendarActionError.noAccess
        let server = FakeServer([removal(of: party)])
        let ledger = MemoryLedger()
        try await runner(server, calendar, ledger).run()
        #expect(await server.reports.first?.result.ok == false)
        // Not saved: when the user taps Undo again, it is tried again.
        #expect(ledger.results.isEmpty)
    }

    @Test func decodesARemoval() throws {
        let json = """
            {"actions":[{"id":"0c9d8e7f-1a2b-4c3d-8e4f-5a6b7c8d9e0f","type":"delete_event",
            "source":"calendar","eventIdentifier":"EK-1","createdBy":"\(party.id)",
            "event":{"title":"Field trip","start":1793160000,"end":1793246400},
            "createdAt":"2026-10-27T12:00:00.000Z","expiresAt":"2026-11-03T12:00:00.000Z"}]}
            """
        struct Reply: Decodable { var actions: [DeviceAction] }
        let reply = try JSONDecoder().decode(Reply.self, from: Data(json.utf8))
        #expect(reply.actions.first?.eventIdentifier == "EK-1")
        #expect(reply.actions.first?.createdBy == party.id)
    }

    @Test func decodesTheServersActions() throws {
        let json = """
            {"actions":[{"id":"\(party.id)","type":"create_event","source":"calendar",
            "event":{"title":"Field trip","start":1793160000,"end":1793246400,"allDay":true,
            "timeZone":"America/New_York"},"createdAt":"2026-10-27T12:00:00.000Z",
            "expiresAt":"2026-11-03T12:00:00.000Z"}]}
            """
        struct Reply: Decodable { var actions: [DeviceAction] }
        let reply = try JSONDecoder().decode(Reply.self, from: Data(json.utf8))
        #expect(reply.actions.first?.event?.allDay == true)
        #expect(reply.actions.first?.event?.location == nil)
    }
}
#endif
