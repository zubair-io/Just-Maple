//
//  MacDataModels.swift
//  JapaneseMaple
//
//  Shared types for the Mac-only data sources (iMessage, Mail, Calendar).
//  The web app sees these as JSON through the `macData` script handler.
//

#if os(macOS)
import Foundation

nonisolated enum MacDataSource: String, Codable, CaseIterable, Sendable {
    case imessage
    case mail
    case calendar
}

/// One message, email or calendar occurrence, normalized across sources.
nonisolated struct MacDataItem: Codable, Equatable, Sendable {
    var id: String
    var source: MacDataSource
    /// Changes whenever the source record changes, so re-reads are cheap to skip.
    var revision: String
    /// Seconds since 1970. For calendar events this is the start time.
    var occurredAt: Double
    var endAt: Double?
    var title: String?
    var sender: String?
    var participants: [String]
    var thread: String?
    var body: String
    var isFromMe: Bool?
    var location: String?
    var calendar: String?
    var allDay: Bool?
    var mailbox: String?
    var isRead: Bool?
}

/// A local-only page that shows one source inside a notebook. Never synced.
nonisolated struct MacDataPage: Codable, Equatable, Sendable {
    var id: String
    var notebookId: String
    var source: MacDataSource
    var title: String
    var createdAt: Double
}

nonisolated struct MacDataSourceStatus: Codable, Equatable, Sendable {
    enum State: String, Codable, Sendable {
        case off  // no page has asked for this source yet
        case ready
        case syncing
        case needsAccess
        case error
    }

    var source: MacDataSource
    var state: State
    var message: String?
    var itemCount: Int
    var lastSyncAt: Double?
}

nonisolated struct MacDataQuery: Codable, Sendable {
    var source: MacDataSource
    var search: String?
    var limit: Int?
    var offset: Int?
    /// "asc" or "desc" by occurredAt. Defaults to newest first.
    var order: String?
    var from: Double?
    var to: Double?
}

nonisolated struct MacDataQueryResult: Codable, Sendable {
    var items: [MacDataItem]
    var total: Int
}

/// What a reader found in one pass.
nonisolated struct MacDataReadResult: Sendable {
    var items: [MacDataItem]
    /// Item ids the source no longer has (deleted, moved to Trash, unsent).
    var removedIds: [String]
    /// Ids still present in the source within `reconcileWindow`; the store removes the rest.
    var presentIds: Set<String>?
    var reconcileWindow: ClosedRange<Double>?
    var checkpoint: String
}

nonisolated enum MacDataPaths {
    /// The user's real home folder. In the App Sandbox `NSHomeDirectory()` points
    /// inside the app container, which never contains Messages or Mail data.
    static var realHome: URL {
        if let entry = getpwuid(getuid()), let dir = entry.pointee.pw_dir {
            return URL(fileURLWithPath: String(cString: dir), isDirectory: true)
        }
        return FileManager.default.homeDirectoryForCurrentUser
    }

    static var messagesDatabase: URL {
        realHome.appendingPathComponent("Library/Messages/chat.db")
    }

    static var mailRoot: URL {
        realHome.appendingPathComponent("Library/Mail", isDirectory: true)
    }

    /// Our own database lives in Application Support and never leaves this Mac.
    static var store: URL {
        let base =
            FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("MacData", isDirectory: true)
            .appendingPathComponent("mac-data.sqlite")
    }
}

/// FNV-1a. Unlike `hashValue`, stays the same across launches, so it can be stored.
nonisolated func macDataStableHash(_ value: String) -> String {
    var hash: UInt64 = 0xcbf2_9ce4_8422_2325
    for byte in value.utf8 {
        hash ^= UInt64(byte)
        hash = hash &* 0x0000_0100_0000_01b3
    }
    return String(hash, radix: 16)
}

/// Initial import reaches back this far. Later syncs keep everything already stored.
nonisolated let macDataInitialWindow: TimeInterval = 30 * 24 * 60 * 60
#endif
