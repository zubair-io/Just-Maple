import Foundation
import Testing
import MapleCore
@testable import Just_Maple

@MainActor struct StartupConnectionGuardTests {
    @Test func connectionChangesWaitForRestoreBeforeAnyProviderOrSettingsMutation() throws {
        // This pure pre-dispatch check cannot touch live Keychain credentials, connectors,
        // OAuth state or preferences. All affected command families must fail while restoring.
        let actions=["connect","disconnect","unlockKey",
                     "googleConfigure","googleConnect","googleCancel","googleUnlock","googleDisconnect",
                     "googlePoll","googleCalendarList","googleContactsPause","googleContactsResume",
                     "googleMailPause","googleMailResume","googleCalendarPause","googleCalendarResume","googleCalendarSelection",
                     "homeConnect","homeExposure","homeUnlock","homePoll","homePause","homeResume","homeSelection"]
        for action in actions {
            do {
                try Bridge.validateStartupAction(action,starting:true)
                Issue.record("Connection change was allowed during restore: \(action)")
            } catch let error as MapleError {
                #expect(error.localizedDescription.contains("still being restored"))
                #expect(error.localizedDescription.contains("try this connection change again"))
            }
            try Bridge.validateStartupAction(action,starting:false)
        }
    }
    @Test func cachedShellAndDailyWorkStayAvailableDuringRestore() throws {
        for action in ["snapshot","retryStartup","loop","todayOpen","documentOpen","documentCommit","documentDraft",
                       "noteRead","noteSave","notebookCatalog","sourceList","sourceDetail","documentHistory",
                       "applyTaskAction","introduce","step","clearError","diskAccess","providerSelect","classificationSelect","classificationReload"] {
            try Bridge.validateStartupAction(action,starting:true)
            try Bridge.validateStartupAction(action,starting:false)
        }
    }
}
