import CloudKit
import Foundation
import MapleCompanionTransport

/// Explicit developer diagnostic mode. Reads metadata only; never creates zones or records.
enum CloudAccessDiagnostic {
    struct Result: Codable, Equatable {
        var operation: String
        var succeeded: Bool
        var count: Int?
        var error: String?
    }

    static func inspect(_ name: String, operation: () async throws -> Int) async -> Result {
        do { return Result(operation: name, succeeded: true, count: try await operation()) }
        catch { return Result(operation: name, succeeded: false, error: CloudMailboxError.safeDescription(error)) }
    }

    @MainActor static func run() async -> [Result] {
        let container = CKContainer(identifier: CloudCompanionIdentity.defaultContainerIdentifier)
        var results: [Result] = []
        results.append(await inspect("account status") { try await container.accountStatus().rawValue })
        results.append(await inspect("public default zone") {
            _ = try await container.publicCloudDatabase.recordZone(for: CKRecordZone.default().zoneID)
            return 1
        })
        results.append(await inspect("private default zone") {
            _ = try await container.privateCloudDatabase.recordZone(for: CKRecordZone.default().zoneID)
            return 1
        })
        results.append(await inspect("private zone enumeration") {
            try await container.privateCloudDatabase.allRecordZones().count
        })
        return results
    }
}
