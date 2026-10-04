import Foundation

public enum NotebookDownloads {
    struct State: Sendable {
        var ubiquitous: Bool
        var placeholder: Bool
        var exists: Bool
        var locallyReadable: Bool
    }
    struct Environment: Sendable {
        var state: @Sendable (URL) async throws -> State
        var request: @Sendable (URL) async throws -> Void
        var pause: @Sendable () async throws -> Void
        static let live = Environment(state: { url in
            // Do not reuse directory-enumeration URLs with cached metadata.
            let fresh=URL(fileURLWithPath:url.path)
            let placeholder=fresh.deletingLastPathComponent().appendingPathComponent("."+fresh.lastPathComponent+".icloud")
            let exists=FileManager.default.fileExists(atPath:fresh.path)
            let hasPlaceholder=FileManager.default.fileExists(atPath:placeholder.path)
            let values:URLResourceValues?
            do {values=try fresh.resourceValues(forKeys:[.isUbiquitousItemKey,.ubiquitousItemDownloadingStatusKey])}
            catch let error as NSError where error.domain==NSCocoaErrorDomain && error.code==NSFileReadNoSuchFileError {values=nil}
            return State(ubiquitous:values?.isUbiquitousItem==true,placeholder:hasPlaceholder,exists:exists,
                         locallyReadable:values?.ubiquitousItemDownloadingStatus == .current || values?.ubiquitousItemDownloadingStatus == .downloaded)
        },request: {try FileManager.default.startDownloadingUbiquitousItem(at:$0)},pause: {try await Task.sleep(for:.milliseconds(250))})
    }
    /// A listed iCloud item may only be metadata. Request materialization, then wait before
    /// the coordinated read. Never create an empty replacement for an unavailable note.
    public static func prepare(_ url:URL) async throws {
        try await prepare(url,environment:.live)
    }
    static func prepare(_ url:URL,environment:Environment,attempts:Int=60) async throws {
        try Task.checkCancellation()
        let initial=try await environment.state(url)
        guard initial.ubiquitous || initial.placeholder else{return}
        // A downloaded local copy remains usable offline. Requesting another
        // download first can unnecessarily fail a read of already-present bytes.
        if initial.exists && initial.locallyReadable {return}
        try await environment.request(url)
        for _ in 0..<attempts {
            try Task.checkCancellation()
            let state=try await environment.state(url)
            if state.exists && state.locallyReadable {return}
            try await environment.pause()
        }
        throw NotebookError.invalid("This note is still downloading from iCloud. Check your connection and try opening it again. The original note has not been changed.")
    }
}
