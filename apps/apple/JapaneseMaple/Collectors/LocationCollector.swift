//
//  LocationCollector.swift
//  JapaneseMaple
//
//  Places and visits on the iPhone. Uses Apple's battery-friendly visit tracking
//  (`startMonitoringVisits`), never continuous GPS. Each visit is uploaded when you
//  arrive and again when you leave: the server treats the latest open visit as your
//  current place.
//
//  iOS relaunches the app in the background to deliver visits, so the collector is
//  started from the app delegate at launch (see CollectorsHost.resume()).
//

#if os(iOS)
import CoreLocation
import Foundation
import UIKit

@MainActor
final class LocationCollector: NSObject, CLLocationManagerDelegate {
    static let maxGeocodeAttempts = 3
    static let retentionDays = 31

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

    private let client: DeviceDataClient
    private let manager = CLLocationManager()
    private let geocoder = CLGeocoder()
    private let file = CollectorStateFile(name: "location")
    private(set) var state: CollectorState
    private var isMonitoring = false
    private var authorizationWaiters: [CheckedContinuation<Void, Never>] = []
    private var flushing: Task<Void, Never>?
    private var flushAgain = false

    init(client: DeviceDataClient) {
        self.client = client
        self.state = file.load()
        super.init()
        manager.delegate = self
    }

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
            self.onChange()
        }
    }

    // MARK: - Collecting

    func start() {
        guard !isMonitoring else { return }
        isMonitoring = true
        manager.startMonitoringVisits()
        Task { await flush() }
    }

    func stop() {
        guard isMonitoring else { return }
        isMonitoring = false
        manager.stopMonitoringVisits()
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
        state.visits = LocationMapping.merge(visit, into: state.visits)
        file.save(state)
        onChange()
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
