import CloudKit
import Foundation
import Security
import Testing
@testable import MapleCompanionTransport

@MainActor private final class FixtureCloudAccount: CloudCompanionAccountProviding {
    var status = CKAccountStatus.available
    var name = "synthetic-private-account-one"
    var nameRequests = 0
    func accountStatus() async throws -> CKAccountStatus { status }
    func userRecordName() async throws -> String { nameRequests += 1; return name }
}

@MainActor private final class FixtureCloudKeychain: CloudCompanionKeychain {
    var items: [String: Data] = [:]
    var lastAdd: [String: Any]?
    var lastRead: [String: Any]?
    var duplicateWinner: Data?
    var error: OSStatus?
    var adds = 0
    private func key(_ query: [String: Any]) -> String {
        "\(query[kSecAttrAccessGroup as String] ?? "")|\(query[kSecAttrService as String] ?? "")|\(query[kSecAttrAccount as String] ?? "")"
    }
    func copyMatching(_ query: [String: Any]) -> (OSStatus, Data?) {
        lastRead = query
        if let error { return (error, nil) }
        guard let data = items[key(query)] else { return (errSecItemNotFound, nil) }
        return (errSecSuccess, data)
    }
    func add(_ attributes: [String: Any]) -> OSStatus {
        adds += 1; lastAdd = attributes
        if let error { return error }
        if let duplicateWinner { items[key(attributes)] = duplicateWinner; self.duplicateWinner = nil; return errSecDuplicateItem }
        if items[key(attributes)] != nil { return errSecDuplicateItem }
        items[key(attributes)] = attributes[kSecValueData as String] as? Data
        return errSecSuccess
    }
    func delete(_ query: [String: Any]) -> OSStatus {
        if let error { return error }
        return items.removeValue(forKey: key(query)) == nil ? errSecItemNotFound : errSecSuccess
    }
    func seed(_ data: Data, account: String, group: String = CloudCompanionIdentity.defaultAccessGroup) {
        items[key(CloudCompanionIdentity.keychainQuery(accountID: account, accessGroup: group))] = data
    }
}

@MainActor struct CloudIdentityTests {
    @Test func accountScopeIsHashedAndUnavailableAccountCannotLookupIdentity() async throws {
        let account = FixtureCloudAccount(), backend = FixtureCloudKeychain()
        let identity = CloudCompanionIdentity(accountProvider: account, keychain: backend)
        let first = try await identity.accountID()
        #expect(first.count == 64 && !first.contains(account.name))
        #expect(try await identity.accountID() == first)
        account.name = "synthetic-private-account-two"
        #expect(try await identity.accountID() != first)
        let otherContainer = CloudCompanionIdentity(containerIdentifier: "iCloud.fixture.other", accountProvider: account, keychain: backend)
        #expect(try await otherContainer.accountID() != identity.accountID())
        account.status = .noAccount
        let previous = account.nameRequests
        await #expect(throws: CloudCompanionIdentityError.self) { try await identity.accountID() }
        #expect(account.nameRequests == previous)
        #expect(backend.lastRead == nil)
    }

    @Test func synchronizedSharedKeychainAttributesAndProposedIdentityArePreserved() async throws {
        let account = FixtureCloudAccount(), backend = FixtureCloudKeychain()
        let identity = CloudCompanionIdentity(accessGroup: "FIXTUREPREFIX.com.just.maple.companion", accountProvider: account, keychain: backend)
        let scoped = try await identity.accountID(), proposed = try PairingConfiguration.create()
        #expect(try identity.load(accountID: scoped) == nil)
        #expect(try identity.publishNew(accountID: scoped, configuration: proposed) == proposed)
        let attributes = try #require(backend.lastAdd)
        #expect(attributes[kSecAttrSynchronizable as String] as? Bool == true)
        #expect(attributes[kSecUseDataProtectionKeychain as String] as? Bool == true)
        #expect(attributes[kSecAttrAccessGroup as String] as? String == "FIXTUREPREFIX.com.just.maple.companion")
        #expect(attributes[kSecAttrAccessible as String] as? String == kSecAttrAccessibleAfterFirstUnlock as String)
        #expect(attributes[kSecAttrAccount as String] as? String == scoped)
        #expect(try identity.load(accountID: scoped) == proposed)
        #expect(backend.lastRead?[kSecUseAuthenticationUI as String] as? String == kSecUseAuthenticationUIFail as String)
        #expect(try identity.publishNew(accountID: scoped) == proposed)
        #expect(backend.adds == 1)
        try identity.remove(accountID: scoped)
        #expect(try identity.load(accountID: scoped) == nil)
        try identity.remove(accountID: scoped)
    }

    @Test func concurrentPublisherReloadsWinnerWithoutOverwrite() async throws {
        let account = FixtureCloudAccount(), backend = FixtureCloudKeychain()
        let identity = CloudCompanionIdentity(accountProvider: account, keychain: backend)
        let scoped = try await identity.accountID(), winner = try PairingConfiguration.create(), loser = try PairingConfiguration.create()
        backend.duplicateWinner = try SyncCodec.encode(winner)
        #expect(try identity.publishNew(accountID: scoped, configuration: loser) == winner)
        #expect(try identity.load(accountID: scoped) == winner)
        #expect(backend.adds == 1)
    }

    @Test func separateAccountsAndAccessGroupsCannotReadEachOthersKeys() async throws {
        let account = FixtureCloudAccount(), backend = FixtureCloudKeychain()
        let identity = CloudCompanionIdentity(accountProvider: account, keychain: backend)
        let first = try await identity.accountID()
        _ = try identity.publishNew(accountID: first)
        account.name = "synthetic-private-account-two"
        let second = try await identity.accountID()
        #expect(try identity.load(accountID: second) == nil)
        let otherGroup = CloudCompanionIdentity(accessGroup: "DIFFERENT.group", accountProvider: account, keychain: backend)
        #expect(try otherGroup.load(accountID: first) == nil)
        try identity.remove(accountID: second)
        #expect(try identity.load(accountID: first) != nil)
    }

    @Test func malformedAndShortSecretAndExpiringIdentityNeverBecomeCredentials() async throws {
        let account = FixtureCloudAccount(), backend = FixtureCloudKeychain()
        let identity = CloudCompanionIdentity(accountProvider: account, keychain: backend)
        let scoped = try await identity.accountID()
        for data in [Data("malformed".utf8), try SyncCodec.encode(PairingConfiguration(id: UUID(), secret: Data(count: 31), serviceName: UUID())), try SyncCodec.encode(PairingConfiguration.create(expiresAt: Date()))] {
            backend.seed(data, account: scoped)
            #expect(throws: CloudCompanionIdentityError.self) { try identity.load(accountID: scoped) }
            #expect(throws: CloudCompanionIdentityError.self) { try identity.publishNew(accountID: scoped) }
            #expect(backend.adds == 0)
        }
        #expect(throws: CloudCompanionIdentityError.self) { try identity.load(accountID: "raw-user-name") }
        backend.error = errSecInteractionNotAllowed
        #expect(throws: CompanionTransportError.self) { try identity.load(accountID: scoped) }
        #expect(throws: CompanionTransportError.self) { try identity.remove(accountID: scoped) }
    }
}
