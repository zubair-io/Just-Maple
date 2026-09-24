import Foundation

public protocol HomeExposureTransport: Sendable {
    func exposedEntities(baseURL: URL, token: String) async throws -> Set<String>
}

/// Read only: query the exposure list; never change Home Assistant's settings.
public struct HomeExposureWebSocket: HomeExposureTransport {
    public init() {}
    public func exposedEntities(baseURL: URL, token: String) async throws -> Set<String> {
        var parts = URLComponents(url: baseURL.appendingPathComponent("api/websocket"), resolvingAgainstBaseURL: false)!
        parts.scheme = parts.scheme == "https" ? "wss" : "ws"
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 20
        let session = URLSession(configuration: configuration, delegate: NoHomeRedirects(), delegateQueue: nil)
        let socket = session.webSocketTask(with: parts.url!)
        socket.maximumMessageSize = 10_000_000
        let deadline = Task {
            do { try await Task.sleep(for: .seconds(20)); socket.cancel(with: .goingAway, reason: nil) } catch {}
        }
        defer { deadline.cancel(); socket.cancel(with: .normalClosure, reason: nil); session.invalidateAndCancel() }
        socket.resume()
        func receive() async throws -> Data {
            switch try await socket.receive() {
            case .data(let data): return data
            case .string(let string): return Data(string.utf8)
            @unknown default: throw MapleError.provider("Unsupported Home Assistant message.")
            }
        }
        struct Auth: Decodable { let type: String }
        do {
            guard try JSONDecoder().decode(Auth.self, from: await receive()).type == "auth_required" else { throw MapleError.provider("Home Assistant did not request authentication.") }
            let auth = try JSONSerialization.data(withJSONObject: ["type": "auth", "access_token": token])
            try await socket.send(.string(String(decoding: auth, as: UTF8.self)))
            guard try JSONDecoder().decode(Auth.self, from: await receive()).type == "auth_ok" else { throw MapleError.provider("Home Assistant rejected authentication.") }
            try await socket.send(.string(#"{"id":1,"type":"homeassistant/expose_entity/list"}"#))
            return try Self.parse(await receive())
        } catch {
            throw MapleError.provider("Could not read Home Assistant's exposed entities. Check the connection and use a token authorized to read exposure settings (Home Assistant requires admin access). No entities were imported. You can turn off exposed-only mode to select entities manually.")
        }
    }
    public static func parse(_ data: Data) throws -> Set<String> {
        struct Response: Decodable {
            struct Result: Decodable { let exposed_entities: [String: [String: Exposure]] }
            let id: Int; let type: String; let success: Bool; let result: Result?
        }
        guard data.count <= 10_000_000 else { throw MapleError.provider("Exposure list is too large.") }
        let response = try JSONDecoder().decode(Response.self, from: data)
        guard response.id == 1, response.type == "result", response.success, let entities = response.result?.exposed_entities,
              entities.count <= 10000, entities.keys.allSatisfy({ $0.contains(".") && $0.utf8.count <= 256 }) else {
            throw MapleError.provider("Invalid Home Assistant exposure response.")
        }
        let assistants = Set(["conversation", "cloud.alexa", "cloud.google_assistant"])
        return Set(entities.filter { _, values in values.contains { assistants.contains($0.key) && $0.value.enabled } }.keys)
    }
}

private struct Exposure: Decodable {
    let enabled: Bool
    init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let value = try? container.decode(Bool.self) { enabled = value; return }
        struct Legacy: Decodable { let should_expose: Bool }
        enabled = try container.decode(Legacy.self).should_expose
    }
}
