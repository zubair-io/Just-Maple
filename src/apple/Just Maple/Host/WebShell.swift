import SwiftUI
import WebKit
import MapleCore

struct WebShell: NSViewRepresentable {
    let model: AppModel
    func makeCoordinator() -> Bridge { Bridge(model: model) }
    func makeNSView(context: NSViewRepresentableContext<WebShell>) -> WKWebView {
        Self.makeWebView(bridge: context.coordinator)
    }
    static func makeWebView(bridge: Bridge) -> WKWebView {
        let root = Bundle.main.resourceURL!.appendingPathComponent("Web")
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(CustomSchemeHandler(baseURL: root), forURLScheme: "app")
        config.websiteDataStore = .nonPersistent()
        config.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "maple")
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = bridge
        bridge.page = URL(string: "app://localhost/")!
        web.load(URLRequest(url: bridge.page!))
        return web
    }
    func updateNSView(_ nsView: WKWebView, context: NSViewRepresentableContext<WebShell>) {}
    static func dismantleNSView(_ web: WKWebView, coordinator: Bridge) {
        web.configuration.userContentController.removeScriptMessageHandler(forName: "maple", contentWorld: .page)
    }
}

@MainActor
final class Bridge: NSObject, WKScriptMessageHandlerWithReply, WKNavigationDelegate {
    let model: AppModel
    var page: URL?
    var step: Int?
    init(model: AppModel) { self.model = model }
    var setupURL: URL { model.directory.appendingPathComponent("web-onboarding.json") }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        decisionHandler(isBundledPage(navigationAction.request.url) && navigationAction.targetFrame?.isMainFrame == true ? .allow : .cancel)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, isBundledPage(message.frameInfo.request.url),
              let body = message.body as? [String: Any], let action = body["action"] as? String else {
            replyHandler(nil, "Untrusted request."); return
        }
        Task { @MainActor in
            do {
                let result = try await perform(action, body)
                replyHandler(result, nil)
            } catch { replyHandler(nil, error.localizedDescription) }
        }
    }
    func isBundledPage(_ url: URL?) -> Bool {
        guard let url, var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        parts.fragment = nil
        return parts.url?.standardizedFileURL == page
    }
    func string(_ body: [String: Any], _ key: String, limit: Int = 262144) throws -> String {
        guard let value = body[key] as? String, value.utf8.count <= limit else { throw MapleError.invalid("Invalid \(key).") }
        return value
    }
    func perform(_ action: String, _ body: [String: Any]) async throws -> Any {
        if action != "snapshot" { model.error = nil }
        switch action {
        case "notebookCatalog", "notebookConnect", "notebookDisconnect", "notebookCreate", "noteRead", "noteSave", "noteCreate", "noteDraft", "noteReadDraft":
            return try await notebookCommand(action, body)
        case "connectorAudit", "connectorAuditLocal":
            let query=try string(body,"query",limit:1000)
            guard !query.isEmpty,!model.auditRunning else {throw MapleError.invalid("Enter a Gmail query and wait for any current audit.")}
            Task {await model.runConnectorAudit(query:query,local:action=="connectorAuditLocal")}
            return try snapshot()
        case "providerTest":
            let provider=try string(body,"provider",limit:16)
            Task {await model.testProvider(provider)}
        case "providerSelect": try model.selectProvider(string(body,"provider",limit:16))
        case "snapshot":
            if let store = model.store { model.world = try await store.worldSnapshot() }
        case "correctTaskInference", "regroupActivity", "removeActivity", "saveActivity", "saveTask", "saveSeries", "correctState", "reviewSuggestion", "acknowledgeAttention", "extractTasks", "worldHistory":
            return try await worldCommand(action, body)
        case "step":
            guard let value = body["value"] as? Int, (-1...7).contains(value), value != -1 || model.ready else { throw MapleError.invalid("Complete your name first.") }
            try JSONEncoder().encode(value).write(to: setupURL, options: .atomic)
            step = value
        case "introduce": model.name = try string(body, "name", limit: 1024); await model.introduce()
        case "connect": model.key = try string(body, "key", limit: 4096); model.connect()
        case "disconnect": model.disconnect()
        case "unlockKey": await model.unlockSavedKey()
        case "loop":
            if model.running {model.running=false}
            else {
                guard model.connected,!model.busy,!model.auditRunning else {throw MapleError.invalid("Connect Jev and finish current work before starting loops.")}
                model.running=true
            }
        case "resume": await model.importFile(resume: true)
        case "importNote": await model.importFile(resume: false)
        case "capture":
            guard await model.capture(try string(body, "text")) else { throw MapleError.invalid(model.error ?? "Could not save.") }
        case "googleConfigure": try model.importGoogleConfiguration()
        case "googleConnect":
            Task { @MainActor in do { try await model.connectGoogle() } catch { model.error = error.localizedDescription } }
        case "googleCancel": model.googleOAuth.cancel()
        case "googleUnlock": try await model.unlockGoogle()
        case "googleDisconnect": try model.disconnectGoogle()
        case "googlePoll": Task { @MainActor in await model.pollGoogle(force: true) }
        case "googleCalendarList": try await model.refreshGoogleCalendars()
        case "googleContactsPause": try model.setGoogleEnabled("contacts", enabled: false)
        case "googleContactsResume": try model.setGoogleEnabled("contacts", enabled: true)
        case "googleMailPause": try model.setGoogleEnabled("mail", enabled: false)
        case "googleMailResume": try model.setGoogleEnabled("mail", enabled: true)
        case "googleCalendarPause": try model.setGoogleEnabled("calendar", enabled: false)
        case "googleCalendarResume": try model.setGoogleEnabled("calendar", enabled: true)
        case "googleCalendarSelection":
            guard let ids = body["ids"] as? [String], ids.count <= 1000 else { throw MapleError.invalid("Invalid Google calendar selection.") }
            Task { @MainActor in do { try await model.selectGoogleCalendars(ids) } catch { model.error = error.localizedDescription } }
        case "calendarList": await model.refreshCalendarChoices()
        case "calendarSelection":
            guard let ids = body["ids"] as? [String], ids.count <= 1000 else { throw MapleError.invalid("Invalid calendar selection.") }
            try await model.selectCalendars(ids)
        case "homeConnect": try await model.connectHome(url: string(body, "url", limit: 2048), token: string(body, "token", limit: 8192))
        case "homeExposure":
            guard let enabled = body["enabled"] as? Bool else { throw MapleError.invalid("Invalid exposure preference.") }
            try await model.setHomeExposure(enabled)
        case "homeUnlock": try await model.unlockHome()
        case "homePoll": await model.pollHome(force: true)
        case "homePause": try model.pauseHome()
        case "homeResume": model.homeSettings.enabled = true; try model.saveHomeSettings(); await model.pollHome(force: true)
        case "homeSelection":
            guard let ids = body["ids"] as? [String], ids.count <= 10000 else { throw MapleError.invalid("Invalid entity selection.") }
            try await model.selectHomeEntities(ids)
        case "peopleSearch": return try json(try await model.store?.people(search: string(body, "query", limit: 256), limit: 20) ?? [])
        case "pinPerson":
            guard let pinned = body["pinned"] as? Bool else { throw MapleError.invalid("Invalid pin value.") }
            try await model.store?.pinPerson(string(body, "id", limit: 256), pinned: pinned); await model.refresh()
        case "contacts": await model.connectApple("contacts")
        case "calendar": await model.connectApple("calendar")
        case "pauseContacts": model.pauseApple("contacts")
        case "pauseCalendar": model.pauseApple("calendar")
        case "pollContacts": await model.pollApple(kind: "contacts", force: true)
        case "pollCalendar": await model.pollApple(kind: "calendar", force: true)
        case "contactsSettings": NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts")!)
        case "calendarSettings": NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars")!)
        case "messages": await model.enableMessages()
        case "pauseMessages": model.messagesEnabled = false
        case "poll": await model.pollMessages(force: true)
        case "retry": await model.retry()
        case "retryFacts": await model.retryFactExtraction()
        case "checkFacts": await model.checkFacts(for: try string(body, "id", limit: 256))
        case "answer":
            let id = try string(body, "id", limit: 256)
            guard let item = model.work.first(where: { $0.id == id }) else { throw MapleError.invalid("Unknown item.") }
            await model.answer(item, text: try string(body, "text"))
        case "dismiss": try await model.store?.dismiss(try string(body, "id", limit: 256)); await model.refresh()
        case "person":
            let id = (body["id"] as? String) ?? "person:\(UUID().uuidString)"
            guard id.hasPrefix("person:"), id.count <= 256 else { throw MapleError.invalid("Invalid contact.") }
            guard await model.savePerson(id: id, name: try string(body, "name", limit: 1024), relationship: try string(body, "relationship", limit: 1024)) else { throw MapleError.invalid(model.error ?? "Could not save contact.") }
        case "search": return try json(try await model.store?.search(try string(body, "query", limit: 1024)) ?? [])
        case "correct":
            let id = try string(body, "id", limit: 256)
            guard let fact = model.sourceFacts.first(where: { $0.id == id }) else { throw MapleError.invalid("Unknown fact.") }
            try await model.store?.correct(subject: fact.subject, predicate: fact.predicate, value: try string(body, "value", limit: 4096))
            await model.refresh()
        case "evidence":
            let id = try string(body, "id", limit: 256)
            return try json(try await model.store?.event(id))
        case "clearError": model.error = nil
        case "diskAccess": NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")!)
        case "showApp": NSWorkspace.shared.activateFileViewerSelecting([Bundle.main.bundleURL])
        default: throw MapleError.invalid("Unsupported action.")
        }
        return try snapshot()
    }
    func json<T: Encodable>(_ value: T) throws -> Any { try JSONSerialization.jsonObject(with: JSONCodec.encode(value), options: [.fragmentsAllowed]) }
    func snapshot() throws -> Any {
        if step == nil, model.loaded {
            step = (try? JSONDecoder().decode(Int.self, from: Data(contentsOf: setupURL))) ?? (model.ready ? -1 : 0)
        }
        return ["companionCloudEnabled":model.companion.cloudEnabled,"companionStatus":model.companion.status,"companionPaired":model.companion.paired,"localIndex":try json(model.localIndex),"localIntelligenceStatus":model.localIntelligenceStatus,"auditRunning":model.auditRunning,"auditStatus":model.auditStatus,"world": try json(model.world), "taskExtractionQueue": try json(model.taskExtractionQueue), "loaded": model.loaded, "step": step ?? 0, "name": model.name,
                "connected": model.connected, "running": model.running, "busy": model.busy,
                "message": model.message, "error": model.error ?? "", "count": model.count,
                "importantPeople": try json(model.importantPeople), "claims": try json(model.claims), "facts": try json(model.sourceFacts),
                "prompts": Dictionary(model.decisions.map { ($0.eventID, $0.userPrompt) }, uniquingKeysWith: { _, last in last }), "decisions": try json(model.decisions), "work": try json(model.work), "queue": try json(model.queue),
                "factQueue": try json(model.factQueue), "factChecks": model.factChecks.map { ["eventID": $0.eventID, "probability": $0.probability, "provider": $0.provider, "model": $0.model] as [String: Any] },
                "calendarChoices": try json(model.calendarChoices), "selectedCalendarIDs": model.selectedCalendarIDs.sorted(),
                "googleConfigured": model.googleConfigured, "googleAccount": model.googleSettings.account,
                "googleConnected": model.googleTokens != nil, "googleBusy": model.googleBusy, "googleStatus": model.googleStatus,
                "googleMailEnabled": model.googleSettings.mailEnabled, "googleCalendarEnabled": model.googleSettings.calendarEnabled,
                "googleContactsEnabled": model.googleSettings.contactsEnabled == true,
                "googleContactsGranted": model.googleTokens?.scopes.contains(GoogleOAuth.contactsScope) == true, "googleContactsStatus": model.googleContactsStatus,
                "googleMailStatus": model.googleMailStatus, "googleCalendarStatus": model.googleCalendarStatus,
                "googleCalendars": try json(model.googleCalendars), "selectedGoogleCalendarIDs": model.googleSettings.selected,
                "googleCalendar": try json(Array(model.googleCalendar.filter { record in
                    (record.end ?? .distantPast) >= Date() && model.googleSettings.selected.contains { GoogleAPI.scope(account: model.googleSettings.account, calendar: $0) == record.scopeID }
                }.sorted { ($0.start ?? .distantPast) < ($1.start ?? .distantPast) }.prefix(100))),
                "homeURL": model.homeSettings.url, "homeEnabled": model.homeSettings.enabled, "homeHasToken": model.homeToken != nil,
                "homeExposedOnly": model.homeSettings.usesExposed, "homeStatus": model.homeStatus, "homeImporting": model.homeImporting,
                "homeEntities": try json(model.homeEntities.map { ["id": $0.id, "name": $0.name] }), "selectedHomeEntities": model.homeSettings.selected,
                "contactsEnabled": model.contactsEnabled, "calendarEnabled": model.calendarEnabled, "appleImporting": model.appleImporting,
                "contactsStatus": model.contactsStatus, "calendarStatus": model.calendarStatus,
                "appleContacts": try json(Array(model.appleContacts.prefix(500))), "appleContactCount": model.appleContacts.count,
                "appleCalendar": try json(Array(model.appleCalendar.filter { ($0.end ?? .distantPast) >= Date() && model.selectedCalendarIDs.contains($0.scopeID ?? "") }.sorted { ($0.start ?? .distantPast) < ($1.start ?? .distantPast) }.prefix(100))),
                "resume": model.importedResume ?? "", "messagesEnabled": model.messagesEnabled,
                "messagesStatus": model.messagesStatus, "messagesError": model.messagesError ?? "",
                "extractionProvider": model.extractionProvider, "providerStatus":model.providerStatus, "providerTesting":model.providerTesting, "testedProviders":Array(model.testedProviders), "extractor": AppleFactExtractor.availabilityDescription] as [String: Any]
    }
}
