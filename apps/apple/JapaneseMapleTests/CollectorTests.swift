//
//  CollectorTests.swift
//  JapaneseMapleTests
//
//  The iPhone collectors' pure mapping: visits, daily Health summaries, workouts and
//  the local upload queue. Runs on the Mac; no location or Health data is read.
//

import Foundation
import Testing

@testable import JapaneseMaple

private let calendar: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "America/Chicago")!
    return calendar
}()

private func date(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 0, _ min: Int = 0) -> Date {
    calendar.date(from: DateComponents(year: y, month: m, day: d, hour: h, minute: min))!
}

@Suite("Collectors")
struct CollectorTests {
    // MARK: - Visits

    private func arrivalOnly() -> VisitRecord {
        var visit = LocationMapping.record(
            arrival: date(2026, 10, 24, 14, 10), departure: .distantFuture,
            latitude: 41.881_234, longitude: -87.623_456, accuracy: 35)
        visit.placeName = "Riverside Park"
        visit.street = "12 Main St"
        visit.address = "12 Main St, Springfield, IL"
        return visit
    }

    @Test func visitBecomesAnOpenItem() {
        let item = LocationMapping.item(for: arrivalOnly(), calendar: calendar)
        let arrival = date(2026, 10, 24, 14, 10).timeIntervalSince1970
        #expect(item.id == "location:visit:\(Int(arrival)):41.881,-87.623")
        #expect(item.source == .location)
        #expect(item.occurredAt == arrival)
        #expect(item.endAt == nil)
        #expect(item.title == "Riverside Park")
        #expect(item.location == "12 Main St, Springfield, IL")
        #expect(item.body == "At Riverside Park (12 Main St) on Sat Oct 24 from 2:10 pm")
        #expect(item.extra?["lat"] == .number(41.88123))
        #expect(item.extra?["lon"] == .number(-87.62346))
        #expect(item.extra?["accuracy"] == .number(35))
        #expect(item.extra?["arrived"] == .string("2026-10-24T14:10:00-05:00"))
        #expect(item.extra?["departed"] == .null)
        #expect(!item.revision.isEmpty)
    }

    @Test func departureUpdatesTheSameItemWithANewRevision() {
        let arrived = arrivalOnly()
        let open = LocationMapping.item(for: arrived, calendar: calendar)

        // CoreLocation reports the visit again on departure, with a slightly different fix.
        let departing = LocationMapping.record(
            arrival: date(2026, 10, 24, 14, 10), departure: date(2026, 10, 24, 15, 45),
            latitude: 41.881_6, longitude: -87.622_9, accuracy: 20)
        let merged = LocationMapping.merge(departing, into: [arrived])
        #expect(merged.count == 1)
        #expect(merged[0].placeName == "Riverside Park")

        let closed = LocationMapping.item(for: merged[0], calendar: calendar)
        #expect(closed.id == open.id)
        #expect(closed.revision != open.revision)
        #expect(closed.endAt == date(2026, 10, 24, 15, 45).timeIntervalSince1970)
        #expect(closed.body == "At Riverside Park (12 Main St) on Sat Oct 24 from 2:10 pm to 3:45 pm (1h 35m)")
        #expect(closed.extra?["departed"] == .string("2026-10-24T15:45:00-05:00"))
        #expect(closed.extra?["accuracy"] == .number(20))

        // Same content, same revision: nothing to upload again.
        #expect(LocationMapping.item(for: merged[0], calendar: calendar).revision == closed.revision)
    }

    @Test func visitIdIsStableAcrossRounding() {
        let a = LocationMapping.visitId(
            arrival: Date(timeIntervalSince1970: 1_000.2), latitude: 41.881_2, longitude: -87.623_4)
        let b = LocationMapping.visitId(
            arrival: Date(timeIntervalSince1970: 999.8), latitude: 41.880_9, longitude: -87.623_1)
        #expect(a == b)
        #expect(a == "location:visit:1000:41.881,-87.623")
    }

    @Test func differentVisitsStaySeparate() {
        let home = arrivalOnly()
        let later = LocationMapping.record(
            arrival: date(2026, 10, 24, 18, 0), departure: .distantFuture,
            latitude: 41.9, longitude: -87.7, accuracy: 50)
        #expect(LocationMapping.merge(later, into: [home]).count == 2)
    }

    @Test func placeNamePrefersPointOfInterest() {
        #expect(
            LocationMapping.placeName(areasOfInterest: ["Riverside Park"], name: "12 Main St", street: "12 Main St")
                == "Riverside Park")
        #expect(LocationMapping.placeName(areasOfInterest: nil, name: "Joe's Cafe", street: "1 A St") == "Joe's Cafe")
        #expect(LocationMapping.placeName(areasOfInterest: [], name: " ", street: "1 A St") == "1 A St")
        #expect(LocationMapping.street(subThoroughfare: "12", thoroughfare: "Main St") == "12 Main St")
        #expect(
            LocationMapping.address(street: "12 Main St", locality: "Springfield", administrativeArea: "IL")
                == "12 Main St, Springfield, IL")
    }

    @Test func unnamedPlaceFallsBackToCoordinates() {
        let visit = LocationMapping.record(
            arrival: date(2026, 10, 24, 9, 5), departure: .distantFuture,
            latitude: 41.88, longitude: -87.62, accuracy: 100)
        let item = LocationMapping.item(for: visit, calendar: calendar)
        #expect(item.title == "41.8800, -87.6200")
        #expect(item.body == "At 41.8800, -87.6200 on Sat Oct 24 from 9:05 am")
        #expect(item.location == nil)
    }

    // MARK: - Health days

    @Test func dailySummaryTextAndNumbers() {
        let day = HealthDay(
            date: date(2026, 10, 24, 12), steps: 8_432.4, exerciseMinutes: 42.2,
            activeEnergyKcal: 512.6, restingHeartRate: 57.8,
            sleep: HealthSleep(
                asleepSeconds: 7 * 3600 + 10 * 60, bedtime: date(2026, 10, 23, 23, 20),
                wakeTime: date(2026, 10, 24, 6, 30)),
            workouts: [
                WorkoutRecord(
                    uuid: "A", activity: "Running", start: date(2026, 10, 24, 17, 10),
                    end: date(2026, 10, 24, 17, 42), duration: 32 * 60)
            ])
        let item = HealthMapping.dayItem(for: day, calendar: calendar)
        #expect(item.id == "health:day:2026-10-24")
        #expect(item.source == .health)
        #expect(item.occurredAt == date(2026, 10, 24).timeIntervalSince1970)
        #expect(item.title == "Health — Sat Oct 24")
        #expect(
            item.body
                == "Steps 8,432 · Exercise 42 min · Active energy 513 kcal · Sleep 7h 10m (11:20 pm–6:30 am) · Resting HR 58 · Workouts: Running 32 min at 5:10 pm"
        )
        #expect(item.extra?["date"] == .string("2026-10-24"))
        #expect(item.extra?["steps"] == .number(8_432))
        #expect(item.extra?["exerciseMinutes"] == .number(42))
        #expect(item.extra?["activeEnergyKcal"] == .number(513))
        #expect(item.extra?["sleepMinutes"] == .number(430))
        #expect(item.extra?["restingHeartRate"] == .number(58))
        #expect(item.extra?["bedtime"] == .string("2026-10-23T23:20:00-05:00"))
    }

    @Test func summaryOnlyShowsSharedTypes() {
        let day = HealthDay(date: date(2026, 10, 24), steps: 1_200)
        let item = HealthMapping.dayItem(for: day, calendar: calendar)
        #expect(item.body == "Steps 1,200")
        #expect(item.extra?["sleepMinutes"] == nil)
        #expect(item.extra?["restingHeartRate"] == nil)
        #expect(HealthDay(date: day.date).isEmpty)
    }

    @Test func revisionChangesWhenTotalsChange() {
        let morning = HealthMapping.dayItem(for: HealthDay(date: date(2026, 10, 24), steps: 1_200), calendar: calendar)
        let same = HealthMapping.dayItem(for: HealthDay(date: date(2026, 10, 24), steps: 1_200.3), calendar: calendar)
        let evening = HealthMapping.dayItem(for: HealthDay(date: date(2026, 10, 24), steps: 9_000), calendar: calendar)
        #expect(morning.revision == same.revision)
        #expect(morning.revision != evening.revision)
        #expect(morning.id == evening.id)
    }

    @Test func sleepMergesOverlapsAndBelongsToTheWakingDay() {
        let intervals: [(start: Date, end: Date)] = [
            // Watch and phone both recorded the first stretch.
            (date(2026, 10, 23, 23, 20), date(2026, 10, 24, 2, 0)),
            (date(2026, 10, 23, 23, 30), date(2026, 10, 24, 1, 0)),
            // Awake 2:00–2:30.
            (date(2026, 10, 24, 2, 30), date(2026, 10, 24, 6, 30)),
            // A nap the afternoon before belongs to the 23rd.
            (date(2026, 10, 23, 14, 0), date(2026, 10, 23, 15, 0)),
        ]
        let sleep = HealthMapping.sleep(intervals: intervals, day: date(2026, 10, 24), calendar: calendar)
        #expect(sleep?.asleepSeconds == TimeInterval(6 * 3600 + 40 * 60))
        #expect(sleep?.bedtime == date(2026, 10, 23, 23, 20))
        #expect(sleep?.wakeTime == date(2026, 10, 24, 6, 30))
        #expect(HealthMapping.sleep(intervals: [], day: date(2026, 10, 24), calendar: calendar) == nil)
    }

    // MARK: - Workouts

    @Test func workoutMapping() {
        let workout = WorkoutRecord(
            uuid: "4F2A9C1E-0000-4000-8000-000000000001", activity: "Running",
            start: date(2026, 10, 24, 17, 10), end: date(2026, 10, 24, 17, 42),
            duration: 32 * 60, energyKcal: 310.4, distanceMeters: 5_230)
        let item = HealthMapping.workoutItem(for: workout, calendar: calendar)
        #expect(item.id == "health:workout:4f2a9c1e-0000-4000-8000-000000000001")
        #expect(item.title == "Running · 32 min")
        #expect(item.occurredAt == workout.start.timeIntervalSince1970)
        #expect(item.endAt == workout.end.timeIntervalSince1970)
        #expect(item.body == "Running for 32 min on Sat Oct 24 from 5:10 pm to 5:42 pm · 5.2 km · 310 kcal")
        #expect(item.extra?["type"] == .string("Running"))
        #expect(item.extra?["durationMinutes"] == .number(32))
        #expect(item.extra?["energyKcal"] == .number(310))
        #expect(item.extra?["distanceMeters"] == .number(5_230))

        let strength = WorkoutRecord(
            uuid: "B", activity: "Strength Training", start: workout.start,
            end: workout.start.addingTimeInterval(65 * 60), duration: 65 * 60)
        let strengthItem = HealthMapping.workoutItem(for: strength, calendar: calendar)
        #expect(strengthItem.title == "Strength Training · 1h 5m")
        #expect(strengthItem.extra?["distanceMeters"] == .null)
    }

    // MARK: - Queue

    @Test func queueSkipsWhatTheServerHas() throws {
        var state = CollectorState()
        let item = LocationMapping.item(for: arrivalOnly(), calendar: calendar)
        #expect(state.enqueue([item]) == 1)
        #expect(state.pendingCount == 1)

        state.markUploaded([item], removals: [])
        #expect(state.pendingCount == 0)
        #expect(state.lastUploadAt != nil)
        #expect(state.enqueue([item]) == 0)

        var changed = item
        changed.body = "changed"
        changed = CollectorRevision.stamped(changed)
        #expect(state.enqueue([changed]) == 1)

        // Removals only go out for ids the server has.
        state.enqueueRemovals([item.id, "health:workout:never-uploaded"])
        #expect(state.pending.isEmpty)
        #expect(state.pendingRemovals == [item.id])

        // The queue survives a relaunch.
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("collector-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: url) }
        let file = CollectorStateFile(url: url)
        file.save(state)
        #expect(file.load() == state)
    }
}
