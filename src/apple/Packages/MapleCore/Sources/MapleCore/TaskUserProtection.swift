import Foundation

extension SQLite {
    /// Materialize history subjects once; protection checks must not scan history
    /// for every extracted candidate. Future user history is indexed atomically.
    func migrateTaskUserProtection() throws {
        try transaction {
            let exists = try rows("SELECT name FROM sqlite_master WHERE type='table' AND name='task_user_history_subjects'").first != nil
            try execute("CREATE TABLE IF NOT EXISTS task_user_history_subjects(subject TEXT PRIMARY KEY)")
            if !exists {
                try execute("INSERT OR IGNORE INTO task_user_history_subjects SELECT j.value FROM world_history h, json_each(h.json,'$.subjects') j WHERE json_extract(h.json,'$.actor')='user' AND j.type='text'")
            }
            try execute("""
                CREATE TRIGGER IF NOT EXISTS task_user_history_subjects_insert AFTER INSERT ON world_history
                WHEN json_extract(NEW.json,'$.actor')='user' BEGIN
                    INSERT OR IGNORE INTO task_user_history_subjects SELECT value FROM json_each(NEW.json,'$.subjects') WHERE type='text';
                END
                """)
        }
    }
}
