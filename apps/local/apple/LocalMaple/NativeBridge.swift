//
//  NativeBridge.swift
//  LocalMaple
//
//  Created by Zubair Lawrence on 11/30/25.
//

import Foundation
import WebKit

// MARK: - Message Types

enum WebToNativeMessage: Codable {
    case test(TestPayload)
    case openFolderPicker
    case listFiles(ListFilesPayload)
    case readFile(ReadFilePayload)
    case writeFile(WriteFilePayload)
    case deleteFile(DeleteFilePayload)
    case getICloudContainerPath
    case createICloudFolder(CreateICloudFolderPayload)
    case apiRequest(ApiRequestPayload)
    case unknown

    struct CreateICloudFolderPayload: Codable {
        let name: String
    }

    struct ApiRequestPayload: Codable {
        let requestId: String
        let url: String
        let method: String
        let headers: [String: String]?
        let body: String?
    }

    struct TestPayload: Codable {
        let message: String
        let timestamp: String
    }

    struct ListFilesPayload: Codable {
        let requestId: String
        let path: String
        let `extension`: String?
    }

    struct ReadFilePayload: Codable {
        let requestId: String
        let path: String
    }

    struct WriteFilePayload: Codable {
        let requestId: String
        let expectedVersion: String?
        let path: String
        let content: String
    }

    struct DeleteFilePayload: Codable {
        let requestId: String
        let path: String
    }

    enum CodingKeys: String, CodingKey {
        case type
        case payload
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)

        switch type {
        case "test":
            let payload = try container.decode(TestPayload.self, forKey: .payload)
            self = .test(payload)
        case "openFolderPicker":
            self = .openFolderPicker
        case "listFiles":
            let payload = try container.decode(ListFilesPayload.self, forKey: .payload)
            self = .listFiles(payload)
        case "readFile":
            let payload = try container.decode(ReadFilePayload.self, forKey: .payload)
            self = .readFile(payload)
        case "writeFile":
            let payload = try container.decode(WriteFilePayload.self, forKey: .payload)
            self = .writeFile(payload)
        case "deleteFile":
            let payload = try container.decode(DeleteFilePayload.self, forKey: .payload)
            self = .deleteFile(payload)
        case "getICloudContainerPath":
            self = .getICloudContainerPath
        case "createICloudFolder":
            let payload = try container.decode(CreateICloudFolderPayload.self, forKey: .payload)
            self = .createICloudFolder(payload)
        case "apiRequest":
            let payload = try container.decode(ApiRequestPayload.self, forKey: .payload)
            self = .apiRequest(payload)
        default:
            self = .unknown
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        switch self {
        case .test(let payload):
            try container.encode("test", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .openFolderPicker:
            try container.encode("openFolderPicker", forKey: .type)
        case .listFiles(let payload):
            try container.encode("listFiles", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .readFile(let payload):
            try container.encode("readFile", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .writeFile(let payload):
            try container.encode("writeFile", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .deleteFile(let payload):
            try container.encode("deleteFile", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .getICloudContainerPath:
            try container.encode("getICloudContainerPath", forKey: .type)
        case .createICloudFolder(let payload):
            try container.encode("createICloudFolder", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .apiRequest(let payload):
            try container.encode("apiRequest", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .unknown:
            try container.encode("unknown", forKey: .type)
        }
    }
}

enum NativeToWebMessage {
    case initialize(InitialState)
    case testResponse(TestResponse)
    case deepLink(DeepLinkPayload)
    case folderPickerResult(FolderPickerResult)
    case fileListResult(FileListResult)
    case fileReadResult(FileReadResult)
    case fileWriteResult(FileWriteResult)
    case fileDeleteResult(FileDeleteResult)
    case icloudContainerPath(ICloudContainerPathResult)
    case icloudFolderCreated(ICloudFolderCreatedResult)
    case apiResponse(ApiResponseResult)
    case error(ErrorMessage)

    struct InitialState: Codable {
        let appVersion: String
        let platform: String
        let timestamp: String
    }

    struct TestResponse: Codable {
        let success: Bool
        let message: String
        let receivedAt: String
    }

    struct ErrorMessage: Codable {
        let code: String
        let message: String
    }

    struct DeepLinkPayload: Codable {
        let url: String
    }

    struct FolderPickerResult: Codable {
        let path: String?
        let name: String?
    }

    struct FileListResult: Codable {
        let requestId: String
        let files: [FileInfo]
        let error: String?

        struct FileInfo: Codable {
            let name: String
            let path: String
            let lastModified: String?
        }
    }

    struct FileReadResult: Codable {
        let requestId: String
        var version: String? = nil
        let content: String?
        let error: String?
    }

    struct FileWriteResult: Codable {
        let requestId: String
        var version: String? = nil
        let success: Bool
        let error: String?
    }

    struct FileDeleteResult: Codable {
        let requestId: String
        let success: Bool
        let error: String?
    }

    struct ICloudContainerPathResult: Codable {
        let path: String?
        let folders: [FolderInfo]

        struct FolderInfo: Codable {
            let name: String
            let path: String
        }
    }

    struct ICloudFolderCreatedResult: Codable {
        let path: String?
        let name: String
        let error: String?
    }

    struct ApiResponseResult: Codable {
        let requestId: String
        let status: Int
        let statusText: String
        let durationMs: Int
        let body: String
    }

    enum CodingKeys: String, CodingKey {
        case type
        case payload
    }
}

extension NativeToWebMessage: Encodable {
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        switch self {
        case .initialize(let state):
            try container.encode("initialize", forKey: .type)
            try container.encode(state, forKey: .payload)
        case .testResponse(let response):
            try container.encode("testResponse", forKey: .type)
            try container.encode(response, forKey: .payload)
        case .deepLink(let payload):
            try container.encode("deepLink", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .folderPickerResult(let payload):
            try container.encode("folderPickerResult", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .fileListResult(let payload):
            try container.encode("fileListResult", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .fileReadResult(let payload):
            try container.encode("fileReadResult", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .fileWriteResult(let payload):
            try container.encode("fileWriteResult", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .fileDeleteResult(let payload):
            try container.encode("fileDeleteResult", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .icloudContainerPath(let payload):
            try container.encode("icloudContainerPath", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .icloudFolderCreated(let payload):
            try container.encode("icloudFolderCreated", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .apiResponse(let payload):
            try container.encode("apiResponse", forKey: .type)
            try container.encode(payload, forKey: .payload)
        case .error(let payload):
            try container.encode("error", forKey: .type)
            try container.encode(payload, forKey: .payload)
        }
    }
}

// MARK: - Native Bridge

class NativeBridge: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?
    private let documents = LocalDocumentStore()
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private var folderPickerObserver: NSObjectProtocol?
    /// Security-scoped folder URLs granted by the user via folder picker.
    /// Must be kept alive so file operations within these folders are allowed by the sandbox.
    private var grantedFolderURLs: [URL] = []

    private static let bookmarksKey = "SecurityScopedBookmarks"

    init(webView: WKWebView?) {
        self.webView = webView
        super.init()
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601
        documents.grant(FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0])
        restoreBookmarks()
    }

    deinit {
        // Balance all startAccessingSecurityScopedResource() calls
        for url in grantedFolderURLs {
            url.stopAccessingSecurityScopedResource()
        }
    }

    /// Add a security-scoped folder URL (used by external callers like menu commands)
    func addGrantedFolderURL(_ url: URL) {
        grantedFolderURLs.removeAll { $0.path == url.path }
        grantedFolderURLs.append(url)
        documents.grant(url)
        saveBookmark(for: url)
    }

    // MARK: - Receive from Web

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == "app",
              message.frameInfo.securityOrigin.host == "localhost" else { return }
        guard let body = message.body as? String,
              let data = body.data(using: .utf8) else {
            print("[Bridge] Invalid message format")
            return
        }

        do {
            let message = try decoder.decode(WebToNativeMessage.self, from: data)

            Task {
                await handle(message)
            }
        } catch {
            print("[Bridge] Failed to decode message: \(error)")
        }
    }

    // MARK: - Handle Messages

    private func handle(_ message: WebToNativeMessage) async {
        switch message {
        case .test(let payload):
            print("[Bridge] Test message: \(payload.message)")
            send(.testResponse(NativeToWebMessage.TestResponse(
                success: true,
                message: "Received your message: \(payload.message)",
                receivedAt: ISO8601DateFormatter().string(from: Date())
            )))

        case .openFolderPicker:
            #if os(macOS)
            Task { @MainActor in
                let panel = NSOpenPanel()
                panel.canChooseDirectories = true
                panel.canChooseFiles = false
                panel.allowsMultipleSelection = false
                panel.message = "Choose a folder to open"

                let response = panel.runModal()
                if response == .OK, let url = panel.url {
                    _ = url.startAccessingSecurityScopedResource()

                    self.grantedFolderURLs.removeAll { $0.path == url.path }
                    self.grantedFolderURLs.append(url)
                    self.documents.grant(url)
                    self.saveBookmark(for: url)

                    self.send(.folderPickerResult(NativeToWebMessage.FolderPickerResult(
                        path: url.path,
                        name: url.lastPathComponent
                    )))
                } else {
                    self.send(.folderPickerResult(NativeToWebMessage.FolderPickerResult(
                        path: nil,
                        name: nil
                    )))
                }
            }
            #elseif os(iOS)
            // Post notification for ContentView to present folder picker
            Task { @MainActor in
                // Remove previous observer if any
                if let prev = self.folderPickerObserver {
                    NotificationCenter.default.removeObserver(prev)
                    self.folderPickerObserver = nil
                }

                // Listen for result before posting request
                let observer = NotificationCenter.default.addObserver(
                    forName: NSNotification.Name("FolderPickerResult"),
                    object: nil,
                    queue: .main
                ) { [weak self] notification in
                    // Remove observer after receiving result
                    if let obs = self?.folderPickerObserver {
                        NotificationCenter.default.removeObserver(obs)
                        self?.folderPickerObserver = nil
                    }

                    let path = notification.userInfo?["path"] as? String
                    let name = notification.userInfo?["name"] as? String

                    // Store the security-scoped URL for later file operations
                    if let url = notification.userInfo?["url"] as? URL {
                        self?.grantedFolderURLs.removeAll { $0.path == url.path }
                        self?.grantedFolderURLs.append(url)
                        self?.documents.grant(url)
                        self?.saveBookmark(for: url)
                    }

                    self?.send(.folderPickerResult(NativeToWebMessage.FolderPickerResult(
                        path: path,
                        name: name
                    )))
                }

                self.folderPickerObserver = observer

                NotificationCenter.default.post(name: NSNotification.Name("FolderPickerRequested"), object: nil)
            }
            #endif

        case .listFiles(let payload):
            handleListFiles(payload)

        case .readFile(let payload):
            await handleReadFile(payload)

        case .writeFile(let payload):
            await handleWriteFile(payload)

        case .deleteFile(let payload):
            handleDeleteFile(payload)

        case .getICloudContainerPath:
            handleGetICloudContainerPath()

        case .createICloudFolder(let payload):
            handleCreateICloudFolder(payload)

        case .apiRequest(let payload):
            send(.apiResponse(NativeToWebMessage.ApiResponseResult(requestId: payload.requestId,
                status: 0, statusText: "Unavailable", durationMs: 0,
                body: "Network request blocks are unavailable in Just Maple Local.")))

        case .unknown:
            print("[Bridge] Unknown message type")
        }
    }

    // MARK: - File System Operations

    /// Find the granted security-scoped folder URL that contains the given path.
    private func grantedFolderURL(for path: String) -> URL? {
        return grantedFolderURLs.first { folderURL in
            let folderPath = folderURL.path.hasSuffix("/") ? folderURL.path : folderURL.path + "/"
            return path.hasPrefix(folderPath) || path == folderURL.path
        }
    }

    /// Convert a path string to a URL, preferring a security-scoped URL derived
    /// from a previously granted folder when available.
    private func securityScopedURL(for path: String) throws -> URL {
        try documents.resolve(path)
    }

    private func handleListFiles(_ payload: WebToNativeMessage.ListFilesPayload) {
        let fileManager = FileManager.default
        do {
            let dirURL = try securityScopedURL(for: payload.path)
            let contents = try fileManager.contentsOfDirectory(
                at: dirURL,
                includingPropertiesForKeys: [.isDirectoryKey, .contentModificationDateKey],
                options: [.skipsHiddenFiles]
            )
            let filterExt = payload.extension

            let fileInfos: [NativeToWebMessage.FileListResult.FileInfo] = contents.compactMap { fileURL in
                let name = fileURL.lastPathComponent

                // Filter by extension if specified
                if let ext = filterExt {
                    let normalizedExt = ext.hasPrefix(".") ? ext : ".\(ext)"
                    guard name.hasSuffix(normalizedExt) else { return nil }
                }

                // Skip directories
                let resourceValues = try? fileURL.resourceValues(forKeys: [.isDirectoryKey, .contentModificationDateKey])
                if resourceValues?.isDirectory == true { return nil }

                // Get last modified date
                var lastModified: String? = nil
                if let modDate = resourceValues?.contentModificationDate {
                    lastModified = ISO8601DateFormatter().string(from: modDate)
                }

                return NativeToWebMessage.FileListResult.FileInfo(
                    name: name,
                    path: fileURL.path,
                    lastModified: lastModified
                )
            }

            send(.fileListResult(NativeToWebMessage.FileListResult(
                requestId: payload.requestId,
                files: fileInfos,
                error: nil
            )))
        } catch {
            send(.fileListResult(NativeToWebMessage.FileListResult(
                requestId: payload.requestId,
                files: [],
                error: error.localizedDescription
            )))
        }
    }

    private func handleReadFile(_ payload: WebToNativeMessage.ReadFilePayload) async {
        do {
            let store = documents
            let path = payload.path
            let snapshot = try await Task.detached(priority: .userInitiated) { try store.read(path) }.value
            send(.fileReadResult(NativeToWebMessage.FileReadResult(
                requestId: payload.requestId,
                version: snapshot.version,
                content: snapshot.content,
                error: nil
            )))
        } catch {
            send(.fileReadResult(NativeToWebMessage.FileReadResult(
                requestId: payload.requestId,
                content: nil,
                error: error.localizedDescription
            )))
        }
    }

    private func handleWriteFile(_ payload: WebToNativeMessage.WriteFilePayload) async {
        do {
            let store = documents
            let path = payload.path, content = payload.content, expected = payload.expectedVersion
            let version = try await Task.detached(priority: .userInitiated) {
                try store.write(path, content: content, expectedVersion: expected)
            }.value
            send(.fileWriteResult(NativeToWebMessage.FileWriteResult(
                requestId: payload.requestId, version: version, success: true, error: nil)))
        } catch {
            send(.fileWriteResult(NativeToWebMessage.FileWriteResult(
                requestId: payload.requestId, success: false, error: error.localizedDescription)))
        }
    }

    private func handleDeleteFile(_ payload: WebToNativeMessage.DeleteFilePayload) {
        do {
            let fileURL = try securityScopedURL(for: payload.path)
            guard fileURL.pathExtension.lowercased() == "md",
                  try fileURL.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true
            else { throw LocalDocumentStore.StoreError.outsideFolder }
            try FileManager.default.removeItem(at: fileURL)
            send(.fileDeleteResult(NativeToWebMessage.FileDeleteResult(
                requestId: payload.requestId,
                success: true,
                error: nil
            )))
        } catch {
            send(.fileDeleteResult(NativeToWebMessage.FileDeleteResult(
                requestId: payload.requestId,
                success: false,
                error: error.localizedDescription
            )))
        }
    }

    // MARK: - iCloud Container

    private func handleGetICloudContainerPath() {
        // Must run on a background thread — url(forUbiquityContainerIdentifier:) can
        // block and return nil when called on the main thread.
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }

            guard let containerURL = FileManager.default.url(forUbiquityContainerIdentifier: "iCloud.com.just.maple.Local") else {
                print("[Bridge] iCloud container not available")
                self.send(.icloudContainerPath(NativeToWebMessage.ICloudContainerPathResult(path: nil, folders: [])))
                return
            }

            // Use the Documents subfolder inside the iCloud container
            let docsURL = containerURL.appendingPathComponent("Documents")
            self.documents.grant(docsURL)

            let fm = FileManager.default
            // Create it if it doesn't exist
            if !fm.fileExists(atPath: docsURL.path) {
                try? fm.createDirectory(at: docsURL, withIntermediateDirectories: true)
            }

            // Grant sandbox access so file operations work
            DispatchQueue.main.async {
                _ = docsURL.startAccessingSecurityScopedResource()
                self.grantedFolderURLs.removeAll { $0.path == docsURL.path }
                self.grantedFolderURLs.append(docsURL)
            }

            // Enumerate child folders
            var folders: [NativeToWebMessage.ICloudContainerPathResult.FolderInfo] = []
            if let contents = try? fm.contentsOfDirectory(
                at: docsURL,
                includingPropertiesForKeys: [.isDirectoryKey],
                options: [.skipsHiddenFiles]
            ) {
                for url in contents {
                    let isDir = (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory ?? false
                    if isDir {
                        folders.append(NativeToWebMessage.ICloudContainerPathResult.FolderInfo(
                            name: url.lastPathComponent,
                            path: url.path
                        ))
                    }
                }
            }

            // Auto-create a default notebook if the container is empty
            if folders.isEmpty {
                let defaultURL = docsURL.appendingPathComponent("My Notes")
                try? fm.createDirectory(at: defaultURL, withIntermediateDirectories: true)

                let introURL = defaultURL.appendingPathComponent("Welcome.md")
                if !fm.fileExists(atPath: introURL.path) {
                    let intro = """
                    # Welcome to Just Maple Local

                    This is your **iCloud notebook**. Notes you create here sync automatically across all your Apple devices.

                    ## Getting started

                    - Create new notes from the **+** button in the sidebar
                    - Organize by creating more notebooks in iCloud or locally
                    - All notes are saved as `.md` files you can open anywhere

                    Happy writing!
                    """
                    try? intro.write(to: introURL, atomically: true, encoding: .utf8)
                }

                folders.append(NativeToWebMessage.ICloudContainerPathResult.FolderInfo(
                    name: "My Notes",
                    path: defaultURL.path
                ))
            }

            print("[Bridge] iCloud container path: \(docsURL.path), folders: \(folders.count)")
            self.send(.icloudContainerPath(NativeToWebMessage.ICloudContainerPathResult(
                path: docsURL.path,
                folders: folders
            )))
        }
    }

    private func handleCreateICloudFolder(_ payload: WebToNativeMessage.CreateICloudFolderPayload) {
        // Must run on a background thread — url(forUbiquityContainerIdentifier:) can
        // block and return nil when called on the main thread.
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }

            guard let containerURL = FileManager.default.url(forUbiquityContainerIdentifier: "iCloud.com.just.maple.Local") else {
                self.send(.icloudFolderCreated(NativeToWebMessage.ICloudFolderCreatedResult(
                    path: nil, name: payload.name, error: "iCloud container not available"
                )))
                return
            }

            let docsURL = containerURL.appendingPathComponent("Documents")
            self.documents.grant(docsURL)
            let folderURL = docsURL.appendingPathComponent(payload.name)
            let fm = FileManager.default

            // Ensure Documents directory exists
            if !fm.fileExists(atPath: docsURL.path) {
                try? fm.createDirectory(at: docsURL, withIntermediateDirectories: true)
            }

            do {
                try fm.createDirectory(at: folderURL, withIntermediateDirectories: true)

                // Grant sandbox access on main thread
                DispatchQueue.main.async {
                    _ = folderURL.startAccessingSecurityScopedResource()
                    self.grantedFolderURLs.removeAll { $0.path == folderURL.path }
                    self.grantedFolderURLs.append(folderURL)
                }

                print("[Bridge] Created iCloud folder: \(folderURL.path)")
                self.send(.icloudFolderCreated(NativeToWebMessage.ICloudFolderCreatedResult(
                    path: folderURL.path, name: payload.name, error: nil
                )))
            } catch {
                print("[Bridge] Failed to create iCloud folder: \(error)")
                self.send(.icloudFolderCreated(NativeToWebMessage.ICloudFolderCreatedResult(
                    path: nil, name: payload.name, error: error.localizedDescription
                )))
            }
        }
    }

    // MARK: - API Requests

    private func handleApiRequest(_ payload: WebToNativeMessage.ApiRequestPayload) {
        guard let url = URL(string: payload.url) else {
            send(.apiResponse(NativeToWebMessage.ApiResponseResult(
                requestId: payload.requestId,
                status: 0,
                statusText: "Invalid URL",
                durationMs: 0,
                body: "{\"error\":\"Invalid URL: \(payload.url)\"}"
            )))
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = payload.method
        request.timeoutInterval = 30

        if let headers = payload.headers {
            for (key, value) in headers {
                request.setValue(value, forHTTPHeaderField: key)
            }
        }

        if let body = payload.body {
            request.httpBody = body.data(using: .utf8)
        }

        let start = Date()

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            let durationMs = Int(Date().timeIntervalSince(start) * 1000)

            if let error = error {
                self?.send(.apiResponse(NativeToWebMessage.ApiResponseResult(
                    requestId: payload.requestId,
                    status: 0,
                    statusText: "Network Error",
                    durationMs: durationMs,
                    body: "{\"error\":\"\(error.localizedDescription)\"}"
                )))
                return
            }

            let httpResponse = response as? HTTPURLResponse
            let status = httpResponse?.statusCode ?? 0
            let statusText = Self.httpStatusText(status)
            let body = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""

            self?.send(.apiResponse(NativeToWebMessage.ApiResponseResult(
                requestId: payload.requestId,
                status: status,
                statusText: statusText,
                durationMs: durationMs,
                body: body
            )))
        }.resume()
    }

    private static func httpStatusText(_ code: Int) -> String {
        switch code {
        case 200: return "OK"
        case 201: return "Created"
        case 204: return "No Content"
        case 301: return "Moved Permanently"
        case 302: return "Found"
        case 304: return "Not Modified"
        case 400: return "Bad Request"
        case 401: return "Unauthorized"
        case 403: return "Forbidden"
        case 404: return "Not Found"
        case 405: return "Method Not Allowed"
        case 409: return "Conflict"
        case 422: return "Unprocessable Entity"
        case 429: return "Too Many Requests"
        case 500: return "Internal Server Error"
        case 502: return "Bad Gateway"
        case 503: return "Service Unavailable"
        case 504: return "Gateway Timeout"
        default: return "HTTP \(code)"
        }
    }

    // MARK: - Security-Scoped Bookmarks

    /// Save a security-scoped bookmark for a user-picked folder so it can be
    /// re-accessed after the app is relaunched.
    private func saveBookmark(for url: URL) {
        do {
            #if os(macOS)
            let data = try url.bookmarkData(
                options: .withSecurityScope,
                includingResourceValuesForKeys: nil,
                relativeTo: nil
            )
            #else
            let data = try url.bookmarkData(
                options: .minimalBookmark,
                includingResourceValuesForKeys: nil,
                relativeTo: nil
            )
            #endif

            var bookmarks = UserDefaults.standard.dictionary(forKey: Self.bookmarksKey) as? [String: Data] ?? [:]
            bookmarks[url.path] = data
            UserDefaults.standard.set(bookmarks, forKey: Self.bookmarksKey)
            print("[Bridge] Saved bookmark for: \(url.path)")
        } catch {
            print("[Bridge] Failed to save bookmark for \(url.path): \(error)")
        }
    }

    /// Remove a saved bookmark for a folder path.
    private func removeBookmark(for path: String) {
        var bookmarks = UserDefaults.standard.dictionary(forKey: Self.bookmarksKey) as? [String: Data] ?? [:]
        bookmarks.removeValue(forKey: path)
        UserDefaults.standard.set(bookmarks, forKey: Self.bookmarksKey)
    }

    /// Restore all saved security-scoped bookmarks on launch.
    private func restoreBookmarks() {
        guard let bookmarks = UserDefaults.standard.dictionary(forKey: Self.bookmarksKey) as? [String: Data] else {
            return
        }

        var validBookmarks: [String: Data] = [:]

        for (path, data) in bookmarks {
            do {
                var isStale = false
                #if os(macOS)
                let url = try URL(
                    resolvingBookmarkData: data,
                    options: .withSecurityScope,
                    relativeTo: nil,
                    bookmarkDataIsStale: &isStale
                )
                #else
                let url = try URL(
                    resolvingBookmarkData: data,
                    options: [],
                    relativeTo: nil,
                    bookmarkDataIsStale: &isStale
                )
                #endif

                if isStale {
                    print("[Bridge] Bookmark stale for: \(path), re-saving")
                    // Try to re-save the bookmark with the resolved URL
                    if url.startAccessingSecurityScopedResource() {
                        grantedFolderURLs.append(url)
        documents.grant(url)
                        saveBookmark(for: url)
                    }
                    continue
                }

                if url.startAccessingSecurityScopedResource() {
                    grantedFolderURLs.append(url)
        documents.grant(url)
                    validBookmarks[path] = data
                    print("[Bridge] Restored bookmark for: \(url.path)")
                } else {
                    print("[Bridge] Failed to start accessing: \(path)")
                }
            } catch {
                print("[Bridge] Failed to resolve bookmark for \(path): \(error)")
            }
        }

        // Clean up invalid bookmarks
        UserDefaults.standard.set(validBookmarks, forKey: Self.bookmarksKey)
    }

    // MARK: - Send to Web

    func send(_ message: NativeToWebMessage) {
        guard let webView = webView else {
            print("[Bridge] WebView not available")
            return
        }

        do {
            let data = try encoder.encode(message)
            guard let json = String(data: data, encoding: .utf8) else {
                print("[Bridge] Failed to convert data to string")
                return
            }

            let js = "window.__nativeBridge__.receive(\(json))"

            DispatchQueue.main.async {
                webView.evaluateJavaScript(js) { _, error in
                    if let error = error {
                        print("[Bridge] JS eval error: \(error)")
                    } else {

                    }
                }
            }
        } catch {
            print("[Bridge] Failed to encode message: \(error)")
        }
    }

    func sendInitialize() {
        #if os(iOS)
        let platform = "iOS"
        #elseif os(macOS)
        let platform = "macOS"
        #else
        let platform = "unknown"
        #endif

        let initialState = NativeToWebMessage.InitialState(
            appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0",
            platform: platform,
            timestamp: ISO8601DateFormatter().string(from: Date())
        )
        send(.initialize(initialState))
    }

    func sendDeepLink(url: String) {
        send(.deepLink(NativeToWebMessage.DeepLinkPayload(url: url)))
    }
}
