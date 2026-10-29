import Foundation

/// Each host can use its own container and Keychain service without changing existing installs.
nonisolated enum RecorderHostConfiguration {
    static func cloudContainer(_ info: [String: Any]) -> String {
        info["MapleRecorderICloudContainer"] as? String ?? "iCloud.com.just.maple.JapaneseMaple"
    }
    static func keychainService(_ info: [String: Any]) -> String {
        info["MapleRecorderKeychainService"] as? String ?? "com.just.maple.JapaneseMaple.recorder"
    }
    static func localDocuments(_ documents: URL, info: [String: Any]) -> URL {
        guard let directory = info["MapleRecorderLocalDirectory"] as? String,
              !directory.isEmpty, !directory.contains("/"), !directory.contains("..") else { return documents }
        return documents.appendingPathComponent(directory, isDirectory: true)
    }
}
