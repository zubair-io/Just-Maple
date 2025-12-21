//
//  KeychainHelper.swift
//  Shared Services
//
//  Keychain access helper for shared app group
//

import Foundation
import Security

/// Helper to access shared keychain across app and extensions
class KeychainHelper {
    static let shared = KeychainHelper()

    private let keychainService = "com.just.maple.JapaneseMaple"
    private let accessGroup = "group.com.just.maple.JapaneseMaple"
    private let tokenKeyPrefix = "bearer_token"

    private init() {}

    /// Get JWT token from keychain with debug information
    func getTokenWithDebug(serverId: String? = nil) -> (token: String?, debug: [String]) {
        var debug: [String] = []

        // Try multiple possible account keys to find the token
        var accountsToTry: [String] = []

        if let serverId = serverId, !serverId.isEmpty {
            accountsToTry.append("\(tokenKeyPrefix):\(serverId)")
        } else {
            // Try common server URLs
            accountsToTry = [
                "\(tokenKeyPrefix):https://justmaple.app",
                "\(tokenKeyPrefix):https://paperbark.justmaple.app",
                "\(tokenKeyPrefix):https://localhost:4200",
            ]
        }

        debug.append("Trying \(accountsToTry.count) accounts:")
        for account in accountsToTry {
            debug.append("  • \(account)")
        }

        // Try each possible account
        for account in accountsToTry {
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: keychainService,
                kSecAttrAccount as String: account,
                kSecReturnData as String: true,
                kSecMatchLimit as String: kSecMatchLimitOne,
                kSecAttrAccessGroup as String: accessGroup,
            ]

            var result: AnyObject?
            let status = SecItemCopyMatching(query as CFDictionary, &result)

            if status == errSecSuccess,
               let data = result as? Data,
               let token = String(data: data, encoding: .utf8)
            {
                debug.append("✅ Found at: \(account)")
                print("[KeychainHelper] ✅ Found token with account: \(account)")
                return (token, debug)
            } else {
                debug.append("❌ Not found (status: \(status))")
            }
        }

        debug.append("")
        debug.append("Listing all keychain items...")

        // Debug: List all keychain items in our access group
        let allItems = listAllKeychainItemsDebug()
        debug.append(contentsOf: allItems)

        print("[KeychainHelper] ❌ No token found in any account")
        return (nil, debug)
    }

    /// Get JWT token from keychain
    /// - Parameter serverId: Optional server ID. If nil, tries multiple possible accounts
    func getToken(serverId: String? = nil) -> String? {
        // Try multiple possible account keys to find the token
        var accountsToTry: [String] = []

        if let serverId = serverId, !serverId.isEmpty {
            accountsToTry.append("\(tokenKeyPrefix):\(serverId)")
        } else {
            // Try common server URLs
            accountsToTry = [
                "\(tokenKeyPrefix):https://justmaple.app",
                "\(tokenKeyPrefix):https://paperbark.justmaple.app",
                "\(tokenKeyPrefix):https://localhost:4200",
            ]
        }

        // Try each possible account
        for account in accountsToTry {
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: keychainService,
                kSecAttrAccount as String: account,
                kSecReturnData as String: true,
                kSecMatchLimit as String: kSecMatchLimitOne,
                kSecAttrAccessGroup as String: accessGroup,
            ]

            var result: AnyObject?
            let status = SecItemCopyMatching(query as CFDictionary, &result)

            if status == errSecSuccess,
               let data = result as? Data,
               let token = String(data: data, encoding: .utf8)
            {
                print("[KeychainHelper] ✅ Found token with account: \(account)")
                return token
            }
        }

        print("[KeychainHelper] ❌ No token found in any account")

        // Debug: List all keychain items in our access group
        listAllKeychainItems()

        return nil
    }

    /// Debug helper: List all keychain items in the app group (returns debug strings)
    private func listAllKeychainItemsDebug() -> [String] {
        var debug: [String] = []

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitAll,
            kSecAttrAccessGroup as String: accessGroup,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        if status == errSecSuccess, let items = result as? [[String: Any]] {
            debug.append("Found \(items.count) items:")
            for item in items {
                if let account = item[kSecAttrAccount as String] as? String {
                    debug.append("  • \(account)")
                    print("[KeychainHelper]   - Account: \(account)")
                }
            }
        } else {
            debug.append("No items (status: \(status))")
            if status == -25300 {
                debug.append("(-25300 = errSecItemNotFound)")
            } else if status == -34018 {
                debug.append("(-34018 = access denied)")
                debug.append("Check App Groups!")
            }
            print("[KeychainHelper] 🔍 No items found in keychain (status: \(status))")
        }

        debug.append("")
        debug.append("Config:")
        debug.append("Service: \(keychainService)")
        debug.append("Group: \(accessGroup)")

        return debug
    }

    /// Debug helper: List all keychain items in the app group
    private func listAllKeychainItems() {
        let _ = listAllKeychainItemsDebug()
    }

    /// Save JWT token to keychain (used by iPhone app for sync)
    func saveToken(_ token: String, serverId: String? = nil) -> Bool {
        let data = token.data(using: .utf8)!
        let account: String
        if let serverId = serverId, !serverId.isEmpty {
            account = "\(tokenKeyPrefix):\(serverId)"
        } else {
            account = "\(tokenKeyPrefix):https://justmaple.app"
        }

        // Delete existing token first
        let deleteQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: accessGroup,
        ]
        SecItemDelete(deleteQuery as CFDictionary)

        // Add new token
        let addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
            kSecAttrAccessGroup as String: accessGroup,
        ]

        let status = SecItemAdd(addQuery as CFDictionary, nil)
        let success = status == errSecSuccess

        if success {
            print("[KeychainHelper] Successfully saved token")
        } else {
            print("[KeychainHelper] Failed to save token: \(status)")
        }

        return success
    }

    /// Clear JWT token from keychain
    func clearToken(serverId: String? = nil) -> Bool {
        let account: String
        if let serverId = serverId, !serverId.isEmpty {
            account = "\(tokenKeyPrefix):\(serverId)"
        } else {
            account = "\(tokenKeyPrefix):https://justmaple.app"
        }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keychainService,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: accessGroup,
        ]

        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }
}
