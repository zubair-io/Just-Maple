//
//  PlacesTravelTests.swift
//  JapaneseMapleTests
//
//  Named places (matching visits, choosing which regions to watch, merging region stays
//  with visits) and travel times to upcoming events (which need a new estimate, and the
//  upload). Pure helpers only; runs on the Mac.
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

/// About 111 m per 0.001° of latitude.
private let home = NamedPlace(
    id: "home-1", name: "Home", latitude: 41.8800, longitude: -87.6200, radius: 150,
    address: "12 Main St, Springfield, IL")
private let cafe = NamedPlace(
    id: "cafe-1", name: "Corner Cafe", latitude: 41.8815, longitude: -87.6200, radius: 300)
private let work = NamedPlace(
    id: "work-1", name: "Work", latitude: 41.8950, longitude: -87.6300, radius: 200)

private func visit(
    _ arrival: Date?, _ departure: Date?, latitude: Double = 41.8801, longitude: Double = -87.6201
) -> VisitRecord {
    LocationMapping.record(
        arrival: arrival ?? .distantPast, departure: departure ?? .distantFuture,
        latitude: latitude, longitude: longitude, accuracy: 40)
}

@Suite("Named places")
struct NamedPlaceTests {
    // MARK: - Matching a visit to a place

    @Test func visitMatchesTheNearestPlaceWithinItsRadius() {
        // 55 m from Home, 111 m from the cafe: both radii contain it, Home is nearer.
        #expect(PlaceMatching.place(atLatitude: 41.8805, longitude: -87.6200, in: [cafe, home]) == home)
        // 22 m from the cafe, 189 m from Home: only the cafe's radius contains it.
        #expect(PlaceMatching.place(atLatitude: 41.8817, longitude: -87.6200, in: [home, cafe]) == cafe)
        // Inside nothing.
        #expect(PlaceMatching.place(atLatitude: 41.8700, longitude: -87.6200, in: [home, cafe, work]) == nil)
        #expect(PlaceMatching.place(atLatitude: 41.8800, longitude: -87.6200, in: []) == nil)
    }

    @Test func visitAtANamedPlaceIsTitledWithItsName() {
        var named = PlaceStays.named(visit(date(2026, 10, 24, 18, 0), nil), places: [home, work])
        named.placeName = "Joe's Pizza"
        named.street = "14 Main St"
        named.address = "14 Main St, Springfield, IL"
        #expect(named.placeId == "home-1")
        let item = LocationMapping.item(for: named, calendar: calendar)
        #expect(item.title == "Home")
        #expect(item.location == "14 Main St, Springfield, IL")
        #expect(item.body == "At Home (14 Main St) on Sat Oct 24 from 6:00 pm")
        #expect(item.extra?["placeId"] == .string("home-1"))
        #expect(item.extra?["place"] == .string("Home"))

        // Somewhere unnamed keeps the geocoded name and has no placeId.
        let elsewhere = PlaceStays.named(
            visit(date(2026, 10, 24, 18, 0), nil, latitude: 41.85), places: [home, work])
        #expect(elsewhere.placeId == nil)
        #expect(LocationMapping.item(for: elsewhere, calendar: calendar).extra?["placeId"] == nil)
    }

    @Test func placesReplyDecodesOnlyPlacesWithALocation() throws {
        let json = """
            {"places": [
              {"id": "a", "kind": "place", "name": " Home ", "aliases": [],
               "place": {"lat": 41.88, "lon": -87.62, "radius": 150, "address": "12 Main St"},
               "createdAt": "x", "updatedAt": "x"},
              {"id": "b", "kind": "place", "name": "Somewhere", "aliases": []},
              {"id": "c", "kind": "place", "name": "School",
               "place": {"lat": 41.9, "lon": -87.7, "radius": 300}}
            ]}
            """
        let reply = try JSONDecoder().decode(NamedPlacesReply.self, from: Data(json.utf8))
        #expect(
            reply.namedPlaces == [
                NamedPlace(id: "a", name: "Home", latitude: 41.88, longitude: -87.62, radius: 150, address: "12 Main St"),
                NamedPlace(id: "c", name: "School", latitude: 41.9, longitude: -87.7, radius: 300),
            ])
    }

    @Test func cacheIsFreshForThreeHours() {
        let fetched = date(2026, 10, 24, 9, 0)
        let cache = NamedPlacesCache(places: [home], fetchedAt: fetched)
        #expect(cache.isFresh(now: fetched.addingTimeInterval(2 * 3600), maxAge: 3 * 3600))
        #expect(!cache.isFresh(now: fetched.addingTimeInterval(3 * 3600), maxAge: 3 * 3600))
        #expect(!NamedPlacesCache().isFresh(maxAge: 3 * 3600))
    }

    // MARK: - Choosing regions

    @Test func watchesThe20NearestPlaces() {
        // 25 places, each 1 km further north than the last, listed far to near.
        let places = (0..<25).reversed().map { index in
            NamedPlace(
                id: "p\(index)", name: "Place \(index)", latitude: 41.88 + Double(index) * 0.009,
                longitude: -87.62, radius: 100)
        }
        let chosen = PlaceMatching.regionsToMonitor(places, nearLatitude: 41.88, longitude: -87.62)
        #expect(chosen.count == 20)
        #expect(chosen.map(\.id) == (0..<20).map { "p\($0)" })

        // Standing near the far end picks the far ones.
        let far = PlaceMatching.regionsToMonitor(places, nearLatitude: 41.88 + 24 * 0.009, longitude: -87.62)
        #expect(far.first?.id == "p24")
        #expect(!far.map(\.id).contains("p0"))

        // No location yet: the first 20 as listed.
        let unknown = PlaceMatching.regionsToMonitor(places, nearLatitude: nil, longitude: nil)
        #expect(unknown.map(\.id) == Array(places.prefix(20)).map(\.id))

        // Fewer than 20: all of them.
        #expect(PlaceMatching.regionsToMonitor([home, work], nearLatitude: 0, longitude: 0).count == 2)
    }

    @Test func regionIdentifiersRoundTrip() {
        #expect(PlaceMatching.regionId(home) == "place:home-1")
        #expect(PlaceMatching.placeId(fromRegion: "place:home-1") == "home-1")
        #expect(PlaceMatching.placeId(fromRegion: "something-else") == nil)
    }

    // MARK: - Region stays

    @Test func enteringAndLeavingMakeOneStayWithAStableId() {
        let arrived = PlaceStays.enter(home, at: date(2026, 10, 24, 18, 0), into: [])
        #expect(arrived.count == 1)
        let stay = arrived[0]
        #expect(stay.id == "location:place:home-1:\(Int(date(2026, 10, 24, 18, 0).timeIntervalSince1970))")
        #expect(stay.isRegionStay)
        #expect(stay.namedPlace == "Home")
        #expect(stay.address == "12 Main St, Springfield, IL")

        // A repeated entry while there changes nothing.
        #expect(PlaceStays.enter(home, at: date(2026, 10, 24, 18, 30), into: arrived) == arrived)

        let left = PlaceStays.exit(home, at: date(2026, 10, 24, 22, 15), into: arrived)
        #expect(left.count == 1)
        #expect(left[0].id == stay.id)
        #expect(left[0].departure == date(2026, 10, 24, 22, 15))

        let item = LocationMapping.item(for: left[0], calendar: calendar)
        #expect(item.title == "Home")
        #expect(item.location == "12 Main St, Springfield, IL")
        #expect(item.endAt == date(2026, 10, 24, 22, 15).timeIntervalSince1970)
        #expect(item.extra?["placeId"] == .string("home-1"))
        #expect(item.body == "At Home (12 Main St, Springfield, IL) on Sat Oct 24 from 6:00 pm to 10:15 pm (4h 15m)")
    }

    @Test func reenteringWithinMinutesReopensTheStay() {
        var records = PlaceStays.enter(home, at: date(2026, 10, 24, 18, 0), into: [])
        records = PlaceStays.exit(home, at: date(2026, 10, 24, 19, 0), into: records)
        records = PlaceStays.enter(home, at: date(2026, 10, 24, 19, 3), into: records)
        #expect(records.count == 1)
        #expect(records[0].departure == nil)

        // Back an hour later: a new stay.
        records = PlaceStays.exit(home, at: date(2026, 10, 24, 20, 0), into: records)
        records = PlaceStays.enter(home, at: date(2026, 10, 24, 21, 0), into: records)
        #expect(records.count == 2)
    }

    @Test func leavingWithoutAnArrivalRecordsTheDeparture() {
        // Already home when monitoring began.
        let records = PlaceStays.exit(home, at: date(2026, 10, 24, 8, 0), into: [])
        #expect(records.count == 1)
        #expect(records[0].arrival == nil)
        #expect(records[0].departure == date(2026, 10, 24, 8, 0))
        #expect(LocationMapping.item(for: records[0], calendar: calendar).body == "Left Home (12 Main St, Springfield, IL) on Sat Oct 24 at 8:00 am")
    }

    // MARK: - Merging a region stay with a visit

    @Test func visitDuringARegionStayUpdatesItInsteadOfAddingOne() {
        var records = PlaceStays.enter(home, at: date(2026, 10, 24, 18, 0), into: [])
        let stayId = records[0].id

        // iOS reports the visit's arrival a few minutes later…
        records = PlaceStays.add(visit(date(2026, 10, 24, 18, 4), nil), places: [home], into: records)
        #expect(records.count == 1)
        #expect(records[0].arrival == date(2026, 10, 24, 18, 0))

        // …then its departure, before the region exit arrives.
        records = PlaceStays.add(
            visit(date(2026, 10, 24, 18, 4), date(2026, 10, 24, 22, 10)), places: [home], into: records)
        #expect(records.count == 1)
        #expect(records[0].departure == date(2026, 10, 24, 22, 10))

        // The region exit is more precise and updates the same stay.
        records = PlaceStays.exit(home, at: date(2026, 10, 24, 22, 15), into: records)
        #expect(records.count == 1)
        #expect(records[0].id == stayId)
        #expect(records[0].departure == date(2026, 10, 24, 22, 15))
    }

    @Test func regionEntryAfterTheVisitAdoptsTheVisit() {
        var records = PlaceStays.add(visit(date(2026, 10, 24, 18, 0), nil), places: [home], into: [])
        let visitId = records[0].id
        #expect(records[0].namedPlace == "Home")
        #expect(!records[0].isRegionStay)

        records = PlaceStays.enter(home, at: date(2026, 10, 24, 18, 2), into: records)
        #expect(records.count == 1)
        #expect(records[0].id == visitId)
        #expect(records[0].isRegionStay)
        #expect(records[0].arrival == date(2026, 10, 24, 18, 0))

        records = PlaceStays.exit(home, at: date(2026, 10, 24, 20, 0), into: records)
        records = PlaceStays.add(
            visit(date(2026, 10, 24, 18, 0), date(2026, 10, 24, 19, 58)), places: [home], into: records)
        #expect(records.count == 1)
        #expect(records[0].departure == date(2026, 10, 24, 20, 0))
    }

    @Test func visitsAtOtherTimesOrPlacesStaySeparate() {
        var records = PlaceStays.enter(home, at: date(2026, 10, 24, 18, 0), into: [])
        records = PlaceStays.exit(home, at: date(2026, 10, 24, 19, 0), into: records)
        // Home again the next morning: a separate stay.
        records = PlaceStays.add(visit(date(2026, 10, 25, 7, 0), nil), places: [home], into: records)
        // Work while the stay was open: not merged into Home.
        records = PlaceStays.add(
            visit(date(2026, 10, 24, 18, 30), nil, latitude: 41.8951, longitude: -87.6301),
            places: [home, work], into: records)
        #expect(records.count == 3)
        #expect(records.map(\.namedPlace) == ["Home", "Home", "Work"])
    }

    @Test func namingPlacesLaterFoldsVisitsARegionStayCovers() {
        // A visit recorded before the places were fetched, and an unrelated one.
        let early = visit(date(2026, 10, 24, 18, 3), nil)
        let unrelated = visit(date(2026, 10, 24, 12, 0), date(2026, 10, 24, 13, 0), latitude: 41.85)
        var records = [early, unrelated]
        records = PlaceStays.enter(home, at: date(2026, 10, 24, 18, 0), into: records)
        #expect(records.count == 3)

        let applied = PlaceStays.apply([home], to: records)
        #expect(applied.removed == [early.id])
        #expect(applied.records.count == 2)
        #expect(applied.records.contains { $0.id == unrelated.id && $0.placeId == nil })

        // Without a region stay, the visit is just named.
        let named = PlaceStays.apply([home], to: [early])
        #expect(named.removed.isEmpty)
        #expect(named.records[0].id == early.id)
        #expect(named.records[0].namedPlace == "Home")
    }

    @Test func oldVisitsKeepTheirRevision() throws {
        // A visit stored before named places existed decodes and maps as it did.
        let old = visit(date(2026, 10, 24, 18, 0), nil)
        var json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(old)) as! [String: Any]
        json["placeId"] = nil
        json["namedPlace"] = nil
        json["fromRegion"] = nil
        let decoded = try JSONDecoder().decode(
            VisitRecord.self, from: JSONSerialization.data(withJSONObject: json))
        #expect(decoded == old)
        #expect(LocationMapping.item(for: decoded).revision == LocationMapping.item(for: old).revision)
    }
}

@Suite("Travel times")
struct TravelTimeTests {
    let now = date(2026, 10, 24, 15, 0)
    let here = (latitude: 41.8800, longitude: -87.6200)

    private func event(_ id: String, inMinutes minutes: Double, location: String = "1 Park Ave") -> UpcomingEvent {
        UpcomingEvent(
            id: id, title: "Game", location: location, start: now.timeIntervalSince1970 + minutes * 60,
            end: now.timeIntervalSince1970 + minutes * 60 + 3600)
    }

    private func estimate(_ id: String, minutesAgo: Double, latitude: Double = 41.8800) -> TravelRecord {
        TravelRecord(
            eventId: id, seconds: 1_200, origin: "Home", computedAt: now.addingTimeInterval(-minutesAgo * 60),
            latitude: latitude, longitude: -87.6200)
    }

    @Test func selectsEventsThatNeedANewEstimate() {
        let events = [
            event("started", inMinutes: -5),
            event("too-far-ahead", inMinutes: 6 * 60 + 1),
            event("no-location", inMinutes: 30, location: "  "),
            event("new", inMinutes: 45),
            event("fresh", inMinutes: 60),
            event("stale", inMinutes: 90),
            event("moved", inMinutes: 120),
            event("edge-of-window", inMinutes: 6 * 60),
        ]
        let previous = [
            "fresh": estimate("fresh", minutesAgo: 5),
            "stale": estimate("stale", minutesAgo: 16),
            // Computed 2 km south of here.
            "moved": estimate("moved", minutesAgo: 5, latitude: 41.8620),
        ]
        let due = TravelPlanner.needingEstimate(
            events, previous: previous, now: now, latitude: here.latitude, longitude: here.longitude)
        #expect(due.map(\.id) == ["new", "stale", "moved", "edge-of-window"])

        // Moving less than 1 km keeps a fresh estimate.
        let nearby = TravelPlanner.needingEstimate(
            [event("fresh", inMinutes: 60)], previous: previous, now: now,
            latitude: here.latitude + 0.005, longitude: here.longitude)
        #expect(nearby.isEmpty)
    }

    @Test func upcomingSkipsStartedAndFarOffEvents() {
        let events = [event("started", inMinutes: 0), event("soon", inMinutes: 1), event("tomorrow", inMinutes: 20 * 60)]
        #expect(TravelPlanner.upcoming(events, now: now).map(\.id) == ["soon"])
    }

    @Test func pruneForgetsPastEventsAndOldGeocodes() {
        var state = TravelState()
        state.estimates = ["gone": estimate("gone", minutesAgo: 30), "kept": estimate("kept", minutesAgo: 30)]
        state.geocoded = [
            "1 park ave": GeocodedLocation(latitude: 1, longitude: 2, at: now.addingTimeInterval(-30 * 86_400)),
            "old place": GeocodedLocation(latitude: 1, longitude: 2, at: now.addingTimeInterval(-30 * 86_400)),
            "recent place": GeocodedLocation(latitude: 1, longitude: 2, at: now.addingTimeInterval(-86_400)),
        ]
        state.prune(events: [event("kept", inMinutes: 30, location: " 1  Park Ave")], now: now)
        #expect(Set(state.estimates.keys) == ["kept"])
        #expect(Set(state.geocoded.keys) == ["1 park ave", "recent place"])
    }

    @Test func geocodesAreCachedByLocationText() {
        #expect(TravelPlanner.locationKey("  1  Park\tAve ") == TravelPlanner.locationKey("1 park ave"))
        let found = GeocodedLocation(latitude: 1, longitude: 2, at: now.addingTimeInterval(-30 * 86_400))
        #expect(TravelPlanner.cachedGeocode(found, now: now) == found)
        // A location that didn't geocode is skipped for a while, then tried again.
        let failed = GeocodedLocation(latitude: nil, longitude: nil, at: now.addingTimeInterval(-3600))
        #expect(TravelPlanner.cachedGeocode(failed, now: now) == failed)
        #expect(TravelPlanner.cachedGeocode(failed, now: now.addingTimeInterval(6 * 3600)) == nil)
        #expect(TravelPlanner.cachedGeocode(nil, now: now) == nil)
    }

    @Test func originIsTheNamedPlaceOrAShortAddress() {
        #expect(TravelPlanner.origin(place: home, street: "12 Main St", locality: "Springfield") == "Home")
        #expect(TravelPlanner.origin(place: nil, street: "12 Main St", locality: "Springfield") == "12 Main St, Springfield")
        #expect(TravelPlanner.origin(place: nil, street: nil, locality: "Springfield") == "Springfield")
        #expect(TravelPlanner.origin(place: nil, street: " ", locality: nil) == nil)
        let long = String(repeating: "a", count: 300)
        #expect(TravelPlanner.origin(place: nil, street: long, locality: nil)?.count == 200)
    }

    @Test func buildsTheUploadPayload() throws {
        let computedAt = Date(timeIntervalSince1970: 1_790_000_000)
        var records = (0..<60).map { index in
            TravelRecord(
                eventId: String(format: "calendar:%02d", index), seconds: 1_234, origin: "Home",
                computedAt: computedAt, latitude: 41.88, longitude: -87.62)
        }
        records[0].origin = nil
        records[1].seconds = 89  // rounds to 1 minute
        records[2].seconds = 2 * 86_400  // capped at a day

        let uploads = TravelPlanner.uploads(deviceId: "device-1", records: records.reversed())
        #expect(uploads.map(\.estimates.count) == [50, 10])
        #expect(uploads.allSatisfy { $0.deviceId == "device-1" })
        let first = uploads[0].estimates
        #expect(first[0] == TravelEstimate(eventId: "calendar:00", minutes: 21, origin: nil, computedAt: "2026-09-21T14:13:20.000Z"))
        #expect(first[1].minutes == 1)
        #expect(first[2].minutes == 24 * 60)
        #expect(first[3].origin == "Home")

        // The JSON the server reads.
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(uploads[0])) as! [String: Any]
        #expect(json["deviceId"] as? String == "device-1")
        let estimates = json["estimates"] as! [[String: Any]]
        #expect(Set(estimates[0].keys) == ["eventId", "minutes", "computedAt"])
        #expect(Set(estimates[3].keys) == ["eventId", "minutes", "origin", "computedAt"])
        #expect(estimates[3]["minutes"] as? Int == 21)

        #expect(TravelPlanner.uploads(deviceId: "device-1", records: []).isEmpty)
    }
}
