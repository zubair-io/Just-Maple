//
//  TravelCollector.swift
//  JapaneseMaple
//
//  Driving time from where the phone is to the next few hours of calendar events, so
//  bots can say "time to leave". Runs while Places is on: when the app opens, after a
//  visit or a named-place crossing, and from a background refresh about every 15
//  minutes (iOS decides when).
//
//  Each pass:
//    1. fetches events with a location in the next 6 hours;
//    2. gets the phone's location once (`requestLocation`, never continuous updates);
//    3. geocodes each event's location (cached by its text);
//    4. asks Apple Maps for the driving time;
//    5. uploads the estimates, with the named place you're at as the origin.
//  Estimates under 15 minutes old are kept unless the phone moved more than 1 km.
//

#if os(iOS)
import CoreLocation
import Foundation
import MapKit

@MainActor
final class TravelCollector: NSObject, CLLocationManagerDelegate {
    /// A fix this recent is used instead of asking for a new one.
    static let recentFixSeconds: TimeInterval = 60
    static let locationTimeout: Duration = .seconds(30)

    /// Registers if needed and says whether this phone collects Places; throws to skip.
    var beforeUpload: () async throws -> Bool = { true }
    /// The named places, to name the origin ("Home").
    var places: () -> [NamedPlace] = { [] }
    var onChange: () -> Void = {}

    private let client: DeviceDataClient
    private let manager = CLLocationManager()
    private let geocoder = CLGeocoder()
    private let file = CollectorJSONFile<TravelState>(name: "travel")
    private(set) var state: TravelState
    private var running: Task<Void, Never>?
    private var runAgain = false
    private var locationWaiters: [UUID: CheckedContinuation<CLLocation?, Never>] = [:]

    init(client: DeviceDataClient) {
        self.client = client
        self.state = file.load() ?? TravelState()
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    var lastUpdate: Date? { state.lastUpdate }

    /// Runs one pass at a time; a call during a pass waits for one more pass.
    func update() async {
        if let running {
            runAgain = true
            await running.value
            return
        }
        let task = Task { @MainActor in
            repeat {
                self.runAgain = false
                await self.updateOnce()
            } while self.runAgain && !Task.isCancelled
        }
        running = task
        await withTaskCancellationHandler {
            await withBackgroundTime("Travel times") { await task.value }
        } onCancel: {
            task.cancel()
        }
        running = nil
    }

    private func updateOnce() async {
        let now = Date()
        let events: [UpcomingEvent]
        do {
            events = try await client.upcomingEvents(hours: TravelPlanner.horizonHours)
        } catch {
            print("[Collectors] Couldn't fetch upcoming events: \(error.localizedDescription)")
            return
        }
        state.prune(events: events, now: now)
        defer {
            file.save(state)
            onChange()
        }
        guard !TravelPlanner.upcoming(events, now: now).isEmpty else {
            state.lastUpdate = now
            return
        }
        do {
            guard try await beforeUpload() else { return }
        } catch {
            print("[Collectors] Travel times skipped: \(error.localizedDescription)")
            return
        }
        guard let here = await currentLocation() else {
            print("[Collectors] Travel times skipped: no current location")
            return
        }
        let due = TravelPlanner.needingEstimate(
            events, previous: state.estimates, now: now,
            latitude: here.coordinate.latitude, longitude: here.coordinate.longitude)
        guard !due.isEmpty else {
            state.lastUpdate = now
            return
        }

        let origin = await originName(here)
        var computed: [TravelRecord] = []
        for event in due {
            if Task.isCancelled { break }
            guard let destination = await geocode(event.location, near: here, now: now),
                let seconds = await drivingTime(from: here.coordinate, to: destination)
            else { continue }
            computed.append(
                TravelRecord(
                    eventId: event.id, seconds: seconds, origin: origin, computedAt: Date(),
                    latitude: here.coordinate.latitude, longitude: here.coordinate.longitude))
        }
        guard !computed.isEmpty else { return }
        do {
            for upload in TravelPlanner.uploads(deviceId: DeviceDataClient.deviceId, records: computed) {
                try await client.uploadTravel(upload)
            }
            for record in computed { state.estimates[record.eventId] = record }
            state.lastUpdate = Date()
        } catch {
            print("[Collectors] Travel times not uploaded: \(error.localizedDescription)")
        }
    }

    // MARK: - Where you are

    private func currentLocation() async -> CLLocation? {
        if let last = manager.location, last.horizontalAccuracy >= 0,
            -last.timestamp.timeIntervalSinceNow < Self.recentFixSeconds
        {
            return last
        }
        let status = manager.authorizationStatus
        guard status == .authorizedAlways || status == .authorizedWhenInUse else { return nil }
        // Cancelled (the background refresh ran out of time): give up with no location
        // instead of waiting out the timeout. Each waiter is resumed once: whoever takes
        // it out of `locationWaiters` first, all on the main actor.
        let id = UUID()
        return await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                guard !Task.isCancelled else {
                    continuation.resume(returning: nil)
                    return
                }
                let first = locationWaiters.isEmpty
                locationWaiters[id] = continuation
                guard first else { return }
                manager.requestLocation()
                Task { @MainActor in
                    try? await Task.sleep(for: Self.locationTimeout)
                    self.resumeLocationWaiters(nil)
                }
            }
        } onCancel: {
            Task { @MainActor in self.resumeLocationWaiter(id, nil) }
        }
    }

    private func resumeLocationWaiters(_ location: CLLocation?) {
        let waiters = locationWaiters
        locationWaiters = [:]
        waiters.values.forEach { $0.resume(returning: location) }
    }

    private func resumeLocationWaiter(_ id: UUID, _ location: CLLocation?) {
        locationWaiters.removeValue(forKey: id)?.resume(returning: location)
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let location = locations.last
        Task { @MainActor in self.resumeLocationWaiters(location) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        print("[Collectors] Couldn't get the current location: \(error.localizedDescription)")
        Task { @MainActor in self.resumeLocationWaiters(nil) }
    }

    /// The named place you're at, otherwise a short address.
    private func originName(_ here: CLLocation) async -> String? {
        if let place = PlaceMatching.place(
            atLatitude: here.coordinate.latitude, longitude: here.coordinate.longitude, in: places())
        {
            return TravelPlanner.origin(place: place, street: nil, locality: nil)
        }
        guard let placemark = try? await geocoder.reverseGeocodeLocation(here).first else { return nil }
        return TravelPlanner.origin(
            place: nil,
            street: LocationMapping.street(
                subThoroughfare: placemark.subThoroughfare, thoroughfare: placemark.thoroughfare),
            locality: placemark.locality)
    }

    // MARK: - Where you're going

    /// The event location's coordinates, cached by its text. A location that doesn't
    /// geocode is remembered and tried again later; a network error isn't remembered.
    private func geocode(_ location: String, near here: CLLocation, now: Date) async
        -> CLLocationCoordinate2D?
    {
        let key = TravelPlanner.locationKey(location)
        if let cached = TravelPlanner.cachedGeocode(state.geocoded[key], now: now) {
            guard let latitude = cached.latitude, let longitude = cached.longitude else { return nil }
            return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
        }
        // Prefer matches near you: "Starbucks" means the nearby one.
        let nearby = CLCircularRegion(center: here.coordinate, radius: 100_000, identifier: "nearby")
        do {
            let placemarks = try await geocoder.geocodeAddressString(location, in: nearby)
            guard let coordinate = placemarks.first?.location?.coordinate else {
                state.geocoded[key] = GeocodedLocation(latitude: nil, longitude: nil, at: now)
                return nil
            }
            state.geocoded[key] = GeocodedLocation(
                latitude: coordinate.latitude, longitude: coordinate.longitude, at: now)
            return coordinate
        } catch let error as CLError where error.code == .geocodeFoundNoResult {
            state.geocoded[key] = GeocodedLocation(latitude: nil, longitude: nil, at: now)
            return nil
        } catch {
            print("[Collectors] Couldn't find \"\(location)\": \(error.localizedDescription)")
            return nil
        }
    }

    /// Apple Maps' driving time, in seconds, leaving now.
    private func drivingTime(from: CLLocationCoordinate2D, to: CLLocationCoordinate2D) async -> Double? {
        let request = MKDirections.Request()
        request.source = MKMapItem(placemark: MKPlacemark(coordinate: from))
        request.destination = MKMapItem(placemark: MKPlacemark(coordinate: to))
        request.transportType = .automobile
        request.departureDate = Date()
        do {
            return try await MKDirections(request: request).calculateETA().expectedTravelTime
        } catch {
            print("[Collectors] No driving time: \(error.localizedDescription)")
            return nil
        }
    }
}
#endif
