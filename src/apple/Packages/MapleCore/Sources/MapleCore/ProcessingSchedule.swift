import Foundation

extension SQLite {
    func migrateProcessingSchedule() throws {
        try execute("CREATE TABLE IF NOT EXISTS processing_schedule (connector TEXT PRIMARY KEY, last_turn INTEGER NOT NULL, dispatches INTEGER NOT NULL)")
    }
}
