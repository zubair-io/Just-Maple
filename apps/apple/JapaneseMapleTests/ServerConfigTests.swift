import Foundation
import Testing
@testable import JapaneseMaple

private nonisolated final class ServerProbeProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let host = request.url!.host!
        guard host != "offline.example.com" else {
            client?.urlProtocol(self, didFailWithError: URLError(.cannotConnectToHost))
            return
        }
        let id = host == "other.example.com" ? "other-instance" : "phoebe-instance"
        let data = Data("{\"instanceId\":\"\(id)\",\"publicUrl\":\"https://phoebe.example.com\"}".utf8)
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200,
            httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

struct ServerConfigTests {
    @Test func normalizesHostnamesWithoutAllowingCredentialsOrPaths() throws {
        #expect(try ServerConfigService.normalizeAddress(" Phoebe.JustMaple.app ") == "https://phoebe.justmaple.app")
        #expect(try ServerConfigService.normalizeAddress("https://phoebe.justmaple.app:443/") == "https://phoebe.justmaple.app")
        #expect(try ServerConfigService.normalizeAddress("http://localhost:4200") == "http://localhost:4200")
        for invalid in ["http://phoebe.justmaple.app", "https://user:pass@phoebe.justmaple.app", "https://phoebe.justmaple.app/path", "https://phoebe.justmaple.app?token=secret", "https://phoebe.justmaple.app#x", ""] {
            #expect(throws: (any Error).self) { try ServerConfigService.normalizeAddress(invalid) }
        }
    }

    @Test func prefersVerifiedLocalServerWithoutChangingAccountIdentity() async throws {
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let config = ServerConfigService(defaults: defaults, monitorNetwork: false)
        let sessionConfig = URLSessionConfiguration.ephemeral
        sessionConfig.protocolClasses = [ServerProbeProtocol.self]
        let session = URLSession(configuration: sessionConfig)
        defer { session.invalidateAndCancel() }
        #expect(!config.hasConfiguredServer)
        #expect(config.getToken() == nil)
        try await config.configure(publicAddress: "phoebe.example.com", localAddress: "local.example.com", session: session)
        let relaunched = ServerConfigService(defaults: defaults, monitorNetwork: false)
        #expect(relaunched.hasConfiguredServer)
        #expect(relaunched.getActiveServer().url == "https://phoebe.example.com")
        #expect(relaunched.localURL == "https://local.example.com")
        #expect(config.getActiveServer().id == "https://phoebe.example.com")
        #expect(config.getAPIUrl() == "https://local.example.com")
        #expect(config.getEffectiveWebURL() == "https://local.example.com")
        try await config.configure(publicAddress: "phoebe.example.com", localAddress: "offline.example.com", session: session)
        #expect(config.getAPIUrl() == "https://phoebe.example.com")
        await #expect(throws: (any Error).self) {
            try await config.configure(publicAddress: "phoebe.example.com", localAddress: "other.example.com", session: session)
        }
        #expect(config.localURL == "https://offline.example.com")
    }
}
