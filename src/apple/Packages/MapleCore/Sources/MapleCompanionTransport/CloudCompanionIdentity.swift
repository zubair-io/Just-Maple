import CloudKit
import CryptoKit
import Foundation
import Security

public enum CloudCompanionIdentityError: Error, Sendable {
    case accountUnavailable, invalidAccount, invalidStoredIdentity, publisherRequiresMac
}

/// Injected tests never construct CKContainer or access a user's real Keychain.
@MainActor public protocol CloudCompanionAccountProviding {
    func accountStatus() async throws -> CKAccountStatus
    func userRecordName() async throws -> String
}

@MainActor public protocol CloudCompanionKeychain {
    func copyMatching(_ query: [String: Any]) -> (OSStatus, Data?)
    func add(_ attributes: [String: Any]) -> OSStatus
    func delete(_ query: [String: Any]) -> OSStatus
}

@MainActor private final class NativeCloudAccount: CloudCompanionAccountProviding {
    private let identifier:String
    private lazy var container = CKContainer(identifier:identifier)
    init(identifier: String) { self.identifier=identifier }
    func accountStatus() async throws -> CKAccountStatus { try await container.accountStatus() }
    func userRecordName() async throws -> String { try await container.userRecordID().recordName }
}

@MainActor private struct NativeCloudKeychain: CloudCompanionKeychain {
    func copyMatching(_ query: [String: Any]) -> (OSStatus, Data?) {
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        return (status, result as? Data)
    }
    func add(_ attributes: [String: Any]) -> OSStatus { SecItemAdd(attributes as CFDictionary, nil) }
    func delete(_ query: [String: Any]) -> OSStatus { SecItemDelete(query as CFDictionary) }
}

/// CloudKit supplies only the container-scoped account identity. Credentials travel through
/// iCloud Keychain; this type creates no CloudKit records and never uploads user profile data.
/// Native callers must refresh the account after CKAccountChanged and before reconnecting.
@MainActor public final class CloudCompanionIdentity {
    public static let defaultContainerIdentifier = "iCloud.com.just.maple.JapaneseMaple"
    public static let defaultAccessGroup = "QREP66JW5U.com.just.maple.companion"
    public static let service = "com.just.maple.companion.cloud-identity.v1"
    private let containerIdentifier: String
    private let accessGroup: String
    private let accountProvider: any CloudCompanionAccountProviding
    private let keychain: any CloudCompanionKeychain

    public init(containerIdentifier: String = CloudCompanionIdentity.defaultContainerIdentifier,
                accessGroup: String = CloudCompanionIdentity.defaultAccessGroup,
                accountProvider: (any CloudCompanionAccountProviding)? = nil,
                keychain: (any CloudCompanionKeychain)? = nil) {
        self.containerIdentifier = containerIdentifier
        self.accessGroup = accessGroup
        self.accountProvider = accountProvider ?? NativeCloudAccount(identifier: containerIdentifier)
        self.keychain = keychain ?? NativeCloudKeychain()
    }

    public func accountID() async throws -> String {
        guard try await accountProvider.accountStatus() == .available else { throw CloudCompanionIdentityError.accountUnavailable }
        let recordName = try await accountProvider.userRecordName()
        guard !recordName.isEmpty else { throw CloudCompanionIdentityError.invalidAccount }
        try Task.checkCancellation()
        // Include container and version to prevent sharing credentials across unrelated containers.
        return SHA256.hash(data: Data("maple-companion-v1\u{0}\(containerIdentifier)\u{0}\(recordName)".utf8))
            .map { String(format: "%02x", $0) }.joined()
    }

    public func load(accountID: String) throws -> PairingConfiguration? {
        var query = try query(accountID: accountID)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
        let (status, data) = keychain.copyMatching(query)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw CompanionTransportError.keychain(status) }
        guard let data, data.count <= 4096,
              let configuration = try? SyncCodec.decode(PairingConfiguration.self, from: data),
              configuration.secret.count == 32, configuration.expiresAt == nil else {
            throw CloudCompanionIdentityError.invalidStoredIdentity
        }
        return configuration
    }

    /// Only a Mac can establish the shared identity. Add-only preserves a concurrently published
    /// identity; a duplicate is reloaded rather than overwriting a different Mac's existing key.
    public func publishNew(accountID: String, configuration proposed: PairingConfiguration? = nil) throws -> PairingConfiguration {
        #if os(macOS)
        if let existing = try load(accountID: accountID) { return existing }
        let configuration = try proposed ?? PairingConfiguration.create()
        guard configuration.secret.count == 32, configuration.expiresAt == nil else { throw CloudCompanionIdentityError.invalidStoredIdentity }
        var attributes = try query(accountID: accountID)
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        attributes[kSecValueData as String] = try SyncCodec.encode(configuration)
        let status = keychain.add(attributes)
        if status == errSecDuplicateItem {
            guard let existing = try load(accountID: accountID) else { throw CompanionTransportError.keychain(errSecItemNotFound) }
            return existing
        }
        guard status == errSecSuccess else { throw CompanionTransportError.keychain(status) }
        return configuration
        #else
        throw CloudCompanionIdentityError.publisherRequiresMac
        #endif
    }

    /// Mac-wide disconnect propagates through iCloud Keychain asynchronously. Hosts must also
    /// stop listeners immediately; deletion cannot synchronously revoke an offline peer's copy.
    public func remove(accountID: String) throws {
        #if os(macOS)
        let status = keychain.delete(try query(accountID: accountID))
        guard status == errSecSuccess || status == errSecItemNotFound else { throw CompanionTransportError.keychain(status) }
        #else
        throw CloudCompanionIdentityError.publisherRequiresMac
        #endif
    }

    private func query(accountID: String) throws -> [String: Any] {
        guard accountID.count == 64, accountID.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
              !accessGroup.isEmpty else { throw CloudCompanionIdentityError.invalidAccount }
        return Self.keychainQuery(accountID: accountID, accessGroup: accessGroup)
    }

    public static func keychainQuery(accountID: String, accessGroup: String = defaultAccessGroup) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: accountID,
         kSecAttrAccessGroup as String: accessGroup,
         kSecAttrSynchronizable as String: true,
         kSecUseDataProtectionKeychain as String: true]
    }
}
