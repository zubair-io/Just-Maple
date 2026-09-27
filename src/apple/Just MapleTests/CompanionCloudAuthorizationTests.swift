import AppKit
import CloudKit
import Security
import Testing
import MapleCore
import MapleCompanionTransport
@testable import Just_Maple

@MainActor private final class AuthorizationAccount: CloudCompanionAccountProviding {
    var name = "fixture-account-a"
    var available = true
    var calls = 0
    var onRead: ((Int) -> Void)?
    var gate: CheckedContinuation<Void, Never>?
    var suspendNext = false
    func accountStatus() async throws -> CKAccountStatus { available ? .available : .noAccount }
    func userRecordName() async throws -> String {
        calls += 1; onRead?(calls)
        if suspendNext { suspendNext = false; await withCheckedContinuation { gate = $0 } }
        return name
    }
}
@MainActor private final class AuthorizationKeychain: CloudCompanionKeychain {
    var items: [String: Data] = [:]
    var adds = 0
    var onAdd: (() -> Void)?
    func copyMatching(_ query: [String: Any]) -> (OSStatus, Data?) {
        let value = items[query[kSecAttrAccount as String] as! String]
        return value == nil ? (errSecItemNotFound,nil) : (errSecSuccess,value)
    }
    func add(_ attributes: [String: Any]) -> OSStatus {
        let key = attributes[kSecAttrAccount as String] as! String
        if items[key] != nil { return errSecDuplicateItem }
        onAdd?(); adds += 1; items[key] = attributes[kSecValueData as String] as? Data
        return errSecSuccess
    }
    func delete(_ query: [String: Any]) -> OSStatus { items.removeValue(forKey: query[kSecAttrAccount as String] as! String); return errSecSuccess }
}
@MainActor private final class AuthorizationFixture {
    let account = AuthorizationAccount()
    let keychain = AuthorizationKeychain()
    let suite = "maple-test-" + UUID().uuidString
    let preferences: UserDefaults
    var local: [String: Data] = [:]
    var remote: FixtureRemoteMailbox?
    var supportedTaskIntents=SyncTaskIntent.allCases
    var active: PairingConfiguration?
    var stops = 0
    var suspendStart = false
    var startGate: CheckedContinuation<Void,Never>?
    var identity: CloudCompanionIdentity { CloudCompanionIdentity(accountProvider: account, keychain: keychain) }
    init() { preferences = UserDefaults(suiteName: suite)! }
    func controller() -> CompanionMacController {
        CompanionMacController(dependencies: .init(cloud: identity, preferences: preferences,
            loadLocal: { self.local[$0] }, saveLocal: { self.local[$0] = $1 }, deleteLocal: { self.local.removeValue(forKey: $0) },
            start: { configuration, _ in
                self.active = configuration
                if self.suspendStart { self.suspendStart = false; await withCheckedContinuation { self.startGate = $0 } }
            }, stop: { self.stops += 1; self.active = nil }, isListening: { self.active != nil }, mailboxFactory: remote.map { remote in { _,_,authorize in remote.authorize = authorize; return remote } }, supportedTaskIntents:supportedTaskIntents, automaticMonitoring: false))
    }
    func model() async throws -> AppModel { let model = AppModel(); model.store = try KnowledgeStore(path: ":memory:"); return model }
    func request() throws -> Data { try SyncCodec.encode(SyncRequest(deviceID: UUID(), operation: "sync")) }
}

@MainActor struct CompanionCloudAuthorizationTests {
    @Test func automaticConnectionMigratesOldPreferencesAndRestoresItsOwnCredential() async throws {
        let fixture=AuthorizationFixture(), mailbox=FixtureRemoteMailbox()
        fixture.remote=mailbox
        fixture.preferences.set(true,forKey:"companionCloudPaused")
        fixture.preferences.set(true,forKey:"companionManualMode")
        let host=fixture.controller(), model=try await fixture.model()
        model.name="Fixture User"
        await host.restore(model:model)
        #expect(host.cloudEnabled)
        let original=try #require(fixture.active)
        #expect(mailbox.snapshots.first?.displayName=="Fixture User")
        fixture.keychain.items.removeAll()
        await host.cloudTick()
        #expect(fixture.active==original)
        #expect(fixture.keychain.adds==2)
        #expect(host.status.contains("Synced through iCloud"))
    }
    @Test func changedAccountNeverPublishesOrServesBoundWorkspace() async throws {
        let fixture = AuthorizationFixture()
        let host = fixture.controller(), model = try await fixture.model()
        fixture.keychain.onAdd = { #expect(fixture.local["cloud-owner"] != nil) }
        await host.restore(model: model)
        let original = try #require(fixture.active)
        #expect(fixture.keychain.adds == 1 && fixture.local["cloud-owner"] != nil)
        fixture.account.name = "fixture-account-b"
        do { _ = try await host.receive(fixture.request(), configuration: original); Issue.record("Served workspace to another account") } catch {}
        #expect(fixture.active == nil && !host.paired)
        await host.cloudTick()
        #expect(fixture.keychain.adds == 1 && fixture.active == nil)
        do { try await host.enableCloud(model: model); Issue.record("Rebound existing workspace to new account") } catch {}
        #expect(!host.cloudEnabled && fixture.active == nil)
    }

    @Test func credentialLossAndSwitchDuringSnapshotRecheckStopService() async throws {
        for switchAccount in [false,true] {
            let fixture = AuthorizationFixture(), host = fixture.controller(), model = try await fixture.model()
            await host.restore(model: model)
            let config = try #require(fixture.active)
            let secondRequestCheck = fixture.account.calls + 2
            fixture.account.onRead = { count in
                if count == secondRequestCheck {
                    if switchAccount { fixture.account.name = "fixture-account-b" }
                    else { fixture.keychain.items.removeAll() }
                }
            }
            do { _ = try await host.receive(fixture.request(), configuration: config); Issue.record("Returned snapshot after credential/account changed") } catch {}
            #expect(fixture.active == nil && !host.paired)
            await host.cloudTick()
            #expect(fixture.keychain.adds == (switchAccount ? 1 : 2))
            #expect(switchAccount ? fixture.active == nil : fixture.active == config)
        }
    }

    @Test func anotherMacCredentialCannotReplaceLocalWorkspaceOwner() async throws {
        let fixture = AuthorizationFixture(), host = fixture.controller(), model = try await fixture.model()
        await host.restore(model: model)
        let account = try await fixture.identity.accountID()
        let other = try PairingConfiguration.create()
        fixture.keychain.items[account] = try SyncCodec.encode(other)
        await host.cloudTick()
        #expect(fixture.active == nil && !host.paired && fixture.keychain.adds == 1)
        do { _ = try await host.receive(fixture.request(), configuration: other); Issue.record("Served another Mac credential") } catch {}
    }

    @Test func staleCloudStartupCannotStopNewManualListener() async throws {
        let fixture = AuthorizationFixture(), host = fixture.controller(), model = try await fixture.model()
        fixture.suspendStart = true
        let cloudStart = Task { await host.restore(model: model) }
        while fixture.startGate == nil { await Task.yield() }
        try host.disconnect()
        let manual = try PairingConfiguration.create(), device = UUID()
        struct ManualRecord: Codable { var configuration: PairingConfiguration; var deviceID: UUID }
        fixture.local["phone"] = try SyncCodec.encode(ManualRecord(configuration: manual, deviceID: device))
        fixture.preferences.set(true, forKey: "companionManualMode")
        await host.restore(model: model)
        let stops = fixture.stops
        fixture.startGate?.resume(); fixture.startGate = nil
        await cloudStart.value
        #expect(fixture.active == manual && fixture.stops == stops)
        fixture.account.name = "another-account"
        await host.cloudTick()
        #expect(fixture.active == manual)
        let data = try SyncCodec.encode(SyncRequest(deviceID: device, operation: "sync"))
        _ = try await host.receive(data, configuration: manual)
    }

    @Test func explicitResumeRevokesOldRequestsBeforeAccountAwait() async throws {
        let fixture = AuthorizationFixture(), host = fixture.controller(), model = try await fixture.model()
        await host.restore(model: model)
        let config = try #require(fixture.active)
        fixture.account.suspendNext = true
        let resume = Task { try await host.enableCloud(model: model) }
        while fixture.account.gate == nil { await Task.yield() }
        #expect(fixture.active == nil && !host.cloudEnabled)
        do { _ = try await host.receive(fixture.request(), configuration: config); Issue.record("Old authorization survived pending resume") } catch {}
        fixture.account.gate?.resume(); fixture.account.gate = nil
        try await resume.value
        #expect(host.cloudEnabled && fixture.active != nil)
    }
}

@MainActor private final class FixtureRemoteMailbox: CompanionMacMailbox {
    var actions:[SyncDeviceTaskAction]=[]
    var actionReceipts:[SyncTaskActionReceipt]=[]
    func pendingActions()async throws->[SyncDeviceTaskAction]{try await authorize?();return actions}
    func acknowledgeAction(deviceID:UUID,receipt:SyncTaskActionReceipt)async throws {try await authorize?();if failAcknowledgment {throw CompanionErrorFixture.failed};actionReceipts.append(receipt);actions.removeAll{$0.deviceID==deviceID && $0.action.id==receipt.id}}
    var requests: [SyncRequest] = []
    var acknowledgments: [(UUID,[UUID])] = []
    var snapshots: [SyncResponse] = []
    var failAcknowledgment = false
    var pendingHook: (() -> Void)?
    var publishHook: (() throws -> Void)?
    var authorize: CompanionMacDependencies.Authorization?
    func pending(limit: Int) async throws -> [SyncRequest] { pendingHook?(); try await authorize?(); return Array(requests.prefix(limit)) }
    func acknowledge(deviceID: UUID, captureIDs: [UUID]) async throws {
        try await authorize?()
        if failAcknowledgment { throw CompanionErrorFixture.failed }
        acknowledgments.append((deviceID,captureIDs))
    }
    func publishSnapshot(_ response: SyncResponse) async throws { try publishHook?(); try await authorize?(); snapshots.append(response) }
    enum CompanionErrorFixture: Error { case failed }
}

@MainActor struct CompanionRemoteMailboxTests {
    @Test func unsupportedIntentDoesNotBlockCapturesOrSnapshot() async throws {
        let fixture=AuthorizationFixture(),mailbox=FixtureRemoteMailbox();fixture.remote=mailbox;fixture.supportedTaskIntents=[]
        let host=fixture.controller(),model=try await fixture.model(),store=try #require(model.store)
        var task=LifeTask();task.title="Synthetic guarded intent"
        task=try await store.saveTask(task,expectedVersion:0,requestID:UUID().uuidString)
        mailbox.actions=[.init(deviceID:UUID(),action:.init(taskID:"task:"+task.id,expectedVersion:task.version,intent:.done))]
        mailbox.requests=[.init(deviceID:UUID(),operation:"sync",captures:[.init(id:UUID(),text:"Synthetic unrelated capture",createdAt:Date())])]
        await host.restore(model:model)
        #expect(mailbox.acknowledgments.count==1)
        #expect(mailbox.snapshots.first?.supportedTaskIntents==[])
        #expect(mailbox.actionReceipts.first?.outcome=="unsupported")
        #expect(mailbox.actions.isEmpty)
        #expect(!mailbox.snapshots.isEmpty)
        #expect(try await store.tasks().first?.version==task.version)
        #expect(try await store.tasks().first?.status==task.status)
    }
    @Test func typedCompletionAndUndoUseReceiptRevisionAndAuthenticatedDeviceScope() async throws {
        let fixture=AuthorizationFixture(),mailbox=FixtureRemoteMailbox();fixture.remote=mailbox
        let host=fixture.controller(),model=try await fixture.model(),store=try #require(model.store)
        var task=LifeTask();task.title="Synthetic typed action"
        task=try await store.saveTask(task,expectedVersion:0,requestID:UUID().uuidString)
        let device=UUID(),done=SyncTaskAction(taskID:"task:"+task.id,expectedVersion:task.version,intent:.done)
        mailbox.actions=[.init(deviceID:device,action:done)];mailbox.failAcknowledgment=true
        await host.restore(model:model)
        #expect(try await store.tasks().first?.status == .completed)
        mailbox.failAcknowledgment=false;await host.cloudTick()
        let receipt=try #require(mailbox.actionReceipts.first)
        #expect(receipt.outcome=="applied" && receipt.resultingVersion==task.version+1)
        #expect(mailbox.snapshots.last?.tasks.isEmpty==true)
        let foreignUndo=SyncTaskAction(taskID:done.taskID,expectedVersion:task.version+1,intent:.undo,payload:.init(targetMutationID:done.id))
        mailbox.actions=[.init(deviceID:UUID(),action:foreignUndo)];await host.cloudTick()
        #expect(mailbox.actionReceipts.last?.outcome=="conflict")
        let undo=SyncTaskAction(taskID:done.taskID,expectedVersion:task.version+1,intent:.undo,payload:.init(targetMutationID:done.id))
        mailbox.actions=[.init(deviceID:device,action:undo)];await host.cloudTick()
        #expect(mailbox.actionReceipts.last?.outcome=="applied")
        #expect(mailbox.actionReceipts.last?.resultingVersion==task.version+2)
        #expect(try await store.tasks().first?.status == .open)
    }
    @Test func taskActionsCommitOnceAndStaleVersionReturnsConflict()async throws {
        let fixture=AuthorizationFixture(),mailbox=FixtureRemoteMailbox();fixture.remote=mailbox
        let host=fixture.controller(),model=try await fixture.model(),store=try #require(model.store)
        var task=LifeTask();task.title="Synthetic phone action"
        task=try await store.saveTask(task,expectedVersion:0,requestID:UUID().uuidString)
        let device=UUID(),action=SyncTaskAction(taskID:"task:"+task.id,expectedVersion:task.version,status:"completed")
        mailbox.actions=[.init(deviceID:device,action:action)];mailbox.failAcknowledgment=true
        await host.restore(model:model)
        #expect(try await store.tasks().first?.status == .completed)
        #expect(mailbox.actionReceipts.isEmpty)
        mailbox.failAcknowledgment=false;await host.cloudTick()
        #expect(mailbox.actionReceipts==[.init(id:action.id,outcome:"applied")])
        #expect(try await store.tasks().first?.version==task.version+1)
        mailbox.actions=[.init(deviceID:device,action:.init(taskID:"task:"+task.id,expectedVersion:task.version,status:"open"))]
        await host.cloudTick()
        #expect(mailbox.actionReceipts.last?.outcome=="conflict")
        #expect(try await store.tasks().first?.status == .completed)
    }
    @Test func cloudReceiptsFollowCommittedIngestionAndRetryIsIdempotent() async throws {
        let fixture = AuthorizationFixture(), mailbox = FixtureRemoteMailbox()
        fixture.remote = mailbox
        let host = fixture.controller(), model = try await fixture.model()
        let device = UUID(), valid = UUID(), invalid = UUID()
        mailbox.requests = [.init(deviceID: device, operation: "sync", captures: [.init(id: valid, text: "Remote fixture capture", createdAt: Date()), .init(id: invalid, text: "", createdAt: Date())])]
        mailbox.failAcknowledgment = true
        await host.restore(model: model)
        let store = try #require(model.store)
        #expect(try await store.eventCount() == 1)
        #expect(mailbox.acknowledgments.isEmpty && mailbox.snapshots.isEmpty)
        mailbox.failAcknowledgment = false
        await host.cloudTick()
        #expect(try await store.eventCount() == 1)
        #expect(mailbox.acknowledgments.count == 1)
        #expect(mailbox.acknowledgments.first?.0 == device)
        #expect(mailbox.acknowledgments.first?.1 == [valid])
        #expect(mailbox.snapshots.count == 1)
    }

    @Test func accountChangeDuringRemoteFetchCannotIngestAcknowledgeOrPublish() async throws {
        let fixture = AuthorizationFixture(), mailbox = FixtureRemoteMailbox()
        fixture.remote = mailbox
        let host = fixture.controller(), model = try await fixture.model()
        mailbox.requests = [.init(deviceID: UUID(), operation: "sync", captures: [.init(id: UUID(), text: "Must not enter this workspace", createdAt: Date())])]
        mailbox.pendingHook = { fixture.account.name = "different-cloud-account" }
        await host.restore(model: model)
        #expect(try await model.store?.eventCount() == 0)
        #expect(mailbox.acknowledgments.isEmpty && mailbox.snapshots.isEmpty)
        #expect(fixture.active == nil && !host.paired)
    }

    @Test func completingMacTaskPublishesFullReplacementWithoutTheTask() async throws {
        let fixture = AuthorizationFixture(), mailbox = FixtureRemoteMailbox()
        fixture.remote = mailbox
        let host = fixture.controller(), model = try await fixture.model()
        let store = try #require(model.store)
        var input = LifeTask(); input.title = "Fixture remote task"
        var task = try await store.saveTask(input, expectedVersion: 0, requestID: UUID().uuidString)
        await host.restore(model: model)
        #expect(mailbox.snapshots.last?.tasks.map(\.id) == ["task:" + task.id])
        task.status = .completed
        _ = try await store.saveTask(task, expectedVersion: task.version, requestID: UUID().uuidString)
        await host.cloudTick()
        #expect(mailbox.snapshots.count == 2)
        #expect(mailbox.snapshots.last?.tasks.isEmpty == true)
    }

    @Test func pauseDuringMailboxPublishRevokesItsInternalAuthorization() async throws {
        let fixture = AuthorizationFixture(), mailbox = FixtureRemoteMailbox()
        fixture.remote = mailbox
        let host = fixture.controller(), model = try await fixture.model()
        mailbox.publishHook = { try host.disconnect() }
        await host.restore(model: model)
        #expect(mailbox.snapshots.isEmpty && fixture.active == nil && !host.cloudEnabled)
    }

    @Test func emptySnapshotPublishesWithoutPhoneRegistrationAndUnchangedDataIsNotReuploaded() async throws {
        let fixture = AuthorizationFixture(), mailbox = FixtureRemoteMailbox()
        fixture.remote = mailbox
        let host = fixture.controller(), model = try await fixture.model()
        await host.restore(model: model)
        #expect(mailbox.snapshots.count == 1)
        #expect(mailbox.snapshots.first?.tasks.isEmpty == true)
        #expect(mailbox.snapshots.first?.receivedIDs.isEmpty == true)
        await host.cloudTick()
        #expect(mailbox.snapshots.count == 1)
        try host.disconnect()
        await host.cloudTick()
        #expect(mailbox.snapshots.count == 1)
    }
}
