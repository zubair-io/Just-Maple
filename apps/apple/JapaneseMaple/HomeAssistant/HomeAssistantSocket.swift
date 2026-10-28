//
//  HomeAssistantSocket.swift
//  JapaneseMaple
//
//  The WebSocket to Home Assistant, behind a protocol so tests use a fake one and never
//  reach a real Home Assistant.
//

#if os(macOS)
import Foundation

nonisolated protocol HomeSocket: AnyObject, Sendable {
    func send(_ text: String) async throws
    /// The next message. Throws once the socket is closed.
    func receive() async throws -> String
    func close()
}

nonisolated protocol HomeSocketFactory: Sendable {
    func open(_ url: URL) -> HomeSocket
}

nonisolated struct URLSessionHomeSocketFactory: HomeSocketFactory {
    func open(_ url: URL) -> HomeSocket { URLSessionHomeSocket(url: url) }
}

/// A redirect would send the token somewhere else: never follow one.
nonisolated final class HomeNoRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(
        _ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
        completionHandler: @escaping @Sendable (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

nonisolated final class URLSessionHomeSocket: HomeSocket, @unchecked Sendable {
    private let session: URLSession
    private let task: URLSessionWebSocketTask

    init(url: URL) {
        let configuration = URLSessionConfiguration.ephemeral
        // Pings every 30 seconds keep this from timing out while nothing changes.
        configuration.timeoutIntervalForRequest = 90
        configuration.waitsForConnectivity = false
        session = URLSession(configuration: configuration, delegate: HomeNoRedirects(), delegateQueue: nil)
        task = session.webSocketTask(with: url)
        // Entity registries of big homes run to several megabytes.
        task.maximumMessageSize = 16 * 1024 * 1024
        task.resume()
    }

    func send(_ text: String) async throws {
        try await task.send(.string(text))
    }

    func receive() async throws -> String {
        switch try await task.receive() {
        case .string(let text): return text
        case .data(let data): return String(decoding: data, as: UTF8.self)
        @unknown default: throw HomeAssistantError.protocolError("unknown message")
        }
    }

    func close() {
        task.cancel(with: .normalClosure, reason: nil)
        session.invalidateAndCancel()
    }
}
#endif
