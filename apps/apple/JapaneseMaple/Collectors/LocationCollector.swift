//
//  LocationCollector.swift
//  JapaneseMaple
//
//  Places and visits on the iPhone. Uses Apple's battery-friendly visit tracking
//  (`startMonitoringVisits`), never continuous GPS. Each visit is uploaded when you
//  arrive and again when you leave: the server treats the latest open visit as your
//  current place.
//
//  It also watches the places the user named on the web (Home, Work, School): entering
//  or leaving one records a stay titled with the place name, and a visit inside a named
//  place is titled with it too (see PlacesMapping.swift).
//
//  iOS relaunches the app in the background to deliver visits and region crossings, so
//  the collector is started from the app delegate at launch (see CollectorsHost.resume()).
//

#if os(iOS)
import CoreLocation
import Foundation
import UIKit

@MainActor
final class LocationCollector: NSObject, CLLocationManagerDelegate {
    static let maxGeocodeAttempts = 3
    static let retentionDays = 31
    /// Named places are fetched again at most this often, unless something asks sooner.
    static let placesRefreshInterval: TimeInterval = 3 * 60 * 60
    /// A forced refresh (launch, foreground, registration) still skips if this recent.
    static let placesMinimumInterval: TimeInterval = 60

    /// Called before each upload (registers the device); throws to skip the upload.
    /// Registers if needed and says whether this device is the one collecting this
    /// source; if another device is, items stay queued instead of being marked uploaded.
    var beforeUpload: () async throws -> Bool = { true }

    /// Another device took this source over and the server dropped this phone's copy:
    /// forget what was uploaded, so it all goes up again if the source comes back.
    func uploadsMovedAway() {
        state.uploaded = [:]
        state.pendingRemovals = []
        file.save(state)
    }
    /// Called when the permission or queue changes.
    var onChange: () -> Void = {}
    /// Called after a visit or a named-place crossing: where you are may have changed.
    var onMoved: () -> Void = {}

    private let client: DeviceDataClient
    private let manager = CLLocationManager()
    private let geocoder = CLGeocoder()
    private let file = CollectorStateFile(name: "location")
    private(set) var state: CollectorState
    private var isMonitoring = false
    private var authorizationWaiters: [CheckedContinuation<Void, Never>] = []
    private var flushing: Task<Void, Never>?
    private var flushAgain = false
    private let placesFile = CollectorJSONFile<NamedPlacesCache>(name: "places")
    private(set) var placesCache: NamedPlacesCache
    private var refreshingPlaces: Task<Void, Never>?

    init(client: DeviceDataClient) {
        self.client = client
        self.state = file.load()
        self.placesCache = placesFile.load() ?? NamedPlacesCache()
        super.init()
        manager.delegate = self
    }

    /// The user's named places, as last fetched.
    var places: [NamedPlace] { placesCache.places }

    // MARK: - Permission

    var authorizationStatus: CLAuthorizationStatus { manager.authorizationStatus }

    /// "Always" lets visits arrive while the app is closed.
    var isAuthorized: Bool { authorizationStatus == .authorizedAlways }

    /// Visits are still recorded while the app is open with "While Using".
    var canCollect: Bool {
        authorizationStatus == .authorizedAlways || authorizationStatus == .authorizedWhenInUse
    }

    var permission: String {
        switch authorizationStatus {
        case .authorizedAlways: "always"
        case .authorizedWhenInUse: "whenInUse"
        case .denied: "denied"
        case .restricted: "restricted"
        case .notDetermined: "notDetermined"
        @unknown default: "unknown"
        }
    }

    /// Asks for "Always". The first time, iOS shows "Allow While Using" and later offers
    /// to change it to "Always" after a visit arrives in the background. Asking again from
    /// "While Using" shows the upgrade prompt once; iOS stays silent after that.
    func requestPermission() async {
        let status = authorizationStatus
        guard status == .notDetermined || status == .authorizedWhenInUse else { return }
        manager.requestAlwaysAuthorization()
        // The first prompt always answers. The upgrade prompt may never show, so don't wait long.
        let timeout: Duration = status == .notDetermined ? .seconds(300) : .seconds(20)
        await withCheckedContinuation { continuation in
            authorizationWaiters.append(continuation)
            Task { @MainActor in
                try? await Task.sleep(for: timeout)
                self.resumeAuthorizationWaiters()
            }
        }
    }

    private func resumeAuthorizationWaiters() {
        let waiters = authorizationWaiters
        authorizationWaiters = []
        waiters.forEach { $0.resume() }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            self.resumeAuthorizationWaiters()
            self.updateRegions()
            self.onChange()
        }
    }

    // MARK: - Collecting

    func start() {
        guard !isMonitoring else { return }
        isMonitoring = true
        manager.startMonitoringVisits()
        updateRegions()
        Task { await flush() }
    }

    func stop() {
        guard isMonitoring else { return }
        isMonitoring = false
        manager.stopMonitoringVisits()
        updateRegions()
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didVisit visit: CLVisit) {
        let record = LocationMapping.record(
            arrival: visit.arrivalDate, departure: visit.departureDate,
            latitude: visit.coordinate.latitude, longitude: visit.coordinate.longitude,
            accuracy: visit.horizontalAccuracy)
        Task { @MainActor in await self.record(record) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        print("[Collectors] Location error: \(error.localizedDescription)")
    }

    func record(_ visit: VisitRecord) async {
        state.visits = PlaceStays.add(visit, places: places, into: state.visits)
        file.save(state)
        updateRegions()
        onChange()
        onMoved()
        await flush()
    }

    // MARK: - Named places

    /// Fetches the named places if they're older than 3 hours, or with `force` (launch,
    /// foreground, registration) unless they were fetched in the last minute.
    func refreshPlaces(force: Bool = false) async {
        if let refreshingPlaces {
            await refreshingPlaces.value
            return
        }
        let maxAge = force ? Self.placesMinimumInterval : Self.placesRefreshInterval
        guard !placesCache.isFresh(maxAge: maxAge) else { return }
        let task = Task { @MainActor in
            do {
                let places = try await self.client.places()
                self.placesCache = NamedPlacesCache(places: places, fetchedAt: Date())
                self.placesFile.save(self.placesCache)
                self.applyPlaces()
            } catch {
                print("[Collectors] Couldn't fetch named places: \(error.localizedDescription)")
            }
        }
        refreshingPlaces = task
        await task.value
        refreshingPlaces = nil
    }

    /// Names visits recorded before the places were known, and watches the nearest ones.
    private func applyPlaces() {
        let applied = PlaceStays.apply(places, to: state.visits)
        if applied.records != state.visits {
            state.visits = applied.records
            state.enqueueRemovals(applied.removed)
            file.save(state)
            // Not awaited: this can run from inside an upload (after registering).
            Task { await self.flush() }
        }
        updateRegions()
        onChange()
    }

    /// Watches the 20 named places nearest to where the phone last was. Region
    /// monitoring needs "Always"; without it, or when stopped, nothing is watched.
    private func updateRegions() {
        let ours = manager.monitoredRegions.filter {
            PlaceMatching.placeId(fromRegion: $0.identifier) != nil
        }
        guard isMonitoring, isAuthorized,
            CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self)
        else {
            ours.forEach { manager.stopMonitoring(for: $0) }
            return
        }
        let here = manager.location?.coordinate
        let wanted = PlaceMatching.regionsToMonitor(
            places, nearLatitude: here?.latitude, longitude: here?.longitude)
        let wantedIds = Set(wanted.map(PlaceMatching.regionId))
        for region in ours where !wantedIds.contains(region.identifier) {
            manager.stopMonitoring(for: region)
        }
        var current: [String: CLCircularRegion] = [:]
        for case let region as CLCircularRegion in ours { current[region.identifier] = region }
        for place in wanted {
            let id = PlaceMatching.regionId(place)
            let radius = min(place.radius, manager.maximumRegionMonitoringDistance)
            let center = CLLocationCoordinate2D(latitude: place.latitude, longitude: place.longitude)
            if let existing = current[id], existing.radius == radius,
                existing.center.latitude == center.latitude,
                existing.center.longitude == center.longitude
            {
                continue
            }
            let region = CLCircularRegion(center: center, radius: radius, identifier: id)
            region.notifyOnEntry = true
            region.notifyOnExit = true
            manager.startMonitoring(for: region)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        let identifier = region.identifier
        let date = Date()
        Task { @MainActor in await self.crossed(identifier, entered: true, at: date) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        let identifier = region.identifier
        let date = Date()
        Task { @MainActor in await self.crossed(identifier, entered: false, at: date) }
    }

    nonisolated func locationManager(
        _ manager: CLLocationManager, monitoringDidFailFor region: CLRegion?, withError error: Error
    ) {
        print("[Collectors] Can't watch \(region?.identifier ?? "a place"): \(error.localizedDescription)")
    }

    private func crossed(_ identifier: String, entered: Bool, at date: Date) async {
        guard let placeId = PlaceMatching.placeId(fromRegion: identifier) else { return }
        guard let place = places.first(where: { $0.id == placeId }) else {
            // The place was deleted on the web since.
            updateRegions()
            return
        }
        state.visits =
            entered
            ? PlaceStays.enter(place, at: date, into: state.visits)
            : PlaceStays.exit(place, at: date, into: state.visits)
        file.save(state)
        onChange()
        onMoved()
        await flush()
    }

    /// Visits the server doesn't have yet in their latest form.
    var pendingCount: Int {
        state.pendingRemovals.count
            + state.visits.filter {
                state.uploaded[$0.id] != LocationMapping.item(for: $0).revision
            }.count
    }

    // MARK: - Upload

    /// Names new places, queues changed visits and uploads the queue. Runs one pass at a
    /// time; a call during a pass waits for one more pass.
    func flush() async {
        if let flushing {
            flushAgain = true
            await flushing.value
            return
        }
        let task = Task { @MainActor in
            repeat {
                self.flushAgain = false
                await self.flushOnce()
            } while self.flushAgain
        }
        flushing = task
        await withBackgroundTime("Upload visits") { await task.value }
        flushing = nil
    }

    private func flushOnce() async {
        await refreshPlaces()
        await geocodeVisits()
        state.pruneVisits(before: Date().addingTimeInterval(-Double(Self.retentionDays) * 86_400))
        state.enqueue(state.visits.map { LocationMapping.item(for: $0) })
        file.save(state)
        guard state.pendingCount > 0 else { return }
        do {
            guard try await beforeUpload() else { return }
            state = try await CollectorUploader.flush(state, client: client)
            file.save(state)
        } catch {
            print("[Collectors] Visits stay queued: \(error.localizedDescription)")
        }
        onChange()
    }

    private func geocodeVisits() async {
        for index in state.visits.indices
        where !state.visits[index].isGeocoded
            && state.visits[index].geocodeAttempts < Self.maxGeocodeAttempts
        {
            let visit = state.visits[index]
            state.visits[index].geocodeAttempts += 1
            let location = CLLocation(latitude: visit.latitude, longitude: visit.longitude)
            do {
                guard let placemark = try await geocoder.reverseGeocodeLocation(location).first
                else { continue }
                let street = LocationMapping.street(
                    subThoroughfare: placemark.subThoroughfare, thoroughfare: placemark.thoroughfare)
                state.visits[index].street = street
                state.visits[index].placeName = LocationMapping.placeName(
                    areasOfInterest: placemark.areasOfInterest, name: placemark.name, street: street)
                state.visits[index].address = LocationMapping.address(
                    street: street, locality: placemark.locality,
                    administrativeArea: placemark.administrativeArea)
            } catch {
                // Offline or rate limited: try again next pass, then upload with coordinates.
                print("[Collectors] Couldn't name a place: \(error.localizedDescription)")
            }
        }
    }
}

/// Asks iOS for time to finish an upload after the app leaves the screen or was woken
/// in the background.
@MainActor
func withBackgroundTime(_ name: String, _ work: () async -> Void) async {
    final class Token { var id = UIBackgroundTaskIdentifier.invalid }
    let token = Token()
    token.id = UIApplication.shared.beginBackgroundTask(withName: name) {
        // Out of time: the queue keeps whatever didn't upload.
        UIApplication.shared.endBackgroundTask(token.id)
        token.id = .invalid
    }
    await work()
    if token.id != .invalid {
        UIApplication.shared.endBackgroundTask(token.id)
        token.id = .invalid
    }
}
#endif
