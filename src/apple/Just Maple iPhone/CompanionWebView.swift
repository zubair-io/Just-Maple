import MapleCompanionTransport
import SwiftUI
import WebKit

struct CompanionWebView: UIViewRepresentable {
    func makeCoordinator()->CompanionBridge {CompanionBridge()}
    func makeUIView(context:Context)->WKWebView {
        let config=WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.setURLSchemeHandler(CustomSchemeHandler(baseURL:Bundle.main.resourceURL!.appendingPathComponent("browser")),forURLScheme:"app")
        config.userContentController.addUserScript(WKUserScript(source:"Object.defineProperty(window, 'mapleHost', { value: 'iphone', writable: false });",injectionTime:.atDocumentStart,forMainFrameOnly:true))
        config.userContentController.addScriptMessageHandler(context.coordinator,contentWorld:.page,name:"mapleCompanion")
        let web=WKWebView(frame:.zero,configuration:config)
        web.isOpaque=false;web.backgroundColor = .systemBackground
        web.navigationDelegate=context.coordinator
        web.load(URLRequest(url:URL(string:"app://localhost/")!))
        return web
    }
    func updateUIView(_ uiView:WKWebView,context:Context){}
    static func dismantleUIView(_ web:WKWebView,coordinator:CompanionBridge){
        web.configuration.userContentController.removeScriptMessageHandler(forName:"mapleCompanion",contentWorld:.page)
        coordinator.stop()
        web.stopLoading()
    }
}
@MainActor final class CompanionBridge:NSObject,WKScriptMessageHandlerWithReply,WKNavigationDelegate {
    private var store:CompanionStore?
    private var sync:CompanionSync?
    private var notebooks:iPhoneNotebookBridge?
    init(store:CompanionStore){self.store=store;super.init()}
    override init(){
        super.init()
        let base=FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0]
        // UI test data is isolated from personal captures, never represented as Mac data.
        let suffix=ProcessInfo.processInfo.arguments.contains("--companion-ui-test") ? "CompanionUITests" : "Companion"
        let directory=base.appendingPathComponent(suffix)
        store=try? CompanionStore(directory:directory)
        if suffix=="CompanionUITests" {notebooks=iPhoneNotebookBridge(directory:directory,cloudRootProvider:{nil})}
        else {notebooks=iPhoneNotebookBridge(directory:directory)}
        if let store {sync=CompanionSync(store:store);sync?.start()}
    }
    static func isBundledPage(_ url:URL?)->Bool {
        guard let url,var parts=URLComponents(url:url,resolvingAgainstBaseURL:false) else{return false}
        parts.fragment=nil
        return parts.url?.absoluteString=="app://localhost/"
    }
    func webView(_ webView:WKWebView,decidePolicyFor action:WKNavigationAction,decisionHandler:@escaping @MainActor @Sendable (WKNavigationActionPolicy)->Void){
        decisionHandler(Self.isBundledPage(action.request.url) && action.targetFrame?.isMainFrame==true ? .allow:.cancel)
    }
    func userContentController(_ controller:WKUserContentController,didReceive message:WKScriptMessage,replyHandler:@escaping @MainActor @Sendable (Any?,String?)->Void){
        guard message.frameInfo.isMainFrame,Self.isBundledPage(message.frameInfo.request.url),let body=message.body as? [String:Any],let action=body["action"] as? String else {replyHandler(nil,"Untrusted request.");return}
        Task { @MainActor in
            do {
                if iPhoneNotebookBridge.actions.contains(action) {
                    guard let notebooks,let store else{throw CompanionError.storageUnavailable}
                    let scene=UIApplication.shared.connectedScenes.first as? UIWindowScene
                    let presenter=scene?.windows.first(where:{$0.isKeyWindow})?.rootViewController
                    replyHandler(try await notebooks.command(action,body:body,presenting:presenter,store:store),nil)
                    return
                }
                if action=="syncMac" {await sync?.sync()}
                else {_ = try perform(action,body:body)}
                replyHandler(try reply(),nil)
                if action=="taskAction" {Task {await sync?.sync()}}
            } catch {
                if iPhoneNotebookBridge.actions.contains(action) {replyHandler(nil,error.localizedDescription)}
                else {replyHandler(nil,"Could not complete this request. iCloud will reconnect automatically when available.")}
            }
        }
    }
    func stop(){sync?.stop()}
    private func bridgeDate(_ value:Any?)throws->Date? {
        guard let value else{return nil}
        guard let text=value as? String,text.utf8.count<=64 else{throw CompanionError.invalidCapture}
        let format=ISO8601DateFormatter();format.formatOptions=[.withInternetDateTime,.withFractionalSeconds]
        if let date=format.date(from:text){return date}
        format.formatOptions=[.withInternetDateTime]
        guard let date=format.date(from:text) else{throw CompanionError.invalidCapture}
        return date
    }
    private func reply()throws->Any {
        guard let store,var value=try store.reply() as? [String:Any] else{throw CompanionError.storageUnavailable}
        value["cloudEnabled"]=sync?.cloudEnabled ?? true
        value["paired"]=sync?.paired ?? false;value["connectionStatus"]=sync?.status ?? "Not paired yet"
        return value
    }
    func perform(_ action:String,body:[String:Any])throws->Any {
        guard let store else {throw CompanionError.storageUnavailable}
        switch action {
        case "snapshot":break
        case "taskAction":
            guard let id=(body["id"] ?? body["requestID"]) as? String,let uuid=UUID(uuidString:id),let taskID=body["taskID"] as? String,let version=body["expectedVersion"] as? Int else{throw CompanionError.invalidCapture}
            if let value=body["intent"],!(value is String) {throw CompanionError.invalidCapture}
            if let raw=body["intent"] as? String {
                guard let intent=SyncTaskIntent(rawValue:raw),let issuedAt=try bridgeDate(body["issuedAt"]) else{throw CompanionError.invalidCapture}
                if let value=body["payload"],!(value is [String:Any]) {throw CompanionError.invalidCapture}
                let payload=body["payload"] as? [String:Any] ?? [:]
                let target:UUID?
                if let rawTarget=payload["targetMutationID"] {guard let value=rawTarget as? String,let parsed=UUID(uuidString:value) else{throw CompanionError.invalidCapture};target=parsed} else{target=nil}
                if let actor=payload["waitingOn"],!(actor is String) {throw CompanionError.invalidCapture}
                let command=SyncTaskAction(id:uuid,taskID:taskID,expectedVersion:version,intent:intent,issuedAt:issuedAt,
                    payload:.init(resurfaceAt:try bridgeDate(payload["resurfaceAt"]),reviewAt:try bridgeDate(payload["reviewAt"]),waitingOn:payload["waitingOn"] as? String,targetMutationID:target))
                try store.taskAction(command)
            } else {
                guard let status=body["status"] as? String else{throw CompanionError.invalidCapture}
                try store.taskAction(.init(id:uuid,taskID:taskID,expectedVersion:version,status:status))
            }
        case "capture":
            guard let id=body["id"] as? String,let text=body["text"] as? String else {throw CompanionError.invalidCapture}
            try store.capture(id:id,text:text)
        default:throw CompanionError.invalidCapture
        }
        return try reply()
    }
}
