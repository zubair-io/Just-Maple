//
//  CollectorMapping.swift
//  JapaneseMaple
//
//  Turns what the iPhone sees (a visit to a place, a day of Health totals, a workout)
//  into the `DeviceItem`s the server stores. Pure and platform-neutral so it can be
//  tested on the Mac; the readers that call it live behind `#if os(iOS)`.
//

import Foundation

// MARK: - Shared helpers

nonisolated enum CollectorFormat {
    /// English text for bots and search; fixed so bodies don't change with the phone's locale.
    static let locale = Locale(identifier: "en_US_POSIX")

    private static func formatter(_ format: String, _ calendar: Calendar) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.amSymbol = "am"
        formatter.pmSymbol = "pm"
        formatter.dateFormat = format
        return formatter
    }

    /// "2:10 pm"
    static func time(_ date: Date, _ calendar: Calendar) -> String {
        formatter("h:mm a", calendar).string(from: date)
    }

    /// "Sat Oct 24"
    static func day(_ date: Date, _ calendar: Calendar) -> String {
        formatter("EEE MMM d", calendar).string(from: date)
    }

    /// "2026-10-24"
    static func dayKey(_ date: Date, _ calendar: Calendar) -> String {
        formatter("yyyy-MM-dd", calendar).string(from: date)
    }

    /// ISO 8601 with the local offset, so bots read local times.
    static func iso(_ date: Date, _ calendar: Calendar) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.timeZone = calendar.timeZone
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    /// "8,432"
    static func count(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.numberStyle = .decimal
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value.rounded())) ?? String(Int(value.rounded()))
    }

    /// "7h 10m", "42m"
    static func hoursMinutes(_ seconds: Double) -> String {
        let minutes = Int((seconds / 60).rounded())
        let hours = minutes / 60
        return hours > 0 ? "\(hours)h \(minutes % 60)m" : "\(minutes)m"
    }

    /// "32 min", "1h 5m"
    static func duration(_ seconds: Double) -> String {
        let minutes = Int((seconds / 60).rounded())
        return minutes >= 60 ? hoursMinutes(seconds) : "\(minutes) min"
    }

    /// "5.2 km"
    static func distance(_ meters: Double) -> String {
        meters >= 1_000
            ? String(format: "%.1f km", locale: locale, meters / 1_000)
            : "\(Int(meters.rounded())) m"
    }

    static func rounded(_ value: Double, _ places: Int) -> Double {
        let scale = pow(10, Double(places))
        return (value * scale).rounded() / scale
    }
}

nonisolated enum CollectorRevision {
    /// A short, stable fingerprint (FNV-1a) of everything the item shows. Same content,
    /// same revision, so unchanged items aren't uploaded again.
    static func of(_ item: DeviceItem) -> String {
        var copy = item
        copy.revision = ""
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        let data = (try? encoder.encode(copy)) ?? Data()
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in data {
            hash ^= UInt64(byte)
            hash = hash &* 0x100_0000_01b3
        }
        return String(hash, radix: 16)
    }

    static func stamped(_ item: DeviceItem) -> DeviceItem {
        var item = item
        item.revision = of(item)
        return item
    }
}

// MARK: - Location

/// One visit as CoreLocation reported it, plus the place name once it's known.
nonisolated struct VisitRecord: Codable, Equatable, Sendable {
    /// Fixed when the visit is first seen, so the arrival and departure update one item.
    var id: String
    var arrival: Date?
    var departure: Date?
    var latitude: Double
    var longitude: Double
    var accuracy: Double
    var placeName: String?
    var address: String?
    var street: String?
    /// Reverse geocoding is retried a few times (it needs the network), then given up.
    var geocodeAttempts: Int = 0

    var isGeocoded: Bool { placeName != nil || address != nil }
}

nonisolated enum LocationMapping {
    /// Arrivals within this many seconds of each other, at nearly the same spot, are the
    /// same visit (CoreLocation reports the arrival again with the departure).
    static let sameVisitSeconds: TimeInterval = 120
    static let sameVisitMeters: Double = 500

    static func visitId(arrival: Date, latitude: Double, longitude: Double) -> String {
        let epoch = Int(arrival.timeIntervalSince1970.rounded())
        let lat = String(format: "%.3f", locale: CollectorFormat.locale, latitude)
        let lon = String(format: "%.3f", locale: CollectorFormat.locale, longitude)
        return "location:visit:\(epoch):\(lat),\(lon)"
    }

    /// Builds a record from CoreLocation's values. `CLVisit` uses `distantPast` for an
    /// unknown arrival and `distantFuture` while you're still there.
    static func record(
        arrival: Date, departure: Date, latitude: Double, longitude: Double, accuracy: Double
    ) -> VisitRecord {
        let knownArrival = arrival == .distantPast ? nil : arrival
        let knownDeparture = departure == .distantFuture ? nil : departure
        let anchor = knownArrival ?? knownDeparture ?? Date()
        return VisitRecord(
            id: visitId(arrival: anchor, latitude: latitude, longitude: longitude),
            arrival: knownArrival, departure: knownDeparture,
            latitude: latitude, longitude: longitude, accuracy: accuracy)
    }

    /// Adds a visit, or updates the matching earlier one (its departure was just learned).
    /// The earlier record keeps its id and place name.
    static func merge(_ visit: VisitRecord, into records: [VisitRecord]) -> [VisitRecord] {
        var records = records
        if let index = records.firstIndex(where: { isSameVisit($0, visit) }) {
            var existing = records[index]
            existing.arrival = existing.arrival ?? visit.arrival
            existing.departure = visit.departure ?? existing.departure
            if visit.accuracy > 0, visit.accuracy < existing.accuracy || existing.accuracy <= 0 {
                existing.accuracy = visit.accuracy
            }
            records[index] = existing
        } else {
            records.append(visit)
        }
        return records
    }

    static func isSameVisit(_ a: VisitRecord, _ b: VisitRecord) -> Bool {
        if a.id == b.id { return true }
        guard let arrivalA = a.arrival, let arrivalB = b.arrival,
            abs(arrivalA.timeIntervalSince(arrivalB)) <= sameVisitSeconds
        else { return false }
        return distanceMeters(a.latitude, a.longitude, b.latitude, b.longitude) <= sameVisitMeters
    }

    /// Haversine distance, good enough to tell "same place" from "different place".
    static func distanceMeters(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double)
        -> Double
    {
        let radius = 6_371_000.0
        let dLat = (lat2 - lat1) * .pi / 180
        let dLon = (lon2 - lon1) * .pi / 180
        let a =
            sin(dLat / 2) * sin(dLat / 2)
            + cos(lat1 * .pi / 180) * cos(lat2 * .pi / 180) * sin(dLon / 2) * sin(dLon / 2)
        return radius * 2 * atan2(sqrt(a), sqrt(1 - a))
    }

    /// The place's name: a point of interest first, then the placemark's name, then the street.
    static func placeName(areasOfInterest: [String]?, name: String?, street: String?) -> String? {
        [areasOfInterest?.first, name, street]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty }
    }

    /// "12 Main St"
    static func street(subThoroughfare: String?, thoroughfare: String?) -> String? {
        let parts = [subThoroughfare, thoroughfare].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " ")
    }

    /// "12 Main St, Springfield, IL"
    static func address(street: String?, locality: String?, administrativeArea: String?) -> String? {
        let parts = [street, locality, administrativeArea].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }

    static func item(for visit: VisitRecord, calendar: Calendar = .current) -> DeviceItem {
        let coordinates = String(
            format: "%.4f, %.4f", locale: CollectorFormat.locale, visit.latitude, visit.longitude)
        let title = visit.placeName ?? visit.address ?? coordinates
        // Show the street in brackets unless it is the title already.
        let detail = [visit.street, visit.address].compactMap { $0 }.first { $0 != title }
        let place = detail.map { "\(title) (\($0))" } ?? title

        var body: String
        if let arrival = visit.arrival {
            body = "At \(place) on \(CollectorFormat.day(arrival, calendar)) from \(CollectorFormat.time(arrival, calendar))"
            if let departure = visit.departure {
                let sameDay = calendar.isDate(arrival, inSameDayAs: departure)
                body += " to "
                body += sameDay
                    ? CollectorFormat.time(departure, calendar)
                    : "\(CollectorFormat.day(departure, calendar)) \(CollectorFormat.time(departure, calendar))"
                body += " (\(CollectorFormat.duration(departure.timeIntervalSince(arrival))))"
            }
        } else if let departure = visit.departure {
            body = "Left \(place) on \(CollectorFormat.day(departure, calendar)) at \(CollectorFormat.time(departure, calendar))"
        } else {
            body = "At \(place)"
        }

        let occurredAt = visit.arrival ?? visit.departure ?? Date()
        var extra: [String: JSONValue] = [
            "lat": .number(CollectorFormat.rounded(visit.latitude, 5)),
            "lon": .number(CollectorFormat.rounded(visit.longitude, 5)),
            "accuracy": .number(CollectorFormat.rounded(visit.accuracy, 0)),
            "arrived": visit.arrival.map { .string(CollectorFormat.iso($0, calendar)) } ?? .null,
            "departed": visit.departure.map { .string(CollectorFormat.iso($0, calendar)) } ?? .null,
        ]
        if let name = visit.placeName { extra["place"] = .string(name) }

        return CollectorRevision.stamped(
            DeviceItem(
                id: visit.id, source: .location, revision: "",
                occurredAt: occurredAt.timeIntervalSince1970,
                endAt: visit.departure?.timeIntervalSince1970,
                title: title, body: body, location: visit.address ?? visit.street,
                extra: extra))
    }
}

// MARK: - Health

/// One workout as HealthKit reported it.
nonisolated struct WorkoutRecord: Codable, Equatable, Sendable {
    var uuid: String
    /// "Running", "Cycling", "Traditional Strength Training"
    var activity: String
    var start: Date
    var end: Date
    var duration: TimeInterval
    var energyKcal: Double?
    var distanceMeters: Double?
}

/// A day's Health totals. Missing values are types the user didn't share, or no data.
nonisolated struct HealthDay: Equatable, Sendable {
    /// Local midnight.
    var date: Date
    var steps: Double?
    var exerciseMinutes: Double?
    var activeEnergyKcal: Double?
    var restingHeartRate: Double?
    var sleep: HealthSleep?
    var workouts: [WorkoutRecord] = []

    var isEmpty: Bool {
        steps == nil && exerciseMinutes == nil && activeEnergyKcal == nil
            && restingHeartRate == nil && sleep == nil && workouts.isEmpty
    }
}

/// The night that ended on a day's morning.
nonisolated struct HealthSleep: Equatable, Sendable {
    var asleepSeconds: TimeInterval
    var bedtime: Date
    var wakeTime: Date
}

nonisolated enum HealthMapping {
    /// A night belongs to the day you wake up on: sleep ending between 6 pm the evening
    /// before and 6 pm that day.
    static let nightBoundaryHour = 18

    /// Total time asleep (overlapping samples from the watch and phone counted once),
    /// with the first bedtime and last wake time in that window.
    static func sleep(
        intervals: [(start: Date, end: Date)], day: Date, calendar: Calendar = .current
    ) -> HealthSleep? {
        let midnight = calendar.startOfDay(for: day)
        guard
            let windowEnd = calendar.date(byAdding: .hour, value: nightBoundaryHour, to: midnight),
            let windowStart = calendar.date(byAdding: .day, value: -1, to: windowEnd)
        else { return nil }
        let night = intervals
            .filter { $0.end > windowStart && $0.end <= windowEnd && $0.end > $0.start }
            .sorted { $0.start < $1.start }
        guard let first = night.first else { return nil }

        var total: TimeInterval = 0
        var current = first
        var wake = first.end
        for interval in night.dropFirst() {
            wake = max(wake, interval.end)
            if interval.start <= current.end {
                current.end = max(current.end, interval.end)
            } else {
                total += current.end.timeIntervalSince(current.start)
                current = interval
            }
        }
        total += current.end.timeIntervalSince(current.start)
        return HealthSleep(asleepSeconds: total, bedtime: first.start, wakeTime: wake)
    }

    static func dayId(_ date: Date, calendar: Calendar = .current) -> String {
        "health:day:\(CollectorFormat.dayKey(date, calendar))"
    }

    static func dayItem(for day: HealthDay, calendar: Calendar = .current) -> DeviceItem {
        let midnight = calendar.startOfDay(for: day.date)
        var parts: [String] = []
        var extra: [String: JSONValue] = ["date": .string(CollectorFormat.dayKey(midnight, calendar))]

        if let steps = day.steps {
            parts.append("Steps \(CollectorFormat.count(steps))")
            extra["steps"] = .number(steps.rounded())
        }
        if let minutes = day.exerciseMinutes {
            parts.append("Exercise \(Int(minutes.rounded())) min")
            extra["exerciseMinutes"] = .number(minutes.rounded())
        }
        if let energy = day.activeEnergyKcal {
            parts.append("Active energy \(CollectorFormat.count(energy)) kcal")
            extra["activeEnergyKcal"] = .number(energy.rounded())
        }
        if let sleep = day.sleep {
            let span = "\(CollectorFormat.time(sleep.bedtime, calendar))–\(CollectorFormat.time(sleep.wakeTime, calendar))"
            parts.append("Sleep \(CollectorFormat.hoursMinutes(sleep.asleepSeconds)) (\(span))")
            extra["sleepMinutes"] = .number((sleep.asleepSeconds / 60).rounded())
            extra["bedtime"] = .string(CollectorFormat.iso(sleep.bedtime, calendar))
            extra["wakeTime"] = .string(CollectorFormat.iso(sleep.wakeTime, calendar))
        }
        if let heartRate = day.restingHeartRate {
            parts.append("Resting HR \(Int(heartRate.rounded()))")
            extra["restingHeartRate"] = .number(heartRate.rounded())
        }
        let workouts = day.workouts.sorted { $0.start < $1.start }
        if !workouts.isEmpty {
            let list = workouts.map {
                "\($0.activity) \(CollectorFormat.duration($0.duration)) at \(CollectorFormat.time($0.start, calendar))"
            }
            parts.append("Workouts: \(list.joined(separator: ", "))")
            extra["workouts"] = .array(
                workouts.map {
                    .object([
                        "type": .string($0.activity),
                        "start": .string(CollectorFormat.iso($0.start, calendar)),
                        "durationMinutes": .number(($0.duration / 60).rounded()),
                    ])
                })
        }

        return CollectorRevision.stamped(
            DeviceItem(
                id: dayId(midnight, calendar: calendar), source: .health, revision: "",
                occurredAt: midnight.timeIntervalSince1970,
                title: "Health — \(CollectorFormat.day(midnight, calendar))",
                body: parts.isEmpty ? "No Health data" : parts.joined(separator: " · "),
                extra: extra))
    }

    static func workoutItem(for workout: WorkoutRecord, calendar: Calendar = .current) -> DeviceItem {
        let duration = CollectorFormat.duration(workout.duration)
        var details = [
            "\(workout.activity) for \(duration) on \(CollectorFormat.day(workout.start, calendar))"
                + " from \(CollectorFormat.time(workout.start, calendar)) to \(CollectorFormat.time(workout.end, calendar))"
        ]
        var extra: [String: JSONValue] = [
            "type": .string(workout.activity),
            "durationMinutes": .number(CollectorFormat.rounded(workout.duration / 60, 1)),
            "energyKcal": .null,
            "distanceMeters": .null,
        ]
        if let meters = workout.distanceMeters, meters > 0 {
            details.append(CollectorFormat.distance(meters))
            extra["distanceMeters"] = .number(meters.rounded())
        }
        if let energy = workout.energyKcal, energy > 0 {
            details.append("\(CollectorFormat.count(energy)) kcal")
            extra["energyKcal"] = .number(energy.rounded())
        }
        return CollectorRevision.stamped(
            DeviceItem(
                id: "health:workout:\(workout.uuid.lowercased())", source: .health, revision: "",
                occurredAt: workout.start.timeIntervalSince1970,
                endAt: workout.end.timeIntervalSince1970,
                title: "\(workout.activity) · \(duration)",
                body: details.joined(separator: " · "),
                extra: extra))
    }
}

// MARK: - Embedding

nonisolated enum CollectorEmbedding {
    static func text(for item: DeviceItem) -> String {
        [item.title, item.location, item.body]
            .compactMap { $0?.isEmpty == false ? $0 : nil }
            .joined(separator: "\n")
    }

    /// Vectors for the items, embedded on the device. Empty when the model isn't available.
    static func vectors(for items: [DeviceItem]) -> [DeviceItemVectors] {
        guard DeviceEmbedding.isAvailable else { return [] }
        return items.compactMap { item in
            let vectors = DeviceEmbedding.vectors(for: text(for: item))
            guard !vectors.isEmpty else { return nil }
            return DeviceItemVectors(
                id: item.id, revision: item.revision, dimensions: DeviceEmbedding.dimensions,
                vectors: DeviceEmbedding.base64(vectors))
        }
    }
}
