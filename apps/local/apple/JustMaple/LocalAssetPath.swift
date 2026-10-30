import Foundation

nonisolated enum LocalAssetPath {
    static func resolve(_ url: URL, root: URL) -> URL? {
        guard url.scheme == "app", url.host == "localhost", url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil else { return nil }
        let relative = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !relative.split(separator: "/").contains("..") else { return nil }
        let base = root.standardizedFileURL.resolvingSymlinksInPath()
        let file = base.appendingPathComponent(relative.isEmpty ? "index.html" : relative)
            .standardizedFileURL.resolvingSymlinksInPath()
        guard file.path.hasPrefix(base.path + "/") else { return nil }
        if FileManager.default.fileExists(atPath: file.path) { return file }
        // Client-side routes get the bundled entry point; missing static assets fail.
        return file.pathExtension.isEmpty ? base.appendingPathComponent("index.html") : nil
    }
}
