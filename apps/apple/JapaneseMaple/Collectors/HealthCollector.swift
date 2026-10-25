//
//  HealthCollector.swift
//  JapaneseMaple
//
//  Health on the iPhone, read-only: one summary per day for the last 30 days (steps,
//  exercise, active energy, sleep, resting heart rate, workouts) and one item per
//  workout. HealthKit wakes the app when new data arrives (daily for summaries,
//  immediately for workouts), and the app refreshes when it comes to the foreground.
//
//  HealthKit never says which read types were allowed; a type the user didn't share
//  simply returns no data. So only what was granted is ever uploaded.
//

#if os(iOS)
import Foundation
import HealthKit

@MainActor
final class HealthCollector {
    static let days = 30
    /// Automatic refreshes (foreground) at most this often; observers and "Sync now" always run.
    static let minimumInterval: TimeInterval = 5 * 60

    var beforeUpload: () async throws -> Void = {}
    var onChange: () -> Void = {}

    private let client: DeviceDataClient
    private let store = HKHealthStore()
    private let file = CollectorStateFile(name: "health")
    private(set) var state: CollectorState
    private var observers: [HKObserverQuery] = []
    private var syncing: Task<Void, Never>?
    private var syncAgain = false
    private var lastSyncAt: Date?

    init(client: DeviceDataClient) {
        self.client = client
        self.state = file.load()
    }

    static var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    private static let steps = HKQuantityType(.stepCount)
    private static let exercise = HKQuantityType(.appleExerciseTime)
    private static let activeEnergy = HKQuantityType(.activeEnergyBurned)
    private static let restingHeartRate = HKQuantityType(.restingHeartRate)
    private static let sleep = HKCategoryType(.sleepAnalysis)
    private static let workouts = HKWorkoutType.workoutType()

    private static var readTypes: Set<HKObjectType> {
        [steps, exercise, activeEnergy, restingHeartRate, sleep, workouts]
    }

    /// Daily summaries change slowly; workouts should show up right away.
    private static var observed: [(HKSampleType, HKUpdateFrequency)] {
        [
            (steps, .daily), (exercise, .daily), (activeEnergy, .daily),
            (restingHeartRate, .daily), (sleep, .daily), (workouts, .immediate),
        ]
    }

    // MARK: - Permission

    /// True once the permission sheet was shown. Which types were allowed is private.
    func hasAsked() async -> Bool {
        guard Self.isAvailable else { return false }
        let status = try? await store.statusForAuthorizationRequest(toShare: [], read: Self.readTypes)
        return status == .unnecessary
    }

    /// Shows HealthKit's sheet, where the user picks types one by one.
    func requestPermission() async throws {
        guard Self.isAvailable else { return }
        try await store.requestAuthorization(toShare: [], read: Self.readTypes)
    }

    // MARK: - Collecting

    func start() {
        guard Self.isAvailable, observers.isEmpty else { return }
        for (type, frequency) in Self.observed {
            let query = Self.observerQuery(for: type) { [weak self] in
                await self?.sync(force: true)
            }
            observers.append(query)
            store.execute(query)
            store.enableBackgroundDelivery(for: type, frequency: frequency) { ok, error in
                if !ok {
                    print("[Collectors] No background delivery for \(type.identifier): \(error?.localizedDescription ?? "")")
                }
            }
        }
    }

    func stop() {
        observers.forEach(store.stop)
        observers = []
        store.disableAllBackgroundDelivery { _, _ in }
    }

    /// Built outside the main actor: HealthKit calls the handler on its own queue and
    /// waits for `completion` before it lets the app sleep again.
    nonisolated private static func observerQuery(
        for type: HKSampleType, onUpdate: @escaping @MainActor @Sendable () async -> Void
    ) -> HKObserverQuery {
        HKObserverQuery(sampleType: type, predicate: nil) { _, completion, error in
            if let error {
                print("[Collectors] Health observer error: \(error.localizedDescription)")
                completion()
                return
            }
            Task { @MainActor in
                await onUpdate()
                completion()
            }
        }
    }

    var pendingCount: Int { state.pendingCount }

    /// Reads the last 30 days and uploads what changed. One pass at a time.
    func sync(force: Bool = false) async {
        if !force, let lastSyncAt, Date().timeIntervalSince(lastSyncAt) < Self.minimumInterval {
            return
        }
        if let syncing {
            syncAgain = true
            await syncing.value
            return
        }
        let task = Task { @MainActor in
            repeat {
                self.syncAgain = false
                await self.syncOnce()
            } while self.syncAgain
        }
        syncing = task
        await withBackgroundTime("Upload Health") { await task.value }
        syncing = nil
        lastSyncAt = Date()
    }

    private func syncOnce() async {
        do {
            let (days, workouts) = try await read()
            let calendar = Calendar.current
            let dayItems = days.filter { !$0.isEmpty }.map { HealthMapping.dayItem(for: $0, calendar: calendar) }
            let workoutItems = workouts.map { HealthMapping.workoutItem(for: $0, calendar: calendar) }
            let current = dayItems + workoutItems
            let currentIds = Set(current.map(\.id))
            // Ids for this window that were uploaded but are gone now (a deleted workout,
            // a type the user stopped sharing) are removed in the cloud.
            let windowIds = Set(days.map { HealthMapping.dayId($0.date, calendar: calendar) })
            let gone = state.uploaded.keys.filter { id in
                !currentIds.contains(id)
                    && (windowIds.contains(id) || id.hasPrefix("health:workout:"))
            }
            state.enqueue(current)
            state.enqueueRemovals(Array(gone))
            state.forgetUploads(except: currentIds)
            file.save(state)
        } catch {
            // Health data is locked while the phone is locked; try again later.
            print("[Collectors] Couldn't read Health: \(error.localizedDescription)")
        }
        guard state.pendingCount > 0 else { return }
        do {
            try await beforeUpload()
            state = try await CollectorUploader.flush(state, client: client)
            file.save(state)
        } catch {
            print("[Collectors] Health stays queued: \(error.localizedDescription)")
        }
        onChange()
    }

    // MARK: - Reading

    private func read() async throws -> ([HealthDay], [WorkoutRecord]) {
        let calendar = Calendar.current
        let now = Date()
        let today = calendar.startOfDay(for: now)
        guard let start = calendar.date(byAdding: .day, value: -(Self.days - 1), to: today),
            let sleepStart = calendar.date(byAdding: .day, value: -1, to: start)
        else { return ([], []) }

        let steps = try await dailyStatistics(Self.steps, .cumulativeSum, .count(), start, now)
        let exercise = try await dailyStatistics(Self.exercise, .cumulativeSum, .minute(), start, now)
        let energy = try await dailyStatistics(Self.activeEnergy, .cumulativeSum, .kilocalorie(), start, now)
        let heartRate = try await dailyStatistics(
            Self.restingHeartRate, .discreteAverage, .count().unitDivided(by: .minute()), start, now)
        let sleep = try await sleepIntervals(from: sleepStart, to: now)
        let workouts = try await readWorkouts(from: start, to: now)

        var days: [HealthDay] = []
        var day = start
        while day <= today {
            days.append(
                HealthDay(
                    date: day, steps: steps[day], exerciseMinutes: exercise[day],
                    activeEnergyKcal: energy[day], restingHeartRate: heartRate[day],
                    sleep: HealthMapping.sleep(intervals: sleep, day: day, calendar: calendar),
                    workouts: workouts.filter { calendar.isDate($0.start, inSameDayAs: day) }))
            guard let next = calendar.date(byAdding: .day, value: 1, to: day) else { break }
            day = next
        }
        return (days, workouts)
    }

    /// Value per local day, keyed by midnight. Days without data are missing.
    private func dailyStatistics(
        _ type: HKQuantityType, _ options: HKStatisticsOptions, _ unit: HKUnit,
        _ start: Date, _ end: Date
    ) async throws -> [Date: Double] {
        let descriptor = HKStatisticsCollectionQueryDescriptor(
            predicate: .quantitySample(
                type: type, predicate: HKQuery.predicateForSamples(withStart: start, end: end)),
            options: options, anchorDate: start, intervalComponents: DateComponents(day: 1))
        let collection = try await descriptor.result(for: store)
        var values: [Date: Double] = [:]
        collection.enumerateStatistics(from: start, to: end) { statistics, _ in
            let quantity =
                options.contains(.cumulativeSum) ? statistics.sumQuantity() : statistics.averageQuantity()
            if let quantity {
                values[Calendar.current.startOfDay(for: statistics.startDate)] = quantity.doubleValue(for: unit)
            }
        }
        return values
    }

    private func sleepIntervals(from start: Date, to end: Date) async throws -> [(start: Date, end: Date)] {
        let descriptor = HKSampleQueryDescriptor(
            predicates: [
                .categorySample(
                    type: Self.sleep, predicate: HKQuery.predicateForSamples(withStart: start, end: end))
            ],
            sortDescriptors: [SortDescriptor(\.startDate)])
        let asleep = Set(HKCategoryValueSleepAnalysis.allAsleepValues.map(\.rawValue))
        return try await descriptor.result(for: store)
            .filter { asleep.contains($0.value) }
            .map { (start: $0.startDate, end: $0.endDate) }
    }

    private func readWorkouts(from start: Date, to end: Date) async throws -> [WorkoutRecord] {
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.workout(HKQuery.predicateForSamples(withStart: start, end: end))],
            sortDescriptors: [SortDescriptor(\.startDate)])
        return try await descriptor.result(for: store).map(Self.record)
    }

    private static let distanceTypes: [HKQuantityType] = [
        HKQuantityType(.distanceWalkingRunning), HKQuantityType(.distanceCycling),
        HKQuantityType(.distanceSwimming), HKQuantityType(.distanceWheelchair),
        HKQuantityType(.distanceDownhillSnowSports),
    ]

    private static func record(_ workout: HKWorkout) -> WorkoutRecord {
        let energy = workout.statistics(for: HKQuantityType(.activeEnergyBurned))?
            .sumQuantity()?.doubleValue(for: .kilocalorie())
        let distance = distanceTypes.lazy
            .compactMap { workout.statistics(for: $0)?.sumQuantity()?.doubleValue(for: .meter()) }
            .first
        return WorkoutRecord(
            uuid: workout.uuid.uuidString, activity: name(workout.workoutActivityType),
            start: workout.startDate, end: workout.endDate, duration: workout.duration,
            energyKcal: energy, distanceMeters: distance)
    }

    static func name(_ type: HKWorkoutActivityType) -> String {
        switch type {
        case .running: "Running"
        case .walking: "Walking"
        case .hiking: "Hiking"
        case .cycling: "Cycling"
        case .swimming: "Swimming"
        case .yoga: "Yoga"
        case .pilates: "Pilates"
        case .dance, .cardioDance, .socialDance: "Dance"
        case .elliptical: "Elliptical"
        case .rowing: "Rowing"
        case .stairClimbing, .stairs, .stepTraining: "Stairs"
        case .traditionalStrengthTraining: "Strength Training"
        case .functionalStrengthTraining: "Functional Strength Training"
        case .highIntensityIntervalTraining: "HIIT"
        case .coreTraining: "Core Training"
        case .crossTraining: "Cross Training"
        case .mixedCardio: "Cardio"
        case .flexibility: "Flexibility"
        case .cooldown: "Cooldown"
        case .mindAndBody: "Mind and Body"
        case .soccer: "Soccer"
        case .basketball: "Basketball"
        case .tennis: "Tennis"
        case .pickleball: "Pickleball"
        case .golf: "Golf"
        case .baseball: "Baseball"
        case .softball: "Softball"
        case .volleyball: "Volleyball"
        case .americanFootball: "Football"
        case .hockey: "Hockey"
        case .martialArts: "Martial Arts"
        case .boxing, .kickboxing: "Boxing"
        case .climbing: "Climbing"
        case .downhillSkiing: "Skiing"
        case .snowboarding: "Snowboarding"
        case .crossCountrySkiing: "Cross-Country Skiing"
        case .skatingSports: "Skating"
        case .surfingSports: "Surfing"
        case .paddleSports: "Paddling"
        case .waterFitness: "Water Fitness"
        case .wheelchairRunPace, .wheelchairWalkPace: "Wheelchair"
        case .swimBikeRun: "Triathlon"
        default: "Workout"
        }
    }
}
#endif
