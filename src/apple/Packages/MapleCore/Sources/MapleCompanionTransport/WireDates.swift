import Foundation

/// Normalize before persisting an immutable command: wire dates use millisecond precision.
enum SyncWireDate {
    static func normalized(_ date:Date)->Date {
        guard date.timeIntervalSince1970.isFinite else{return date}
        return Date(timeIntervalSince1970:(date.timeIntervalSince1970*1000).rounded()/1000)
    }
}
