import Foundation
import Testing
@testable import MapleCore

private actor HomeTransportFixture: HTTPTransport {
    let data: Data; let status: Int
    var request: URLRequest?
    init(data: Data, status: Int = 200) { self.data = data; self.status = status }
    func send(_ request: URLRequest) async throws -> (Data, Int) {
        self.request = request
        if request.url?.path.hasPrefix("/api/states/") == true, let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
            guard let state = list.first(where: { $0["entity_id"] as? String == request.url?.lastPathComponent }) else { return (Data(), 404) }
            return (try JSONSerialization.data(withJSONObject: state), status)
        }
        return (data, status)
    }
}
struct HomeAssistantTests {
    func data(state: String = "home", timestamp: String = "today") throws -> Data {
        try JSONSerialization.data(withJSONObject: [["entity_id": "person.alex", "state": state, "last_updated": timestamp, "attributes": ["friendly_name": "Alex", "latitude": 1, "private_blob": "excluded"]]])
    }
    @Test func requestIsReadOnlyAndUsesBearerAuthentication() async throws {
        let transport = HomeTransportFixture(data: try data())
        let client = try HomeAssistantClient(url: "http://homeassistant.local:8123", token: "test-token", transport: transport)
        let records = try await client.states()
        let request = await transport.request
        #expect(request?.httpMethod == "GET")
        #expect(request?.url?.absoluteString == "http://homeassistant.local:8123/api/states")
        #expect(request?.value(forHTTPHeaderField: "Authorization") == "Bearer test-token")
        #expect(records.count == 1)
        #expect(!records[0].content.contains("private_blob"))
        #expect(!records[0].content.contains("test-token"))
    }
    @Test func timestampsDontCreateEventsButStateReversionsDo() async throws {
        let store = try KnowledgeStore(path: ":memory:")
        let a = try HomeAssistantClient.records(data: data(), server: "http://homeassistant.local:8123")
        let same = try HomeAssistantClient.records(data: data(timestamp: "tomorrow"), server: "http://homeassistant.local:8123/")
        let b = try HomeAssistantClient.records(data: data(state: "away"), server: "http://homeassistant.local:8123")
        #expect(a == same)
        let selected = Set(a.map(\.id))
        #expect(try await store.ingestSourceSnapshot(a, connector: "home_assistant", scopeIDs: selected) == 1)
        #expect(try await store.ingestSourceSnapshot(same, connector: "home_assistant", scopeIDs: selected) == 0)
        #expect(try await store.ingestSourceSnapshot(b, connector: "home_assistant", scopeIDs: selected) == 1)
        #expect(try await store.ingestSourceSnapshot(a, connector: "home_assistant", scopeIDs: selected) == 1)
        #expect(try await store.queue().count == 3)
    }
    @Test func rejectsInsecureRemoteURLsInvalidRecordsAndPrivateErrorBodies() async throws {
        #expect(throws: MapleError.self) { try HomeAssistantClient(url: "http://example.com", token: "x") }
        #expect(throws: MapleError.self) { try HomeAssistantClient(url: "https://user:password@example.com", token: "x") }
        #expect(throws: MapleError.self) { try HomeAssistantClient(url: "https://example.com", token: "x\r\nsecret") }
        #expect(throws: MapleError.self) { try HomeAssistantClient.records(data: Data("[{\"entity_id\":\"broken\"}]".utf8), server: "local") }
        let transport = HomeTransportFixture(data: Data("PRIVATE ERROR BODY".utf8), status: 401)
        do { _ = try await HomeAssistantClient(url: "https://example.com", token: "secret-token", transport: transport).states(); Issue.record("Accepted unauthorized response") }
        catch { #expect(!error.localizedDescription.contains("PRIVATE")); #expect(!error.localizedDescription.contains("secret-token")) }
    }
}

private struct ExposureFixture: HomeExposureTransport {
    let ids: Set<String>
    var fails = false
    func exposedEntities(baseURL: URL, token: String) async throws -> Set<String> {
        if fails { throw MapleError.provider("Exposure unavailable") }
        return ids
    }
}
extension HomeAssistantTests {
    @Test func exposedOnlyFiltersStatesAndNeverFallsBackToAll() async throws {
        let payload = Data(#"[{"entity_id":"light.exposed","state":"on","attributes":{}},{"entity_id":"sensor.private","state":"secret","attributes":{}}]"#.utf8)
        let transport = HomeTransportFixture(data: payload)
        let client = try HomeAssistantClient(url: "http://homeassistant.local:8123", token: "test", transport: transport, exposure: ExposureFixture(ids: ["light.exposed"]))
        #expect(try await client.states(onlyExposed: true).map(\.name) == ["light.exposed"])
        #expect(try await client.states(onlyExposed: false).count == 2)
        let empty = try HomeAssistantClient(url: "http://homeassistant.local:8123", token: "test", transport: transport, exposure: ExposureFixture(ids: []))
        #expect(try await empty.states(onlyExposed: true).isEmpty)
        let untouched = HomeTransportFixture(data: payload)
        let failed = try HomeAssistantClient(url: "http://homeassistant.local:8123", token: "test", transport: untouched, exposure: ExposureFixture(ids: [], fails: true))
        do { _ = try await failed.states(onlyExposed: true); Issue.record("Exposure failure imported states") } catch {}
        #expect(await untouched.request == nil)
    }
    @Test func exposureParserSupportsCurrentAndLegacyAndRejectsFailures() throws {
        let response = Data(#"{"id":1,"type":"result","success":true,"result":{"exposed_entities":{"light.assist":{"conversation":true},"light.alexa":{"cloud.alexa":true},"sensor.hidden":{"conversation":false},"light.legacy":{"conversation":{"should_expose":true}},"sensor.unknown":{"unknown":true}}}}"#.utf8)
        #expect(try HomeExposureWebSocket.parse(response) == ["light.assist", "light.alexa", "light.legacy"])
        for invalid in [#"{"id":1,"type":"result","success":false}"#, #"{"id":2,"type":"result","success":true,"result":{"exposed_entities":{}}}"#, #"{"id":1,"type":"result","success":true,"result":{}}"#] {
            do { _ = try HomeExposureWebSocket.parse(Data(invalid.utf8)); Issue.record("Accepted invalid exposure response") } catch {}
        }
    }
}

extension HomeAssistantTests {
    @Test func exposedModeAvoidsFullStateListAndSkipsStaleExposure() async throws {
        let payload = Data(#"[{"entity_id":"light.exposed","state":"on","attributes":{}}]"#.utf8)
        let transport = HomeTransportFixture(data: payload)
        let client = try HomeAssistantClient(url: "http://homeassistant.local:8123", token: "test", transport: transport, exposure: ExposureFixture(ids: ["light.exposed", "light.stale"]))
        #expect(try await client.states(onlyExposed: true).count == 1)
        #expect(await transport.request?.url?.path.hasPrefix("/api/states/") == true)
    }
    @Test func stateListErrorsDistinguishEmptyInvalidAndWrongShape() throws {
        for (data, message) in [(Data(), "empty response"), (Data("<html>login</html>".utf8), "invalid JSON"), (Data("{}".utf8), "wrong format")] {
            do { _ = try HomeAssistantClient.records(data: data, server: "local"); Issue.record("Accepted invalid list") }
            catch { #expect(error.localizedDescription.contains(message)) }
        }
        let rows = (0...10000).map { ["entity_id": "sensor.item\($0)", "state": "on", "attributes": [:]] as [String: Any] }
        let data = try JSONSerialization.data(withJSONObject: rows)
        #expect(try HomeAssistantClient.records(data: data, server: "local", exposed: ["sensor.item0"]).count == 1)
    }
}
