//
//  DeviceDataClient.swift
//  JapaneseMaple
//
//  Every device is a collector: the Mac reads Messages, Mail, Calendar and Contacts,
//  the iPhone records Places and Health. This client registers the device with the
//  API and uploads what it collected (see apps/api/src/routes/device-data.ts):
//
//    POST /api/collectors            { deviceId, platform, name, sources, timeZone }
//    POST /api/device-data/items     { deviceId, upserts, removals, vectors?, cursor? }
//
//  The iPhone also reads the user's named places and upcoming events, and uploads
//  driving times to those events:
//
//    GET  /api/about-me/places              → { places: [{ id, name, place: { lat, lon, radius, address? } }] }
//    GET  /api/device-data/upcoming?hours=6 → { events: [{ id, title?, location, start, end? }] }
//    POST /api/device-data/travel           { deviceId, estimates: [{ eventId, minutes, origin?, computedAt }] }
//
//  Each source has one active collector per user; uploads for other sources are
//  skipped by the server, so a device only needs to send what it read.
//

import Foundation

nonisolated enum DeviceSource: String, Codable, CaseIterable, Sendable {
    case imessage, mail, calendar, contacts, location, health
}

/// Small JSON values for an item's source-specific fields (a contact's phones, a visit's
/// coordinates, a day's step count).
nonisolated enum JSONValue: Codable, Equatable, Sendable {
    case string(String), number(Double), bool(Bool), array([JSONValue]), object([String: JSONValue]), null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else { self = .object(try container.decode([String: JSONValue].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }
}

/// One item as the server stores it. Mirrors `MacDataItem` in @maple/shared.
nonisolated struct DeviceItem: Codable, Equatable, Sendable {
    var id: String
    var source: DeviceSource
    /// Changes whenever the item changes, so unchanged items aren't stored again.
    var revision: String
    /// Seconds since 1970: when it happened (an event's start, a visit's arrival).
    var occurredAt: Double
    var endAt: Double?
    var title: String?
    var sender: String?
    var participants: [String] = []
    var thread: String?
    var body: String
    var isFromMe: Bool?
    var location: String?
    var calendar: String?
    var allDay: Bool?
    var mailbox: String?
    var isRead: Bool?
    var extra: [String: JSONValue]?
}

nonisolated struct DeviceItemVectors: Codable, Equatable, Sendable {
    var id: String
    var revision: String
    var dimensions: Int
    /// `DeviceEmbedding.base64(_:)` of the item's chunk vectors.
    var vectors: String
}

nonisolated struct DeviceCollector: Codable, Equatable, Sendable {
    var deviceId: String
    var platform: String
    var name: String
    var sources: [DeviceSource]
    var activeSources: [DeviceSource]
    var lastUploadAt: String?
}

nonisolated struct DeviceUploadResult: Codable, Equatable, Sendable {
    var stored: Int
    var removed: Int
    var vectors: Int
    var skipped: Int
    var cursor: String?
}

nonisolated enum DeviceDataError: LocalizedError {
    case notSignedIn
    case server(Int, String)

    var errorDescription: String? {
        switch self {
        case .notSignedIn: "Sign in to upload this device's data."
        case .server(let status, let message): "The server refused the upload (\(status)): \(message)"
        }
    }
}

/// Talks to the API for one device. Batches stay under the server's limits.
actor DeviceDataClient {
    static let shared = DeviceDataClient()

    static let maxUpserts = 200
    static let maxRemovals = 1_000
    static let maxVectors = 200

    /// Stable for this install; the Devices list and "one collector per source" use it.
    nonisolated static var deviceId: String {
        let key = "deviceData.deviceId"
        if let id = UserDefaults.standard.string(forKey: key) { return id }
        let id = UUID().uuidString.lowercased()
        UserDefaults.standard.set(id, forKey: key)
        return id
    }

    nonisolated static var platform: String {
        #if os(macOS)
        "macos"
        #else
        "ios"
        #endif
    }

    private let session: URLSession
    private let baseURL: @Sendable () -> String
    private let token: @Sendable () -> String?

    init(
        session: URLSession = .shared,
        baseURL: @escaping @Sendable () -> String = { ServerConfigService.shared.getAPIUrl() },
        token: @escaping @Sendable () -> String? = { ServerConfigService.shared.getToken() }
    ) {
        self.session = session
        self.baseURL = baseURL
        self.token = token
    }

    /// The signed-in account on this server (the server plus the sign-in token's subject),
    /// nil when signed out. Uploads are tracked per account, so another account, or the
    /// same account on another server (dev vs production), starts from scratch.
    nonisolated var account: String? {
        Self.subject(of: token()).map { "\(baseURL().trimmingCharacters(in: CharacterSet(charactersIn: "/")))|\($0)" }
    }

    nonisolated static func subject(of token: String?) -> String? {
        let parts = token?.split(separator: ".") ?? []
        guard parts.count == 3 else { return nil }
        var payload = String(parts[1])
            .replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        payload += String(repeating: "=", count: (4 - payload.count % 4) % 4)
        guard let data = Data(base64Encoded: payload),
            let claims = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return claims["sub"] as? String
    }

    /// Records this device and what it can collect. Returns which sources it should upload.
    func register(name: String, sources: [DeviceSource]) async throws -> DeviceCollector {
        struct Body: Encodable {
            var deviceId: String
            var platform: String
            var name: String
            var sources: [DeviceSource]
            var timeZone: String
        }
        struct Reply: Decodable { var collector: DeviceCollector }
        let reply: Reply = try await send(
            "POST", "/api/collectors",
            Body(
                deviceId: Self.deviceId, platform: Self.platform, name: name, sources: sources,
                timeZone: TimeZone.current.identifier))
        return reply.collector
    }

    /// One upload batch. Call `upload(...)` for anything larger; it splits for you.
    func uploadBatch(
        upserts: [DeviceItem], removals: [String] = [], vectors: [DeviceItemVectors] = [],
        cursor: String? = nil
    ) async throws -> DeviceUploadResult {
        struct Body: Encodable {
            var deviceId: String
            var upserts: [DeviceItem]
            var removals: [String]
            var vectors: [DeviceItemVectors]?
            var cursor: String?
        }
        return try await send(
            "POST", "/api/device-data/items",
            Body(
                deviceId: Self.deviceId, upserts: upserts, removals: removals,
                vectors: vectors.isEmpty ? nil : vectors, cursor: cursor))
    }

    /// Uploads everything in server-sized batches. Stops at the first failure so the
    /// caller can retry from where it left off.
    @discardableResult
    func upload(
        upserts: [DeviceItem], removals: [String] = [], vectors: [DeviceItemVectors] = []
    ) async throws -> DeviceUploadResult {
        var total = DeviceUploadResult(stored: 0, removed: 0, vectors: 0, skipped: 0)
        for batch in upserts.chunked(Self.maxUpserts) {
            total.add(try await uploadBatch(upserts: batch))
        }
        for batch in removals.chunked(Self.maxRemovals) {
            total.add(try await uploadBatch(upserts: [], removals: batch))
        }
        for batch in vectors.chunked(Self.maxVectors) {
            total.add(try await uploadBatch(upserts: [], vectors: batch))
        }
        return total
    }

    /// The user's named places (Home, Work…), named on the web in About me.
    func places() async throws -> [NamedPlace] {
        let reply: NamedPlacesReply = try await send("GET", "/api/about-me/places", Empty?.none)
        return reply.namedPlaces
    }

    /// Calendar events with a location in the next `hours` (from the Mac's calendar).
    func upcomingEvents(hours: Int) async throws -> [UpcomingEvent] {
        struct Reply: Decodable { var events: [UpcomingEvent] }
        let reply: Reply = try await send(
            "GET", "/api/device-data/upcoming?hours=\(hours)", Empty?.none)
        return reply.events
    }

    /// Driving times to upcoming events. At most 50 per call (`TravelPlanner.uploads`).
    @discardableResult
    func uploadTravel(_ upload: TravelUpload) async throws -> Int {
        struct Reply: Decodable { var saved: Int }
        let reply: Reply = try await send("POST", "/api/device-data/travel", upload)
        return reply.saved
    }

    private struct Empty: Encodable {}

    private func send<Body: Encodable, Reply: Decodable>(
        _ method: String, _ path: String, _ body: Body?
    ) async throws -> Reply {
        guard let token = token() else { throw DeviceDataError.notSignedIn }
        let base = baseURL().trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: base + path) else { throw DeviceDataError.server(0, "Bad server URL") }
        var request = URLRequest(url: url, timeoutInterval: 60)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw DeviceDataError.server(status, String(decoding: data.prefix(300), as: UTF8.self))
        }
        return try JSONDecoder().decode(Reply.self, from: data)
    }
}

extension DeviceUploadResult {
    mutating func add(_ other: DeviceUploadResult) {
        stored += other.stored
        removed += other.removed
        vectors += other.vectors
        skipped += other.skipped
        cursor = other.cursor ?? cursor
    }
}

extension Array {
    nonisolated func chunked(_ size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map { Array(self[$0..<Swift.min($0 + size, count)]) }
    }
}
