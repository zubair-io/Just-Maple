import Foundation
import MapleCore

extension AppModel {
    var acpRunner:URL {Bundle.main.resourceURL!.appendingPathComponent("Providers/runner.js")}
    var factExtractor:any FactExtractor {extractionProvider == "apple" ? AppleFactExtractor() : ACPExtractor(client:ACPClient(provider:extractionProvider,runner:acpRunner))}
    var taskExtractor:any TaskCandidateExtractor {extractionProvider == "apple" ? AppleTaskExtractor() : ACPExtractor(client:ACPClient(provider:extractionProvider,runner:acpRunner))}
    func testProvider(_ provider:String) async {
        guard ["codex","claude"].contains(provider),!providerTesting else {return}
        providerTesting=true;providerStatus[provider]="Testing existing subscription login…"
        defer {providerTesting=false}
        do {
            let text=try await ACPClient(provider:provider,runner:acpRunner).request("Respond with exactly: Maple connection ready. Do not use tools.")
            guard text.trimmingCharacters(in:.whitespacesAndNewlines)=="Maple connection ready." else {throw MapleError.provider("Provider responded but did not pass the connection test. Check subscription limits and retry.")}
            providerStatus[provider]="Connected · response test passed";testedProviders.insert(provider)
        } catch {providerStatus[provider]=error.localizedDescription;testedProviders.remove(provider)}
    }
    func selectProvider(_ provider:String)throws {
        guard !busy,!stateExtractionBusy,!auditRunning,!running else {throw MapleError.invalid("Pause the loop and finish current work before switching providers.")}
        guard provider == "apple" || testedProviders.contains(provider) else {throw MapleError.invalid("Test the provider connection before selecting it.")}
        extractionProvider=provider;UserDefaults.standard.set(provider,forKey:"extractionProvider")
    }
}
