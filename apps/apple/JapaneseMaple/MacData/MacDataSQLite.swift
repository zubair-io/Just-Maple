//
//  MacDataSQLite.swift
//  JapaneseMaple
//
//  Minimal SQLite wrapper for Mac data sources. Used for the app's own
//  database and for read-only access to Messages and Mail databases.
//

#if os(macOS)
import Foundation
import SQLite3

nonisolated enum MacDataError: LocalizedError {
    case sqlite(String)
    case accessDenied(String)
    case unsupported(String)
    case invalid(String)

    var errorDescription: String? {
        switch self {
        case .sqlite(let message), .accessDenied(let message), .unsupported(let message),
            .invalid(let message):
            return message
        }
    }
}

nonisolated enum SQLValue: Sendable, Equatable {
    case null
    case int(Int64)
    case double(Double)
    case text(String)
    case blob(Data)

    var string: String? {
        switch self {
        case .text(let value): return value
        case .int(let value): return String(value)
        case .double(let value): return String(value)
        default: return nil
        }
    }

    var int: Int64? {
        switch self {
        case .int(let value): return value
        case .double(let value): return Int64(value)
        case .text(let value): return Int64(value)
        default: return nil
        }
    }

    var double: Double? {
        switch self {
        case .int(let value): return Double(value)
        case .double(let value): return value
        case .text(let value): return Double(value)
        default: return nil
        }
    }

    var data: Data? {
        if case .blob(let value) = self { return value }
        return nil
    }
}

nonisolated private let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

/// Not thread-safe: each instance must be used from a single actor or queue.
nonisolated final class MacDataSQLite: @unchecked Sendable {
    typealias Row = [String: SQLValue]

    private var handle: OpaquePointer?
    let path: String

    /// Opens a database. Read-only connections never create or modify files.
    init(path: String, readOnly: Bool) throws {
        self.path = path
        var db: OpaquePointer?
        let result: Int32
        if readOnly {
            // URI form keeps paths with spaces (Mail's "Envelope Index") intact.
            let uri = URL(fileURLWithPath: path).absoluteString + "?mode=ro"
            result = sqlite3_open_v2(
                uri, &db, SQLITE_OPEN_READONLY | SQLITE_OPEN_URI | SQLITE_OPEN_NOMUTEX, nil)
        } else {
            result = sqlite3_open_v2(
                path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_NOMUTEX, nil)
        }
        guard result == SQLITE_OK, let db else {
            let message = db.map { String(cString: sqlite3_errmsg($0)) } ?? "code \(result)"
            sqlite3_close(db)
            if result == SQLITE_AUTH || result == SQLITE_CANTOPEN || result == SQLITE_PERM {
                throw MacDataError.accessDenied("Cannot open \(path): \(message)")
            }
            throw MacDataError.sqlite("Cannot open \(path): \(message)")
        }
        handle = db
        sqlite3_busy_timeout(db, 3000)
    }

    deinit {
        sqlite3_close(handle)
    }

    func execute(_ sql: String, _ bindings: [Any?] = []) throws {
        let statement = try prepare(sql, bindings)
        defer { sqlite3_finalize(statement) }
        let result = sqlite3_step(statement)
        guard result == SQLITE_DONE || result == SQLITE_ROW else {
            throw error(sql)
        }
    }

    func rows(_ sql: String, _ bindings: [Any?] = []) throws -> [Row] {
        let statement = try prepare(sql, bindings)
        defer { sqlite3_finalize(statement) }
        var rows: [Row] = []
        while true {
            let result = sqlite3_step(statement)
            if result == SQLITE_DONE { break }
            guard result == SQLITE_ROW else { throw error(sql) }
            var row: Row = [:]
            for index in 0..<sqlite3_column_count(statement) {
                let name = String(cString: sqlite3_column_name(statement, index))
                row[name] = value(statement, index)
            }
            rows.append(row)
        }
        return rows
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

    func tableExists(_ name: String) throws -> Bool {
        !(try rows("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [name])).isEmpty
    }

    func columns(_ table: String) throws -> Set<String> {
        // PRAGMA arguments cannot be bound; table names here are fixed literals.
        Set(try rows("PRAGMA table_info(\(table))").compactMap { $0["name"]?.string })
    }

    // MARK: - Private

    private func prepare(_ sql: String, _ bindings: [Any?]) throws -> OpaquePointer? {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK else {
            throw error(sql)
        }
        for (offset, binding) in bindings.enumerated() {
            let index = Int32(offset + 1)
            switch binding {
            case nil:
                sqlite3_bind_null(statement, index)
            case let value as String:
                sqlite3_bind_text(statement, index, value, -1, sqliteTransient)
            case let value as Int:
                sqlite3_bind_int64(statement, index, Int64(value))
            case let value as Int64:
                sqlite3_bind_int64(statement, index, value)
            case let value as Double:
                sqlite3_bind_double(statement, index, value)
            case let value as Bool:
                sqlite3_bind_int64(statement, index, value ? 1 : 0)
            case let value as Data:
                _ = value.withUnsafeBytes { bytes in
                    sqlite3_bind_blob(
                        statement, index, bytes.baseAddress, Int32(value.count), sqliteTransient)
                }
            default:
                sqlite3_finalize(statement)
                throw MacDataError.invalid("Unsupported SQLite binding: \(String(describing: binding))")
            }
        }
        return statement
    }

    private func value(_ statement: OpaquePointer?, _ index: Int32) -> SQLValue {
        switch sqlite3_column_type(statement, index) {
        case SQLITE_INTEGER:
            return .int(sqlite3_column_int64(statement, index))
        case SQLITE_FLOAT:
            return .double(sqlite3_column_double(statement, index))
        case SQLITE_TEXT:
            return .text(String(cString: sqlite3_column_text(statement, index)))
        case SQLITE_BLOB:
            let count = Int(sqlite3_column_bytes(statement, index))
            guard count > 0, let bytes = sqlite3_column_blob(statement, index) else {
                return .blob(Data())
            }
            return .blob(Data(bytes: bytes, count: count))
        default:
            return .null
        }
    }

    private func error(_ sql: String) -> MacDataError {
        let code = sqlite3_errcode(handle)
        let message = String(cString: sqlite3_errmsg(handle))
        if code == SQLITE_AUTH || code == SQLITE_CANTOPEN || code == SQLITE_PERM {
            return .accessDenied(message)
        }
        return .sqlite("\(message) [\(sql.prefix(80))]")
    }
}
#endif
