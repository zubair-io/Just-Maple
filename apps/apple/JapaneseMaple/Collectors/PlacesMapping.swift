//
//  PlacesMapping.swift
//  JapaneseMaple
//
//  Named places (Home, Work, School) from About me, and how they turn visits into
//  stays the user recognises:
//
//  - iOS watches up to 20 regions at once, so the phone watches the 20 places nearest
//    to where it last was.
//  - Entering a place's region starts a stay titled with the place name; leaving ends it.
//  - A `CLVisit` inside a named place is titled with that name too, and when a region
//    stay already covers the same time it updates that stay instead of adding another.
//
//  Pure and platform-neutral so it can be tested on the Mac.
//

import Foundation

/// A place the user named on the web, as `GET /api/about-me/places` returns it.
nonisolated struct NamedPlace: Codable, Equatable, Sendable {
    var id: String
    var name: String
    var latitude: Double
    var longitude: Double
    /// Meters; a visit within this distance counts as being there.
    var radius: Double
    var address: String?
}

/// `GET /api/about-me/places`: About me entities of kind `place` that have a location.
nonisolated struct NamedPlacesReply: Decodable, Sendable {
    nonisolated struct Entity: Decodable, Sendable {
        nonisolated struct Place: Decodable, Sendable {
            var lat: Double
            var lon: Double
            var radius: Double
            var address: String?
        }
        var id: String
        var name: String
        var place: Place?
    }
    var places: [Entity]

    var namedPlaces: [NamedPlace] {
        places.compactMap { entity in
            guard let place = entity.place else { return nil }
            let name = entity.name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty else { return nil }
            return NamedPlace(
                id: entity.id, name: name, latitude: place.lat, longitude: place.lon,
                radius: place.radius, address: place.address)
        }
    }
}

/// The named places last fetched, kept on disk so background launches have them.
nonisolated struct NamedPlacesCache: Codable, Equatable, Sendable {
    var places: [NamedPlace] = []
    var fetchedAt: Date?

    /// Fetched less than `maxAge` ago.
    func isFresh(now: Date = Date(), maxAge: TimeInterval) -> Bool {
        guard let fetchedAt else { return false }
        return now.timeIntervalSince(fetchedAt) < maxAge
    }
}

nonisolated enum PlaceMatching {
    /// iOS monitors at most 20 regions per app.
    static let maxRegions = 20
    /// Prefix of the region identifiers this app monitors, so others are left alone.
    static let regionPrefix = "place:"

    static func regionId(_ place: NamedPlace) -> String { regionPrefix + place.id }

    static func placeId(fromRegion identifier: String) -> String? {
        identifier.hasPrefix(regionPrefix) ? String(identifier.dropFirst(regionPrefix.count)) : nil
    }

    static func distance(_ place: NamedPlace, _ latitude: Double, _ longitude: Double) -> Double {
        LocationMapping.distanceMeters(place.latitude, place.longitude, latitude, longitude)
    }

    /// The nearest named place whose radius contains the point, if any.
    static func place(
        atLatitude latitude: Double, longitude: Double, in places: [NamedPlace]
    ) -> NamedPlace? {
        places
            .map { (place: $0, distance: distance($0, latitude, longitude)) }
            .filter { $0.distance <= $0.place.radius }
            .min { $0.distance < $1.distance }?
            .place
    }

    /// The places to watch: the `limit` nearest to the last known location. Without a
    /// location, the first `limit` in the server's order.
    static func regionsToMonitor(
        _ places: [NamedPlace], nearLatitude latitude: Double?, longitude: Double?,
        limit: Int = maxRegions
    ) -> [NamedPlace] {
        guard let latitude, let longitude else { return Array(places.prefix(limit)) }
        return places.enumerated()
            .sorted {
                let a = distance($0.element, latitude, longitude)
                let b = distance($1.element, latitude, longitude)
                return a == b ? $0.offset < $1.offset : a < b
            }
            .prefix(limit)
            .map(\.element)
    }
}

nonisolated enum PlaceStays {
    /// A region stay and a visit this close in time still describe the same stay
    /// (iOS reports region crossings and visits a few minutes apart).
    static let overlapSlack: TimeInterval = 10 * 60
    /// Leaving and re-entering a place within this long is one stay (GPS jitter at the edge).
    static let reentrySeconds: TimeInterval = 5 * 60
    /// A stay whose exit never arrived stops absorbing visits after this long.
    static let maxOpenStay: TimeInterval = 24 * 60 * 60

    static func stayId(placeId: String, at date: Date) -> String {
        "location:place:\(placeId):\(Int(date.timeIntervalSince1970.rounded()))"
    }

    /// When the stay began and ended, as far as is known.
    private static func span(_ record: VisitRecord) -> (start: Date, end: Date) {
        let start = record.arrival ?? .distantPast
        let end =
            record.departure
            ?? record.arrival.map { $0.addingTimeInterval(maxOpenStay) } ?? .distantFuture
        return (start, end)
    }

    /// Whether two stays at a place overlap in time, allowing for a little slack. An open
    /// visit (you're still there) runs on to now.
    static func overlaps(_ a: VisitRecord, _ b: VisitRecord) -> Bool {
        let a = span(a)
        let b = span(b)
        return a.start <= b.end.addingTimeInterval(overlapSlack)
            && b.start <= a.end.addingTimeInterval(overlapSlack)
    }

    private static func contains(_ record: VisitRecord, _ date: Date) -> Bool {
        let span = span(record)
        return span.start <= date.addingTimeInterval(overlapSlack)
            && date <= span.end.addingTimeInterval(overlapSlack)
    }

    /// The most recent stay at the place that matches `test`.
    private static func latestIndex(
        _ records: [VisitRecord], placeId: String, where test: (VisitRecord) -> Bool
    ) -> Int? {
        records.indices
            .filter { records[$0].placeId == placeId && test(records[$0]) }
            .max { (records[$0].arrival ?? .distantPast) < (records[$1].arrival ?? .distantPast) }
    }

    /// Entering a named place's region.
    static func enter(_ place: NamedPlace, at date: Date, into records: [VisitRecord]) -> [VisitRecord] {
        var records = records
        // Still there: a repeated entry, or the exit never arrived.
        if latestIndex(
            records, placeId: place.id,
            where: { $0.isRegionStay && $0.departure == nil && contains($0, date) }) != nil
        {
            return records
        }
        // Back within a few minutes of leaving: the same stay.
        if let index = latestIndex(
            records, placeId: place.id, where: { $0.isRegionStay && leftJustBefore($0, date) })
        {
            records[index].departure = nil
            return records
        }
        // A visit already recorded there: region events update it from now on.
        if let index = latestIndex(records, placeId: place.id, where: { !$0.isRegionStay && contains($0, date) }) {
            records[index].fromRegion = true
            records[index].departure = nil
            if records[index].arrival == nil { records[index].arrival = date }
            return records
        }
        records.append(newStay(place, arrival: date, departure: nil))
        return records
    }

    /// Leaving a named place's region.
    static func exit(_ place: NamedPlace, at date: Date, into records: [VisitRecord]) -> [VisitRecord] {
        var records = records
        if let index = latestIndex(records, placeId: place.id, where: { contains($0, date) }) {
            if let arrival = records[index].arrival, arrival > date { return records }
            records[index].departure = date
            records[index].fromRegion = true
            return records
        }
        // Already inside when monitoring began: the arrival isn't known.
        records.append(newStay(place, arrival: nil, departure: date))
        return records
    }

    private static func leftJustBefore(_ record: VisitRecord, _ date: Date) -> Bool {
        guard let departure = record.departure else { return false }
        let gap = date.timeIntervalSince(departure)
        return gap >= -overlapSlack && gap <= reentrySeconds
    }

    private static func newStay(_ place: NamedPlace, arrival: Date?, departure: Date?) -> VisitRecord {
        VisitRecord(
            id: stayId(placeId: place.id, at: arrival ?? departure ?? Date()),
            arrival: arrival, departure: departure,
            latitude: place.latitude, longitude: place.longitude, accuracy: place.radius,
            address: place.address, placeId: place.id, namedPlace: place.name, fromRegion: true)
    }

    /// Names a `CLVisit` after the named place it falls in, if any.
    static func named(_ visit: VisitRecord, places: [NamedPlace]) -> VisitRecord {
        guard visit.placeId == nil,
            let place = PlaceMatching.place(
                atLatitude: visit.latitude, longitude: visit.longitude, in: places)
        else { return visit }
        var visit = visit
        visit.placeId = place.id
        visit.namedPlace = place.name
        return visit
    }

    /// Folds a visit into a region stay at the same place and time. Returns nil when no
    /// region stay covers it.
    static func absorb(_ visit: VisitRecord, into records: [VisitRecord]) -> [VisitRecord]? {
        guard let placeId = visit.placeId,
            let index = latestIndex(
                records, placeId: placeId,
                where: { $0.isRegionStay && overlaps($0, visit) })
        else { return nil }
        var records = records
        var stay = records[index]
        // The region's own crossings are more precise; the visit fills what's missing.
        if stay.arrival == nil { stay.arrival = visit.arrival }
        if stay.departure == nil, let departure = visit.departure,
            departure > (stay.arrival ?? .distantPast)
        {
            stay.departure = departure
        }
        if stay.address == nil, stay.street == nil {
            stay.address = visit.address
            stay.street = visit.street
            stay.placeName = visit.placeName
        }
        records[index] = stay
        return records
    }

    /// Adds a `CLVisit`: named after its place, merged into a region stay that covers it,
    /// otherwise added or merged as a plain visit.
    static func add(_ visit: VisitRecord, places: [NamedPlace], into records: [VisitRecord])
        -> [VisitRecord]
    {
        let visit = named(visit, places: places)
        // The visit's own earlier report (its arrival, now with the departure).
        if let index = records.firstIndex(where: { LocationMapping.isSameVisit($0, visit) }),
            !records[index].isRegionStay
        {
            return LocationMapping.merge(visit, into: records)
        }
        return absorb(visit, into: records) ?? LocationMapping.merge(visit, into: records)
    }

    /// After the named places change: names visits recorded before, and folds the ones a
    /// region stay already covers into it. Returns the records and the ids folded away.
    static func apply(_ places: [NamedPlace], to records: [VisitRecord]) -> (
        records: [VisitRecord], removed: [String]
    ) {
        var records = records
        var removed: [String] = []
        for visit in records where !visit.isRegionStay && visit.placeId == nil {
            let named = named(visit, places: places)
            guard named.placeId != nil else { continue }
            if let absorbed = absorb(named, into: records) {
                records = absorbed.filter { $0.id != visit.id }
                removed.append(visit.id)
            } else if let index = records.firstIndex(where: { $0.id == visit.id }) {
                records[index] = named
            }
        }
        return (records, removed)
    }
}
