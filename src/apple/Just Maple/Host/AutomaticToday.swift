import Foundation
import MapleCore
import MapleNotebooks

extension AppModel {
    func setTodayEditing(documentID: String, editing: Bool, at: Date = Date()) {
        todayEditingLeases[documentID] = editing ? at.addingTimeInterval(6) : nil
    }

    func isTodayEditing(documentID: String, at: Date = Date()) -> Bool {
        (todayEditingLeases[documentID] ?? .distantPast) > at
    }

    // Continue placing new context when another route is open. An expiring editor
    // lease keeps background file mutations away from an active writing session.
    func automaticTodayTick(at: Date = Date()) async {
        guard !starting, loaded, let store, !automaticTodayBusy,
              at.timeIntervalSince(lastAutomaticTodayTick) >= 10 else { return }
        automaticTodayBusy = true
        lastAutomaticTodayTick = at
        defer { automaticTodayBusy = false }
        do {
            let bridge = Bridge(model: self)
            let library = try await bridge.notebookLibrary()
            let notebookID = try await library.ensureJustMapleDailyNotebook()
            let day = try ManagedMarkdown.day(at: at, timeZone: TimeZone.current.identifier)
            if let record = try await store.managedDailyDocument(notebookID: notebookID, day: day),
               isTodayEditing(documentID: record.documentID, at: at) { return }
            let coordinator = try await bridge.todayCoordinator()
            let document = try await coordinator.open(notebookID: notebookID, day: day)
            guard !document.readOnly, !isTodayEditing(documentID: document.documentID) else { return }
            _ = try await coordinator.refreshAutomatic(documentID: document.documentID, at: at)
        } catch {
            localIntelligenceStatus = "New note context is pending. Maple will retry; your writing is preserved."
        }
    }
}
