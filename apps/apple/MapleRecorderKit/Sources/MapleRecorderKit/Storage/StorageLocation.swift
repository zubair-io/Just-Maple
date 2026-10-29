import Foundation

enum StorageLocation {
    static var iCloudContainerId: String {
        RecorderHostConfiguration.cloudContainer(Bundle.main.infoDictionary ?? [:])
    }

    /// Whether iCloud Drive is available for this app.
    static var isICloudAvailable: Bool {
        FileManager.default.url(forUbiquityContainerIdentifier: iCloudContainerId) != nil
    }

    static var recordingsURL: URL {
        if let iCloudURL = FileManager.default
            .url(forUbiquityContainerIdentifier: iCloudContainerId)?
            .appendingPathComponent("Documents").appendingPathComponent("MapleRecorder").appendingPathComponent("recordings") {
            return iCloudURL
        }
        return localRecordingsURL
    }

    static var localDocumentsURL: URL {
        RecorderHostConfiguration.localDocuments(
            FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0],
            info: Bundle.main.infoDictionary ?? [:])
    }

    /// The sandbox-local recordings path, used when iCloud is unavailable.
    static var localRecordingsURL: URL {
        localDocumentsURL
            .appendingPathComponent("MapleRecorder").appendingPathComponent("recordings")
    }

    static func ensureDirectoryExists() throws {
        let url = recordingsURL
        if !FileManager.default.fileExists(atPath: url.path(percentEncoded: false)) {
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        }
    }

    /// Migrates any recordings from the local sandbox folder into iCloud Drive.
    /// Call once at startup after iCloud becomes available.
    static func migrateLocalToICloudIfNeeded() {
        guard isICloudAvailable else { return }

        let localURL = localRecordingsURL
        let iCloudURL = recordingsURL

        // Nothing to migrate if same path or local folder doesn't exist
        guard localURL != iCloudURL,
              FileManager.default.fileExists(atPath: localURL.path(percentEncoded: false)) else { return }

        guard let files = try? FileManager.default.contentsOfDirectory(
            at: localURL,
            includingPropertiesForKeys: nil,
            options: .skipsHiddenFiles
        ), !files.isEmpty else { return }

        // Ensure iCloud destination exists
        if !FileManager.default.fileExists(atPath: iCloudURL.path(percentEncoded: false)) {
            try? FileManager.default.createDirectory(at: iCloudURL, withIntermediateDirectories: true)
        }

        for file in files {
            let dest = iCloudURL.appendingPathComponent(file.lastPathComponent)
            // Skip if a file with the same name already exists in iCloud
            guard !FileManager.default.fileExists(atPath: dest.path(percentEncoded: false)) else { continue }
            do {
                try FileManager.default.moveItem(at: file, to: dest)
            } catch {
                print("Migration: Failed to move \(file.lastPathComponent) to iCloud: \(error)")
            }
        }

        print("Migration: Moved \(files.count) file(s) from local sandbox to iCloud Drive")
    }
}
