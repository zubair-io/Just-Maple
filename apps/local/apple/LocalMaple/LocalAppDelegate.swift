#if os(macOS)
import AppKit

@MainActor
final class LocalAppDelegate: NSObject, NSApplicationDelegate {
    static let editors = NSHashTable<WebViewController>.weakObjects()
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        Task {
            do {
                for editor in Self.editors.allObjects { try await editor.flushPendingSaves() }
                sender.reply(toApplicationShouldTerminate: true)
            } catch {
                let alert = NSAlert()
                alert.messageText = "Your note could not be saved"
                var recoverySafe = true
                for editor in Self.editors.allObjects {
                    if !(await editor.hasDurableRecoveryDrafts()) { recoverySafe = false }
                }
                alert.informativeText = recoverySafe
                    ? "The recovery draft is kept. Resolve the save error, or quit and recover it next time."
                    : "Recovery storage is unavailable. Keep the app open and save or copy your edits before quitting."
                alert.addButton(withTitle: "Keep app open")
                if recoverySafe { alert.addButton(withTitle: "Quit with recovery draft") }
                let choice = alert.runModal()
                sender.reply(toApplicationShouldTerminate: recoverySafe && choice == .alertSecondButtonReturn)
            }
        }
        return .terminateLater
    }
}
#endif
