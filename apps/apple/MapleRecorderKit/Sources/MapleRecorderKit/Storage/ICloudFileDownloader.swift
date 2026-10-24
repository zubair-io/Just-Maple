import Foundation

/// Utility for downloading iCloud placeholder files before playback or processing.
enum ICloudFileDownloader {

    /// Checks whether the file at `url` is fully downloaded from iCloud.
    nonisolated static func isDownloaded(url: URL) -> Bool {
        guard let values = try? url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]),
              let status = values.ubiquitousItemDownloadingStatus else {
            // Not an iCloud file or can't determine — assume available
            return true
        }
        return status == .current
    }

    /// Ensures the file at `url` is downloaded from iCloud.
    /// If it's a placeholder, triggers a download and polls until complete or timeout.
    static func ensureDownloaded(url: URL, timeout: TimeInterval = 60) async throws {
        if isDownloaded(url: url) { return }

        try FileManager.default.startDownloadingUbiquitousItem(at: url)

        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if isDownloaded(url: url) { return }
            try await Task.sleep(for: .milliseconds(500))
        }

        throw DownloadError.timeout
    }

    /// Downloads all files at the given URLs, throwing on the first failure.
    static func ensureAllDownloaded(urls: [URL], timeout: TimeInterval = 120) async throws {
        for url in urls {
            try await ensureDownloaded(url: url, timeout: timeout)
        }
    }

    enum DownloadError: LocalizedError {
        case timeout

        var errorDescription: String? {
            "Timed out waiting for iCloud file download."
        }
    }
}
