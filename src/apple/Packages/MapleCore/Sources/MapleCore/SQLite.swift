import CSQLite
import Foundation

// Used only inside KnowledgeStore's actor. No shared global database handle.
final class SQLite {
    private var handle: OpaquePointer?
    init(path: String) throws {
        if path != ":memory:" {
            let directory = URL(fileURLWithPath: path).deletingLastPathComponent()
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                    attributes: [.posixPermissions: 0o700])
        }
        guard sqlite3_open_v2(path, &handle, SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else {
            let message = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "Cannot open SQLite"
            sqlite3_close(handle); handle = nil
            throw MapleError.database(message)
        }
        sqlite3_busy_timeout(handle, 5000)
        try execute("PRAGMA foreign_keys = ON")
        try execute("PRAGMA journal_mode = WAL")
        try execute("PRAGMA synchronous = FULL")
        if path != ":memory:" {
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: path)
        }
    }
    deinit { sqlite3_close(handle) }

    func execute(_ sql: String, _ arguments: [String?] = []) throws {
        let statement = try prepare(sql, arguments)
        defer { sqlite3_finalize(statement) }
        var status = sqlite3_step(statement)
        while status == SQLITE_ROW { status = sqlite3_step(statement) }
        guard status == SQLITE_DONE else { throw failure() }
    }

    func rows(_ sql: String, _ arguments: [String?] = []) throws -> [[String: String]] {
        let statement = try prepare(sql, arguments)
        defer { sqlite3_finalize(statement) }
        var result: [[String: String]] = []
        while true {
            let status = sqlite3_step(statement)
            if status == SQLITE_DONE { return result }
            guard status == SQLITE_ROW else { throw failure() }
            var row: [String: String] = [:]
            for column in 0..<sqlite3_column_count(statement) {
                guard sqlite3_column_type(statement, column) != SQLITE_NULL else { continue }
                row[String(cString: sqlite3_column_name(statement, column))] = String(cString: sqlite3_column_text(statement, column))
            }
            result.append(row)
        }
    }

    func transaction<T>(_ body: () throws -> T) throws -> T {
        try execute("BEGIN IMMEDIATE")
        do {
            let result = try body()
            try execute("COMMIT")
            return result
        } catch {
            try? execute("ROLLBACK")
            throw error
        }
    }

    private func prepare(_ sql: String, _ arguments: [String?]) throws -> OpaquePointer {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK, let statement else { throw failure() }
        for (offset, argument) in arguments.enumerated() {
            let index = Int32(offset + 1)
            let status: Int32
            if let argument {
                status = argument.withCString { sqlite3_bind_text(statement, index, $0, -1, unsafeBitCast(-1, to: sqlite3_destructor_type.self)) }
            } else { status = sqlite3_bind_null(statement, index) }
            if status != SQLITE_OK { sqlite3_finalize(statement); throw failure() }
        }
        return statement
    }
    private func failure() -> MapleError {
        .database(handle.map { String(cString: sqlite3_errmsg($0)) } ?? "SQLite is closed")
    }
}
