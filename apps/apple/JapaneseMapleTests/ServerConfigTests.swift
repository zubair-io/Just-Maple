import Foundation
import Testing
@testable import JapaneseMaple

private nonisolated final class ServerProbeProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var reports: [String: String] = [:]
    nonisolated(unsafe) private static var observed: [URLRequest] = []

    static func report(_ host: String, local: String? = nil, instance: String = "phoebe-instance", publicURL: String = "https://phoebe.example.com") {
        let body: [String: Any] = ["instanceId": instance, "publicUrl": publicURL, "localUrl": local as Any? ?? NSNull()]
        let json = String(decoding: try! JSONSerialization.data(withJSONObject: body), as: UTF8.self)
        lock.withLock { reports[host] = json }
    }
    static func reset() { lock.withLock { reports = [:]; observed = [] } }
    static func offline(_ host: String) { lock.withLock { reports.removeValue(forKey: host) } }
    static var requests: [URLRequest] { lock.withLock { observed } }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let body = Self.lock.withLock { Self.observed.append(request); return Self.reports[request.url!.host!] }
        guard let body else {
            client?.urlProtocol(self, didFailWithError: URLError(.cannotConnectToHost)); return
        }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200,
            httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@Suite(.serialized)
struct ServerConfigTests {
    private func fixture() -> (UserDefaults, ServerConfigService, URLSession) {
        ServerProbeProtocol.reset()
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let service = ServerConfigService(defaults: defaults, monitorNetwork: false)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ServerProbeProtocol.self]
        return (defaults, service, URLSession(configuration: configuration))
    }
    @Test func normalizesHostnamesWithoutAllowingCredentialsOrPaths() throws {
        #expect(try ServerConfigService.normalizeAddress(" Phoebe.JustMaple.app ") == "https://phoebe.justmaple.app")
        #expect(try ServerConfigService.normalizeAddress("https://phoebe.justmaple.app:443/") == "https://phoebe.justmaple.app")
        #expect(try ServerConfigService.normalizeAddress("http://localhost:4200") == "http://localhost:4200")
        for invalid in ["http://phoebe.justmaple.app", "https://user:pass@phoebe.justmaple.app", "https://phoebe.justmaple.app/path", "https://phoebe.justmaple.app?token=secret", "https://phoebe.justmaple.app#x", ""] {
            #expect(throws: (any Error).self) { try ServerConfigService.normalizeAddress(invalid) }
        }
    }

    @Test func discoversVerifiedLocalServerFromPrimaryOnlyAndKeepsAccountIdentity() async throws {
        let (defaults, service, session) = fixture()
        defer { session.invalidateAndCancel() }
        ServerProbeProtocol.report("phoebe.example.com", local: "local.example.com")
        ServerProbeProtocol.report("local.example.com")
        #expect(!service.hasConfiguredServer)
        #expect(service.getToken() == nil)
        try await service.configure(publicAddress: "phoebe.example.com", session: session)
        #expect(service.localURL == "https://local.example.com")
        #expect(service.getAPIUrl() == "https://local.example.com")
        #expect(service.getEffectiveWebURL() == "https://local.example.com")
        #expect(service.getActiveServer().id == "https://phoebe.example.com")
        let relaunched = ServerConfigService(defaults: defaults, monitorNetwork: false)
        #expect(relaunched.hasConfiguredServer)
        #expect(await relaunched.resolveEndpoint(session: session) == "https://local.example.com")
        #expect(ServerProbeProtocol.requests.allSatisfy { $0.value(forHTTPHeaderField: "Authorization") == nil && !$0.httpShouldHandleCookies })
    }

    @Test func unreachableOrDifferentLocalServerFallsBackWithoutBlockingConnection() async throws {
        let (_, service, session) = fixture()
        defer { session.invalidateAndCancel() }
        ServerProbeProtocol.report("phoebe.example.com", local: "offline.example.com")
        try await service.configure(publicAddress: "phoebe.example.com", session: session)
        #expect(service.getAPIUrl() == "https://phoebe.example.com")
        ServerProbeProtocol.report("phoebe.example.com", local: "other.example.com")
        ServerProbeProtocol.report("other.example.com", instance: "other-instance")
        try await service.configure(publicAddress: "phoebe.example.com", session: session)
        #expect(service.getAPIUrl() == "https://phoebe.example.com")
    }

    @Test func refreshLearnsChangedAddressAndClearsRemovedOrLegacyManualAddress() async throws {
        let (defaults, service, session) = fixture()
        defer { session.invalidateAndCancel() }
        ServerProbeProtocol.report("phoebe.example.com", local: "local.example.com")
        ServerProbeProtocol.report("local.example.com")
        try await service.configure(publicAddress: "phoebe.example.com", session: session)
        ServerProbeProtocol.report("phoebe.example.com", local: "new-local.example.com")
        ServerProbeProtocol.report("new-local.example.com")
        let refreshed = ServerConfigService(defaults: defaults, monitorNetwork: false)
        #expect(await refreshed.resolveEndpoint(session: session) == "https://new-local.example.com")
        ServerProbeProtocol.report("phoebe.example.com")
        let removed = ServerConfigService(defaults: defaults, monitorNetwork: false)
        #expect(await removed.resolveEndpoint(session: session) == "https://phoebe.example.com")
        #expect(removed.localURL == nil)
    }

    @Test func malformedAdvertisementDoesNotGetProbedOrBlockPrimary() async throws {
        let (_, service, session) = fixture()
        defer { session.invalidateAndCancel() }
        ServerProbeProtocol.report("phoebe.example.com", local: "https://user:secret@local.example.com/path")
        try await service.configure(publicAddress: "phoebe.example.com", session: session)
        #expect(service.localURL == nil)
        #expect(service.getAPIUrl() == "https://phoebe.example.com")
        #expect(ServerProbeProtocol.requests.allSatisfy { $0.url?.host == "phoebe.example.com" })
    }

    @Test func rememberedLocalCanBeUsedWhenPrimaryIsOfflineButIdentityMustMatch() async throws {
        let (defaults, service, session) = fixture()
        defer { session.invalidateAndCancel() }
        ServerProbeProtocol.report("phoebe.example.com", local: "local.example.com")
        ServerProbeProtocol.report("local.example.com")
        try await service.configure(publicAddress: "phoebe.example.com", session: session)
        ServerProbeProtocol.offline("phoebe.example.com")
        let offline = ServerConfigService(defaults: defaults, monitorNetwork: false)
        #expect(await offline.resolveEndpoint(session: session) == "https://local.example.com")
        ServerProbeProtocol.report("local.example.com", publicURL: "https://different.example.com")
        let untrusted = ServerConfigService(defaults: defaults, monitorNetwork: false)
        #expect(await untrusted.resolveEndpoint(session: session) == "https://phoebe.example.com")
    }

    @Test func rejectsPrimaryWithDifferentCanonicalIdentityWithoutSavingIt() async throws {
        let (_, service, session) = fixture()
        defer { session.invalidateAndCancel() }
        ServerProbeProtocol.report("other.example.com")
        await #expect(throws: (any Error).self) {
            try await service.configure(publicAddress: "other.example.com", session: session)
        }
        #expect(!service.hasConfiguredServer)
    }
}
