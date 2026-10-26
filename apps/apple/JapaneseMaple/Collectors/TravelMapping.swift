//
//  TravelMapping.swift
//  JapaneseMaple
//
//  Driving time to upcoming events, for "time to leave" reminders. The Mac uploads the
//  calendar; the server lists the next few hours of events that have a location
//  (`GET /api/device-data/upcoming`); the iPhone works out how long the drive is from
//  where it is now and uploads that (`POST /api/device-data/travel`).
//
//  These are the pure decisions: which events need a new estimate, and the upload.
//  Pure and platform-neutral so it can be tested on the Mac.
//

import Foundation

/// An upcoming calendar event with a location. Times are seconds since 1970.
nonisolated struct UpcomingEvent: Codable, Equatable, Sendable {
    var id: String
    var title: String?
    var location: String
    var start: Double
    var end: Double?
}

/// One estimate as the server takes it.
nonisolated struct TravelEstimate: Codable, Equatable, Sendable {
    var eventId: String
    /// Driving minutes from where the phone is now.
    var minutes: Int
    /// A named place ("Home") or a short address.
    var origin: String?
    /// ISO 8601.
    var computedAt: String
}

nonisolated struct TravelUpload: Codable, Equatable, Sendable {
    var deviceId: String
    var estimates: [TravelEstimate]
}

/// What the phone last worked out for an event, so it isn't recomputed every pass.
nonisolated struct TravelRecord: Codable, Equatable, Sendable {
    var eventId: String
    var seconds: Double
    var origin: String?
    var computedAt: Date
    /// Where the phone was when it computed this.
    var latitude: Double
    var longitude: Double
}

/// A geocoded event location. No coordinates: it didn't geocode.
nonisolated struct GeocodedLocation: Codable, Equatable, Sendable {
    var latitude: Double?
    var longitude: Double?
    var at: Date
}

nonisolated struct TravelState: Codable, Equatable, Sendable {
    /// The last estimate per event id.
    var estimates: [String: TravelRecord] = [:]
    /// Event locations by `TravelPlanner.locationKey(_:)`.
    var geocoded: [String: GeocodedLocation] = [:]
    /// The last pass that finished: events fetched and estimates uploaded.
    var lastUpdate: Date?

    /// Forgets events that have started and geocodes nobody needs any more.
    mutating func prune(events: [UpcomingEvent], now: Date) {
        let live = Set(events.map(\.id))
        estimates = estimates.filter { live.contains($0.key) }
        let keep = Set(events.map { TravelPlanner.locationKey($0.location) })
        geocoded = geocoded.filter {
            keep.contains($0.key)
                || now.timeIntervalSince($0.value.at) < TravelPlanner.geocodeCacheSeconds
        }
    }
}

nonisolated enum TravelPlanner {
    static let horizonHours = 6
    static var horizon: TimeInterval { Double(horizonHours) * 3600 }
    /// An estimate this fresh is kept unless the phone moved.
    static let maxEstimateAge: TimeInterval = 15 * 60
    static let movedMeters: Double = 1_000
    /// A location that didn't geocode is tried again after this long.
    static let geocodeRetrySeconds: TimeInterval = 6 * 3600
    /// Geocodes for locations no longer upcoming are kept this long.
    static let geocodeCacheSeconds: TimeInterval = 7 * 86_400
    static let maxEstimatesPerUpload = 50
    static let maxOriginLength = 200
    static let maxMinutes = 24 * 60

    /// Same text, same place: "  1 Main St " and "1 main st" share a geocode.
    static func locationKey(_ location: String) -> String {
        location.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            .split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    /// Events starting within the horizon that haven't started yet.
    static func upcoming(_ events: [UpcomingEvent], now: Date) -> [UpcomingEvent] {
        let now = now.timeIntervalSince1970
        return events.filter {
            $0.start > now && $0.start <= now + horizon
                && !$0.location.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    /// The events that need a new estimate from here: upcoming, and with no estimate,
    /// one older than 15 minutes, or one made more than 1 km away.
    static func needingEstimate(
        _ events: [UpcomingEvent], previous: [String: TravelRecord], now: Date,
        latitude: Double, longitude: Double
    ) -> [UpcomingEvent] {
        upcoming(events, now: now).filter { event in
            guard let last = previous[event.id] else { return true }
            let age = now.timeIntervalSince(last.computedAt)
            let moved = LocationMapping.distanceMeters(
                last.latitude, last.longitude, latitude, longitude)
            return age >= maxEstimateAge || age < 0 || moved > movedMeters
        }
    }

    /// Whether a cached geocode can be used: found, or failed recently enough not to retry.
    static func cachedGeocode(_ cached: GeocodedLocation?, now: Date) -> GeocodedLocation? {
        guard let cached else { return nil }
        if cached.latitude != nil { return cached }
        return now.timeIntervalSince(cached.at) < geocodeRetrySeconds ? cached : nil
    }

    /// Where the drive starts: the named place you're at, otherwise a short address.
    static func origin(place: NamedPlace?, street: String?, locality: String?) -> String? {
        if let place { return String(place.name.prefix(maxOriginLength)) }
        let parts = [street, locality]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        return parts.isEmpty ? nil : String(parts.joined(separator: ", ").prefix(maxOriginLength))
    }

    static func minutes(_ seconds: Double) -> Int {
        min(max(Int((seconds / 60).rounded()), 0), maxMinutes)
    }

    static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    /// The upload bodies for these estimates, at most 50 per request.
    static func uploads(deviceId: String, records: [TravelRecord]) -> [TravelUpload] {
        records
            .sorted { $0.eventId < $1.eventId }
            .map {
                TravelEstimate(
                    eventId: $0.eventId, minutes: minutes($0.seconds),
                    origin: $0.origin.map { String($0.prefix(maxOriginLength)) },
                    computedAt: iso($0.computedAt))
            }
            .chunked(maxEstimatesPerUpload)
            .map { TravelUpload(deviceId: deviceId, estimates: $0) }
    }
}
