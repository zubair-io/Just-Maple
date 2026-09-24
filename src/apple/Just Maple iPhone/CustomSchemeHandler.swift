//
//  CustomSchemeHandler.swift
//  JapaneseMaple
//
//  Custom URL scheme handler to serve local files via app:// protocol
//  Adapted from Just-Maple/apps/apple/JapaneseMaple/CustomSchemeHandler.swift.
//  Request logging removed; local origin and resolved bundle path are constrained.
//  This allows Angular Router to work without file:// restrictions
//

import Foundation
import WebKit

@MainActor
final class CustomSchemeHandler: NSObject, WKURLSchemeHandler {
    private let baseURL: URL

    init(baseURL: URL) {
        self.baseURL = baseURL
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {

        guard let url = urlSchemeTask.request.url, url.scheme == "app", url.host == "localhost" else {
            urlSchemeTask.didFailWithError(NSError(domain: "CustomSchemeHandler", code: -1))
            return
        }

        // Convert app://localhost/path to file:///baseURL/path
        var path = url.path
        if path == "/" || path.isEmpty {
            path = "/index.html"
        }

        let fileURL = baseURL.appendingPathComponent(path).standardizedFileURL.resolvingSymlinksInPath()
        let root = baseURL.standardizedFileURL.resolvingSymlinksInPath().path + "/"
        guard fileURL.path.hasPrefix(root) else {
            urlSchemeTask.didFailWithError(NSError(domain: "CustomSchemeHandler", code: 403))
            return
        }


        // Check if file exists
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            urlSchemeTask.didFailWithError(NSError(domain: "CustomSchemeHandler", code: 404, userInfo: [NSLocalizedDescriptionKey: "File not found"]))
            return
        }

        // Read file data
        guard let data = try? Data(contentsOf: fileURL) else {
            urlSchemeTask.didFailWithError(NSError(domain: "CustomSchemeHandler", code: -1, userInfo: [NSLocalizedDescriptionKey: "Could not read file"]))
            return
        }

        // Determine content type
        let contentType = mimeType(for: fileURL.pathExtension)

        // Create response
        let response = URLResponse(
            url: url,
            mimeType: contentType,
            expectedContentLength: data.count,
            textEncodingName: nil
        )

        // Send response
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // Task was cancelled
    }

    private func mimeType(for pathExtension: String) -> String {
        switch pathExtension.lowercased() {
        case "html", "htm":
            return "text/html"
        case "js":
            return "application/javascript"
        case "json":
            return "application/json"
        case "css":
            return "text/css"
        case "png":
            return "image/png"
        case "jpg", "jpeg":
            return "image/jpeg"
        case "svg":
            return "image/svg+xml"
        case "ico":
            return "image/x-icon"
        case "woff":
            return "font/woff"
        case "woff2":
            return "font/woff2"
        case "ttf":
            return "font/ttf"
        case "eot":
            return "application/vnd.ms-fontobject"
        default:
            return "application/octet-stream"
        }
    }
}
