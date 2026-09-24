import Foundation
import Testing
import MapleCore
@testable import Just_Maple

@MainActor
struct GoogleOAuthTests {
    @Test func callbackRequiresMatchingStateAndOneCode() throws {
        #expect(try GoogleOAuth.callback("/oauth/callback?state=nonce&code=good", expectedState: "nonce") == "good")
        #expect(try GoogleOAuth.callback("/oauth/callback?state=wrong&code=bad", expectedState: "nonce") == nil)
        #expect(try GoogleOAuth.callback("/other?state=nonce&code=bad", expectedState: "nonce") == nil)
        #expect(try GoogleOAuth.callback("/oauth/callback?state=nonce&code=a&code=b", expectedState: "nonce") == nil)
        #expect(throws: MapleError.self) { try GoogleOAuth.callback("/oauth/callback?state=nonce&error=access_denied", expectedState: "nonce") }
        let first = try GoogleOAuth.random(), second = try GoogleOAuth.random()
        #expect(first.count == 43 && first != second)
        let form = String(decoding: GoogleOAuth.form(["code": "a+b&c=d"]), as: UTF8.self)
        #expect(form == "code=a%2Bb%26c%3Dd")
    }
    @Test func googleSecretsNeverReachWebSnapshot() throws {
        let model = AppModel()
        model.googleTokens = GoogleTokens(access: "ACCESS_SENTINEL", refresh: "REFRESH_SENTINEL", expires: Date(), scopes: [])
        let json = String(decoding: try JSONSerialization.data(withJSONObject: Bridge(model: model).snapshot()), as: UTF8.self)
        #expect(!json.contains("ACCESS_SENTINEL"))
        #expect(!json.contains("REFRESH_SENTINEL"))
    }
}

private actor GoogleTokenFixture: HTTPTransport {
    let data: Data
    var request: URLRequest?
    init(_ data: Data) { self.data = data }
    func send(_ request: URLRequest) async throws -> (Data, Int) { self.request = request; return (data, 200) }
}
extension GoogleOAuthTests {
    @Test func refreshRetainsRefreshTokenAndEnforcesGrantedScopes() async throws {
        let config = GoogleClientConfiguration(installed: .init(client_id: "test.apps.googleusercontent.com", client_secret: "CLIENT_SENTINEL"))
        let previous = GoogleTokens(access: "old", refresh: "refresh-sentinel", expires: .distantPast, scopes: GoogleOAuth.scopes)
        let transport = GoogleTokenFixture(Data(#"{"access_token":"new","expires_in":3600}"#.utf8))
        let updated = try await GoogleOAuth.exchange(config, fields: ["grant_type":"refresh_token","refresh_token":previous.refresh], previous: previous, transport: transport)
        #expect(updated.refresh == previous.refresh)
        #expect(updated.access == "new")
        #expect(updated.expires > Date())
        let request = await transport.request
        #expect(request?.httpMethod == "POST")
        #expect(request?.url?.absoluteString == "https://oauth2.googleapis.com/token")
        let denied = GoogleTokenFixture(Data(#"{"access_token":"new","refresh_token":"r","expires_in":3600,"scope":"email"}"#.utf8))
        do { _ = try await GoogleOAuth.exchange(config, fields: [:], previous: nil, transport: denied); Issue.record("Accepted missing API scopes") } catch {}
    }
}

extension GoogleOAuthTests {
    @Test func oldGoogleSettingsAndGrantsKeepWorkingWithoutContacts() async throws {
        let settings = try JSONDecoder().decode(GoogleSettings.self, from: Data(#"{"account":"owner@example.test","mailEnabled":true,"calendarEnabled":true,"selected":["work"]}"#.utf8))
        #expect(settings.mailEnabled && settings.calendarEnabled)
        #expect(settings.selected == ["work"])
        #expect(settings.contactsEnabled != true)
        let oldScopes = GoogleOAuth.scopes.filter { $0 != GoogleOAuth.contactsScope }
        let old = GoogleTokens(access: "old", refresh: "refresh", expires: .distantPast, scopes: oldScopes)
        let transport = GoogleTokenFixture(Data(#"{"access_token":"new","expires_in":3600}"#.utf8))
        let config = GoogleClientConfiguration(installed: .init(client_id: "test.apps.googleusercontent.com", client_secret: "test"))
        let refreshed = try await GoogleOAuth.exchange(config, fields: ["grant_type":"refresh_token"], previous: old, transport: transport)
        #expect(refreshed.scopes == oldScopes)
        #expect(!refreshed.scopes.contains(GoogleOAuth.contactsScope))
    }
}
