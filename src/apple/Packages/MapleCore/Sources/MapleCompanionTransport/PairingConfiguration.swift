import Foundation
import Security

public enum CompanionTransportError: Error, Sendable {
    case invalidConfiguration, randomGeneration, keychain(OSStatus), invalidFrame, disconnected, timedOut, stopped
}

public struct PairingConfiguration: Codable, Sendable, Equatable {
    public let id: UUID
    public let secret: Data
    public let serviceName: UUID
    public let expiresAt: Date?

    public init(id: UUID, secret: Data, serviceName: UUID, expiresAt: Date? = nil) {
        self.id = id; self.secret = secret; self.serviceName = serviceName; self.expiresAt = expiresAt
    }

    public static func create(expiresAt: Date? = nil) throws -> Self {
        var secret = Data(count: 32)
        let result = secret.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }
        guard result == errSecSuccess else { throw CompanionTransportError.randomGeneration }
        return Self(id: UUID(), secret: secret, serviceName: UUID(), expiresAt: expiresAt)
    }
}

public enum PairingKeychain {
    private static func query(service: String, account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
         kSecAttrAccount as String: account, kSecUseDataProtectionKeychain as String: true]
    }
    public static func save(_ data: Data, service: String, account: String) throws {
        let query = query(service: service, account: account)
        let attributes: [String: Any] = [kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw CompanionTransportError.keychain(status) }
    }
    public static func load(service: String, account: String) throws -> Data? {
        var query = query(service: service, account: account)
        query[kSecUseAuthenticationUI as String] = kSecUseAuthenticationUIFail
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw CompanionTransportError.keychain(status) }
        return data
    }
    public static func delete(service: String, account: String) throws {
        let status = SecItemDelete(query(service: service, account: account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw CompanionTransportError.keychain(status) }
    }
}
