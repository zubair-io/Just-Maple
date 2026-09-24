import Foundation
import Network
import Testing
@testable import MapleCompanionTransport

@Suite(.serialized) @MainActor struct TransportTests {
    @Test func frameBounds() throws {
        #expect(try CompanionFrame.length(Data([0, 0, 0, 0])) == 0)
        #expect(try CompanionFrame.encode(Data([7, 8])) == Data([0, 0, 0, 2, 7, 8]))
        #expect(try CompanionFrame.length(Data([0, 4, 0, 0])) == 262144)
        #expect(throws: CompanionTransportError.self) { try CompanionFrame.length(Data([0, 4, 0, 1])) }
        #expect(throws: CompanionTransportError.self) { try CompanionFrame.length(Data([1])) }
        #expect(throws: CompanionTransportError.self) { try CompanionFrame.encode(Data(count: 262145)) }
    }

    @Test func secureConfigurationRoundTrip() throws {
        let configuration = try PairingConfiguration.create(expiresAt: Date(timeIntervalSince1970: 1000))
        #expect(configuration.secret.count == 32)
        #expect(configuration.secret != (try PairingConfiguration.create()).secret)
        #expect(try JSONDecoder().decode(PairingConfiguration.self, from: JSONEncoder().encode(configuration)) == configuration)
    }

    @Test func encryptedLoopbackAndWrongKeyRejection() async throws {
        let configuration = try PairingConfiguration.create()
        let server = CompanionTransportServer()
        var handled = 0
        try await server.start(configuration: configuration) { payload in handled += 1; return Data(payload.reversed()) }
        defer { server.stop() }
        let endpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: try #require(server.port))!)
        let result = try await CompanionTransportClient.exchange(configuration: configuration, payload: Data([1, 2, 3]), endpoint: endpoint, timeoutSeconds: 5)
        #expect(result == Data([3, 2, 1]))
        #expect(handled == 1)
        let wrongKey = PairingConfiguration(id: configuration.id, secret: Data(repeating: 0, count: 32), serviceName: configuration.serviceName)
        do {
            _ = try await CompanionTransportClient.exchange(configuration: wrongKey, payload: Data([4]), endpoint: endpoint, timeoutSeconds: 3)
            Issue.record("A peer without the pairing key must not connect")
        } catch { }
        #expect(handled == 1)
    }

    @Test func cancellationAndTimeout() async throws {
        let configuration = try PairingConfiguration.create()
        let server = CompanionTransportServer()
        try await server.start(configuration: configuration) { _ in
            try await Task.sleep(for: .seconds(30)); return Data()
        }
        defer { server.stop() }
        let endpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: try #require(server.port))!)
        do {
            _ = try await CompanionTransportClient.exchange(configuration: configuration, payload: Data(), endpoint: endpoint, timeoutSeconds: 0.2)
            Issue.record("Expected request timeout")
        } catch CompanionTransportError.timedOut { }
        let pending = Task { try await CompanionTransportClient.exchange(configuration: configuration, payload: Data(), endpoint: endpoint) }
        try await Task.sleep(for: .milliseconds(100))
        pending.cancel()
        do { _ = try await pending.value; Issue.record("Expected cancellation") } catch is CancellationError { }
    }
    @Test func stopClosesInFlightAndOversizeResponsesFail() async throws {
        let configuration = try PairingConfiguration.create()
        let server = CompanionTransportServer()
        try await server.start(configuration: configuration) { _ in Data(count: CompanionFrame.maximumLength + 1) }
        let endpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: try #require(server.port))!)
        do {
            _ = try await CompanionTransportClient.exchange(configuration: configuration, payload: Data(), endpoint: endpoint, timeoutSeconds: 2)
            Issue.record("Oversize response must fail")
        } catch { }
        server.stop()
        try await server.start(configuration: configuration) { _ in
            try await Task.sleep(for: .seconds(30)); return Data()
        }
        let restarted = NWEndpoint.hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: try #require(server.port))!)
        let pending = Task { try await CompanionTransportClient.exchange(configuration: configuration, payload: Data(), endpoint: restarted, timeoutSeconds: 2) }
        try await Task.sleep(for: .milliseconds(100))
        server.stop()
        do { _ = try await pending.value; Issue.record("Stopping the server must close in-flight work") } catch { }
    }

}
