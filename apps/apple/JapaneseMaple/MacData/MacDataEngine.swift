//
//  MacDataEngine.swift
//  JapaneseMaple
//
//  Runs the readers off the main thread and owns the local staging database.
//  A source is only read after the web app enables it (a device data page for it
//  was created or opened). What's read is uploaded to the cloud afterwards.
//

#if os(macOS)
import Contacts
import EventKit
import Foundation

actor MacDataEngine {
    private var cachedStore: MacDataStore?
    private let imessage = IMessageReader()
    private let mail = MailReader()
    private let calendar = CalendarReader()
    private let contacts = ContactsReader()
    let eventStore = EKEventStore()
    private let contactStore = CNContactStore()
    /// Phone/email → name from the stored contacts; nil until first needed or after contacts change.
    private var contactNames: MacDataContactNames?

    private var running: Set<MacDataSource> = []
    private var rerun: Set<MacDataSource> = []
    /// One embedding pass at a time; a running pass picks up items added while it works.
    var isEmbedding = false
    private var failures: [MacDataSource: MacDataError] = [:]
    private let storePath: String

    // Upload state, used by MacDataEngine+Upload.
    let client: DeviceDataClient
    let deviceName: @Sendable () -> String
    /// Retries failed uploads on a timer. Tests turn it off and call `uploadPending` directly.
    let retriesUploads: Bool
    var isUploading = false
    var uploadAgain = false
    var registration: MacDataUploadRegistration?
    var uploadError: String?
    var retryDelay: TimeInterval = MacDataEngine.firstRetryDelay
    var retryTask: Task<Void, Never>?
    // Calendar actions, used by CalendarActions.
    var isRunningActions = false
    var runActionsAgain = false
    // Home Assistant, used by MacDataEngine+Home.
    var homeConfigured = false
    var homeStatus: HomeAssistantStatus?
    var homePerformer: HomeActionPerforming?

    init(
        storePath: String = MacDataPaths.store.path,
        client: DeviceDataClient = .shared,
        deviceName: @escaping @Sendable () -> String = { Host.current().localizedName ?? "Mac" },
        retriesUploads: Bool = true
    ) {
        self.storePath = storePath
        self.client = client
        self.deviceName = deviceName
        self.retriesUploads = retriesUploads
    }

    /// Only use the store from inside this actor; its connection isn't shared safely elsewhere.
    func store() throws -> MacDataStore {
        if let cachedStore { return cachedStore }
        let store = try MacDataStore(path: storePath)
        cachedStore = store
        return store
    }

    // MARK: - Status

    func statuses() throws -> [MacDataSourceStatus] {
        let store = try store()
        let enabled = Set(try store.enabledSources())
        let active = Set(registration?.activeSources ?? [])
        let lastUploadAt = try store.value(Self.lastUploadKey).flatMap(Double.init)
        return try MacDataSource.allCases.map { source in
            var status = MacDataSourceStatus(
                source: source, state: .ready, message: nil,
                itemCount: try store.itemCount(source), lastSyncAt: try store.lastSync(source),
                uploadActive: active.contains(source),
                // Only what this Mac will actually send; inactive sources wait for their collector.
                pendingUpload: active.contains(source) ? try store.pendingUploadCount(sources: [source]) : 0,
                lastUploadAt: lastUploadAt,
                uploadError: enabled.contains(source) ? uploadError : nil)
            if !enabled.contains(source) {
                status.state = .off
            } else if running.contains(source) {
                status.state = .syncing
            } else if let failure = failures[source] {
                if case .accessDenied = failure {
                    status.state = .needsAccess
                } else {
                    status.state = .error
                }
                status.message = failure.localizedDescription
            }
            if source == .calendar, enabled.contains(source), !CalendarReader.hasAccess {
                status.state = .needsAccess
                status.message = CalendarReader.accessProblem
            }
            if source == .contacts, enabled.contains(source), !ContactsReader.hasAccess {
                status.state = .needsAccess
                status.message = ContactsReader.accessProblem
            }
            if source == .home, enabled.contains(source) { applyHomeStatus(to: &status) }
            return status
        }
    }

    // MARK: - Sources

    func enabledSources() throws -> [MacDataSource] {
        try store().enabledSources()
    }

    /// Returns true when the source wasn't enabled before.
    @discardableResult
    func enable(_ source: MacDataSource) throws -> Bool {
        try store().enable(source)
    }

    /// Stops reading the source and forgets its local copy. Returns true when it was enabled.
    @discardableResult
    func disable(_ source: MacDataSource) throws -> Bool {
        let changed = try store().disable(source)
        if source == .contacts { contactNames = nil }
        failures[source] = nil
        return changed
    }

    // MARK: - Sync

    /// Reads one source into the store. Overlapping calls coalesce into one extra pass.
    /// Returns true when anything was added, changed or removed.
    @discardableResult
    func sync(_ source: MacDataSource, now: Date? = nil) async -> Bool {
        // Home Assistant pushes its changes (applyHome); there is nothing to read.
        if source == .home { return false }
        if running.contains(source) {
            rerun.insert(source)
            return false
        }
        running.insert(source)
        defer { running.remove(source) }

        var changed = false
        repeat {
            rerun.remove(source)
            do {
                let store = try store()
                guard try store.enabledSources().contains(source) else { return changed }
                let checkpoint = try store.checkpoint(source)
                let names = try self.names()
                let result: MacDataReadResult
                // File-based reads can take minutes on a first import; run them off
                // the actor so status and uploads stay responsive.
                switch source {
                case .imessage:
                    let reader = imessage
                    result = try await Task.detached {
                        try reader.read(checkpoint: checkpoint, names: names)
                    }.value
                case .mail:
                    let reader = mail
                    result = try await Task.detached {
                        try reader.read(checkpoint: checkpoint, names: names)
                    }.value
                case .calendar:
                    // Access may have been granted in System Settings since the last pass.
                    if failures[.calendar] != nil { eventStore.reset() }
                    result = try calendar.read(store: eventStore)
                case .contacts:
                    let reader = contacts
                    result = try await Task.detached { try reader.read() }.value
                case .home:
                    return changed
                }
                let date = now ?? Date()
                let applied = try store.apply(result, source: source, now: date)
                if applied > 0, source == .contacts { contactNames = nil }
                try store.pruneExpired(now: date)
                changed = applied > 0 || changed
                failures[source] = nil
            } catch let error as MacDataError {
                failures[source] = error
            } catch {
                failures[source] = .sqlite(error.localizedDescription)
            }
        } while rerun.contains(source)
        return changed
    }

    /// The contact name lookup, rebuilt from the store after contacts change.
    private func names() throws -> MacDataContactNames {
        if let contactNames { return contactNames }
        let names = MacDataContactNames(contacts: try store().items(source: .contacts))
        contactNames = names
        return names
    }

    // MARK: - Access

    /// Shows the system Calendar prompt the first time; returns whether access is granted.
    func requestCalendarAccess() async -> Bool {
        if CalendarReader.hasAccess { return true }
        do {
            let granted = try await eventStore.requestFullAccessToEvents()
            // A store created before access was granted can keep returning no calendars.
            if granted { eventStore.reset() }
            return granted
        } catch {
            failures[.calendar] = .accessDenied(error.localizedDescription)
            return false
        }
    }

    /// Shows the system Contacts prompt the first time; returns whether access is granted.
    func requestContactsAccess() async -> Bool {
        if ContactsReader.hasAccess { return true }
        do {
            return try await contactStore.requestAccess(for: .contacts)
        } catch {
            failures[.contacts] = .accessDenied(error.localizedDescription)
            return false
        }
    }

    // MARK: - Legacy pages

    /// Pages from before they moved to the cloud. The web app migrates and deletes them.
    func pages(notebookId: String?) throws -> [MacDataPage] {
        try store().pages(notebookId: notebookId)
    }

    func deletePage(id: String) throws {
        try store().delete(pageId: id)
    }
}
#endif
