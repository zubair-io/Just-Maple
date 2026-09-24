import Foundation

/// Read-only Home Assistant REST transport. Redirects never receive credentials.
final class NoHomeRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
}
public struct HomeAssistantTransport: HTTPTransport {
    public init() {}
    public func send(_ request: URLRequest) async throws -> (Data, Int) {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 20; config.timeoutIntervalForResource = 30
        let session = URLSession(configuration: config, delegate: NoHomeRedirects(), delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        let (bytes, response) = try await session.bytes(for: request)
        guard let response = response as? HTTPURLResponse else { throw MapleError.provider("Home Assistant returned a non-HTTP response.") }
        guard response.statusCode == 200 else { return (Data(), response.statusCode) }
        var data = Data()
        for try await byte in bytes {
            guard data.count < 10_000_000 else { throw MapleError.provider("Home Assistant response exceeded 10 MB.") }
            data.append(byte)
        }
        return (data, response.statusCode)
    }
}

public struct HomeAssistantClient: Sendable {
    public let baseURL: URL
    private let token: String
    private let transport: any HTTPTransport
    private let exposure: any HomeExposureTransport
    public init(url: String, token: String, transport: any HTTPTransport = HomeAssistantTransport(), exposure: any HomeExposureTransport = HomeExposureWebSocket()) throws {
        guard let parts = URLComponents(string: url.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = parts.scheme?.lowercased(), ["http", "https"].contains(scheme), let host = parts.host?.lowercased(), !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              let parsed = parts.url else { throw MapleError.invalid("Enter the Home Assistant base URL, without credentials or query parameters.") }
        let octets = host.split(separator: ".").compactMap { Int($0) }
        let privateIPv4 = octets.count == 4 && octets.allSatisfy { (0...255).contains($0) } && (octets[0] == 10 || octets[0] == 127 || (octets[0] == 192 && octets[1] == 168) || (octets[0] == 172 && (16...31).contains(octets[1])))
        guard scheme == "https" || privateIPv4 || host == "localhost" || host == "[::1]" || host == "::1" || host.hasSuffix(".local") else { throw MapleError.invalid("Use HTTPS for remote Home Assistant servers. HTTP is supported for local addresses.") }
        guard !token.isEmpty, token.utf8.count <= 8192, token.unicodeScalars.allSatisfy({ $0.value > 32 && $0.value < 127 }) else { throw MapleError.invalid("Enter a valid Home Assistant long-lived access token.") }
        self.baseURL = parsed; self.token = token; self.transport = transport; self.exposure = exposure
    }
    public func states(onlyExposed: Bool = false) async throws -> [ConnectorSourceRecord] {
        if onlyExposed {
            let exposed = try await exposure.exposedEntities(baseURL: baseURL, token: token)
            guard exposed.count <= 10000 else { throw MapleError.provider("Home Assistant exposes more than 10,000 entities. Reduce the exposed set before importing.") }
            // Read only exposed entities. Unrelated state payloads cannot block this import.
            return try await withThrowingTaskGroup(of: [ConnectorSourceRecord].self) { group in
                var iterator = exposed.sorted().makeIterator()
                func enqueue(_ id: String) {
                    group.addTask {
                        guard id.contains("."), id.utf8.count <= 256, !id.contains("/"), !id.contains("?") else { throw MapleError.provider("Home Assistant returned an invalid exposed entity ID.") }
                        let data = try await fetch(baseURL.appendingPathComponent("api/states").appendingPathComponent(id), allowMissing: true)
                        // Exposure can contain a stale entity that currently has no state.
                        guard let data else { return [] }
                        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any], object["entity_id"] as? String == id else {
                            throw MapleError.provider("Home Assistant returned an invalid JSON state for an exposed entity. No partial import was saved.")
                        }
                        return try Self.records(data: JSONSerialization.data(withJSONObject: [object]), server: baseURL.absoluteString)
                    }
                }
                for _ in 0..<6 { if let id = iterator.next() { enqueue(id) } }
                var records: [ConnectorSourceRecord] = []
                while let batch = try await group.next() {
                    records += batch
                    if let id = iterator.next() { enqueue(id) }
                }
                return records.sorted { $0.id < $1.id }
            }
        }
        let data = try await fetch(baseURL.appendingPathComponent("api/states"))!
        return try Self.records(data: data, server: baseURL.absoluteString)
    }
    private func fetch(_ url: URL, allowMissing: Bool = false) async throws -> Data? {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let result: (Data, Int)
        do { result = try await transport.send(request) }
        catch let error as MapleError { throw error }
        catch { throw MapleError.provider("Could not read Home Assistant. Check its address, network access and TLS certificate.") }
        if allowMissing && result.1 == 404 { return nil }
        guard result.1 == 200 else { throw MapleError.provider("Home Assistant HTTP \(result.1). Check the address and token; no states were imported.") }
        guard result.0.count <= 10_000_000 else { throw MapleError.provider("Home Assistant response exceeded 10 MB. No states were imported.") }
        return result.0
    }
    public static func records(data: Data, server: String, exposed: Set<String>? = nil) throws -> [ConnectorSourceRecord] {
        guard data.count <= 10_000_000 else { throw MapleError.provider("Home Assistant state response exceeded 10 MB. Use exposed-only mode.") }
        guard !data.isEmpty else { throw MapleError.provider("Home Assistant returned an empty response. Check the server URL and proxy configuration.") }
        let object: Any
        do { object = try JSONSerialization.jsonObject(with: data) }
        catch { throw MapleError.provider("Home Assistant returned invalid JSON instead of a state list. Check that the URL points to Home Assistant itself, not a dashboard or sign-in page.") }
        guard let values = object as? [[String: Any]] else { throw MapleError.provider("Home Assistant returned JSON with the wrong format: /api/states must return an array of entities.") }
        if exposed == nil && values.count > 10000 { throw MapleError.provider("Home Assistant returned \(values.count) entities, above the 10,000 import limit. Use exposed-only mode.") }
        var result: [ConnectorSourceRecord] = []
        var seen = Set<String>()
        for value in values {
            if let exposed, let entity = value["entity_id"] as? String, !exposed.contains(entity) { continue }
            guard let entity = value["entity_id"] as? String, entity.contains("."), entity.utf8.count <= 256,
                  seen.insert(entity).inserted, let state = value["state"] as? String,
                  let attributes = value["attributes"] as? [String: Any] else { throw MapleError.provider("Home Assistant returned an invalid entity. No partial state list was imported.") }
            // Exclude transport timestamps and arbitrary attribute blobs from memory.
            let keys = ["friendly_name", "unit_of_measurement", "device_class", "latitude", "longitude", "gps_accuracy", "battery_level", "source_type", "temperature", "humidity", "current_temperature", "hvac_action", "brightness"]
            let relevant = attributes.filter { keys.contains($0.key) }
            let json = try JSONSerialization.data(withJSONObject: relevant, options: [.sortedKeys])
            let name = attributes["friendly_name"] as? String ?? entity
            let content = "Home Assistant entity: \(entity)\nName: \(name)\nState: \(state)\nAttributes: \(String(decoding: json, as: UTF8.self))"
            guard content.utf8.count <= 64000, !name.isEmpty else { throw MapleError.provider("Home Assistant entity exceeded the record limit.") }
            let id = ConnectorSourceRecord.identifier(server.trimmingCharacters(in: CharacterSet(charactersIn: "/"))) + ":" + entity
            result.append(ConnectorSourceRecord(id: id, name: name, content: content, scopeID: id))
        }
        guard result.count <= 10000 else { throw MapleError.provider("The selected Home Assistant state list exceeds 10,000 entities.") }
        return result.sorted { $0.id < $1.id }
    }
}
