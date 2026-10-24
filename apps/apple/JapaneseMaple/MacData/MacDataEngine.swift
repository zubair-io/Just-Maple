//
//  MacDataEngine.swift
//  JapaneseMaple
//
//  Runs the readers off the main thread and owns the local database.
//  A source is only read after a page asks for it.
//

#if os(macOS)
import EventKit
import Foundation

actor MacDataEngine {
    private var cachedStore: MacDataStore?
    private let imessage = IMessageReader()
    private let mail = MailReader()
    private let calendar = CalendarReader()
    private let eventStore = EKEventStore()

    private var running: Set<MacDataSource> = []
    private var rerun: Set<MacDataSource> = []
    private var failures: [MacDataSource: MacDataError] = [:]
    let searchIndex = MacDataSearchIndex()
    private let storePath: String

    init(storePath: String = MacDataPaths.store.path) {
        self.storePath = storePath
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
        return try MacDataSource.allCases.map { source in
            var status = MacDataSourceStatus(
                source: source, state: .ready, message: nil,
                itemCount: try store.itemCount(source), lastSyncAt: try store.lastSync(source))
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
            return status
        }
    }

    // MARK: - Sync

    func enabledSources() throws -> [MacDataSource] {
        try store().enabledSources()
    }

    /// Reads one source into the store. Overlapping calls coalesce into one extra pass.
    /// Returns true when anything was added, changed or removed.
    @discardableResult
    func sync(_ source: MacDataSource) async -> Bool {
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
                let result: MacDataReadResult
                // File-based reads can take minutes on a first import; run them off
                // the actor so page lists and table queries stay responsive.
                switch source {
                case .imessage:
                    let reader = imessage
                    result = try await Task.detached { try reader.read(checkpoint: checkpoint) }
                        .value
                case .mail:
                    let reader = mail
                    result = try await Task.detached { try reader.read(checkpoint: checkpoint) }
                        .value
                case .calendar:
                    // Access may have been granted in System Settings since the last pass.
                    if failures[.calendar] != nil { eventStore.reset() }
                    result = try calendar.read(store: eventStore)
                }
                changed = try store.apply(result, source: source) > 0 || changed
                failures[source] = nil
            } catch let error as MacDataError {
                failures[source] = error
            } catch {
                failures[source] = .sqlite(error.localizedDescription)
            }
        } while rerun.contains(source)
        return changed
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

    // MARK: - Pages

    func pages(notebookId: String?) throws -> [MacDataPage] {
        try store().pages(notebookId: notebookId)
    }

    func page(id: String) throws -> MacDataPage? {
        try store().page(id: id)
    }

    func createPage(notebookId: String, source: MacDataSource, title: String?) throws
        -> MacDataPage
    {
        let store = try store()
        let page = MacDataPage(
            id: UUID().uuidString.lowercased(),
            notebookId: notebookId,
            source: source,
            title: title?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
                ?? Self.defaultTitle(source),
            createdAt: Date().timeIntervalSince1970)
        try store.enable(source)
        try store.insert(page)
        return page
    }

    func renamePage(id: String, title: String) throws {
        guard let title = title.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty else {
            throw MacDataError.invalid("A page needs a title.")
        }
        try store().rename(pageId: id, title: title)
    }

    func deletePage(id: String) throws {
        try store().delete(pageId: id)
    }

    func query(_ query: MacDataQuery) throws -> MacDataQueryResult {
        try store().query(query)
    }

    static func defaultTitle(_ source: MacDataSource) -> String {
        switch source {
        case .imessage: return "iMessage"
        case .mail: return "Email"
        case .calendar: return "Calendar"
        }
    }
}

nonisolated extension String {
    fileprivate var nonEmpty: String? { isEmpty ? nil : self }
}
#endif
