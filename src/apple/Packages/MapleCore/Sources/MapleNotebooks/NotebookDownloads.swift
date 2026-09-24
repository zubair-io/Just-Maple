import Foundation

public enum NotebookDownloads {
    /// A listed iCloud item may only be metadata. Request materialization, then wait before
    /// the coordinated read. Never create an empty replacement for an unavailable note.
    public static func prepare(_ url:URL) async throws {
        let keys:Set<URLResourceKey>=[.isUbiquitousItemKey,.ubiquitousItemDownloadingStatusKey]
        let placeholder=url.deletingLastPathComponent().appendingPathComponent("."+url.lastPathComponent+".icloud")
        let values=try? url.resourceValues(forKeys:keys)
        guard values?.isUbiquitousItem==true || FileManager.default.fileExists(atPath:placeholder.path) else{return}
        try FileManager.default.startDownloadingUbiquitousItem(at:url)
        for _ in 0..<60 {
            try Task.checkCancellation()
            // A fresh URL avoids stale cached metadata from directory enumeration.
            let fresh=URL(fileURLWithPath:url.path)
            let state=try? fresh.resourceValues(forKeys:keys)
            if FileManager.default.fileExists(atPath:fresh.path),
               state?.ubiquitousItemDownloadingStatus == .current || state?.ubiquitousItemDownloadingStatus == .downloaded {return}
            try await Task.sleep(for:.milliseconds(250))
        }
        throw NotebookError.invalid("This note is still downloading from iCloud. Check your connection and try opening it again. The original note has not been changed.")
    }
}
