import Foundation
import Testing
@testable import MapleCompanionTransport

struct TaskActionContractTests {
    let issued = Date(timeIntervalSince1970: 1_800_000_000)
    func action(_ intent: SyncTaskIntent, _ payload: SyncTaskActionPayload = .init()) -> SyncTaskAction {
        .init(taskID: "task:fixture", expectedVersion: 3, intent: intent, issuedAt: issued, payload: payload)
    }
    @Test func typedIntentsRoundTripAndCannotMasqueradeAsLegacyStatus() throws {
        let values = [action(.done), action(.notNeeded), action(.waiting, .init(reviewAt: issued.addingTimeInterval(600), waitingOn: "Fixture actor")),
                      action(.later, .init(resurfaceAt: issued.addingTimeInterval(60))), action(.undo, .init(targetMutationID: UUID()))]
        for value in values {
            #expect(value.valid)
            #expect(value.validForEnqueue(at: issued))
            #expect(value.status.hasPrefix("intent:"))
            #expect(try SyncCodec.decode(SyncTaskAction.self, from: SyncCodec.encode(value)) == value)
        }
    }
    @Test func legacyStatusCommandsDecodeWithoutNewRequiredFields() throws {
        for status in ["completed", "open", "cancelled"] {
            let data = Data("{\"id\":\"00000000-0000-0000-0000-000000000001\",\"taskID\":\"source:fixture\",\"expectedVersion\":1,\"status\":\"\(status)\"}".utf8)
            let value = try SyncCodec.decode(SyncTaskAction.self, from: data)
            #expect(value.intent == nil && value.payload == nil && value.issuedAt == nil)
            #expect(value.valid && value.status == status)
            #expect(try SyncCodec.decode(SyncTaskAction.self, from: SyncCodec.encode(value)) == value)
        }
    }
    @Test func malformedAndCrossIntentPayloadsFailClosed() throws {
        var bad = [action(.later), action(.undo), action(.done, .init(waitingOn: "actor")),
                   action(.later, .init(resurfaceAt: issued)), action(.waiting, .init(waitingOn: "  ")),
                   action(.waiting, .init(waitingOn: String(repeating: "x", count: 257))),
                   action(.waiting, .init(reviewAt: issued.addingTimeInterval(-1))),
                   action(.undo, .init(resurfaceAt: issued.addingTimeInterval(10), targetMutationID: UUID()))]
        var mismatch = action(.done); mismatch.status = "completed"; bad.append(mismatch)
        var selfUndo = action(.undo); selfUndo.payload = .init(targetMutationID: selfUndo.id); bad.append(selfUndo)
        var zeroVersion = action(.done); zeroVersion.expectedVersion = 0; bad.append(zeroVersion)
        var emptyID = action(.done); emptyID.taskID = "task:"; bad.append(emptyID)
        var legacyPayload = SyncTaskAction(taskID: "task:x", expectedVersion: 1, status: "open"); legacyPayload.payload = .init(); bad.append(legacyPayload)
        for value in bad {
            #expect(!value.valid)
            let data = try SyncCodec.encode(value)
            #expect(throws: DecodingError.self) { try SyncCodec.decode(SyncTaskAction.self, from: data) }
        }
        let unknown = Data("{\"id\":\"00000000-0000-0000-0000-000000000001\",\"taskID\":\"task:x\",\"expectedVersion\":1,\"status\":\"intent:execute\",\"intent\":\"execute\"}".utf8)
        #expect(throws: DecodingError.self) { try SyncCodec.decode(SyncTaskAction.self, from: unknown) }
    }
    @Test func deferredRetryRemainsValidAfterDateWhileNewEnqueueRejectsPastAndNonfiniteDates() {
        let later = action(.later, .init(resurfaceAt: issued.addingTimeInterval(60)))
        #expect(later.valid)
        #expect(!later.validForEnqueue(at: issued.addingTimeInterval(120)))
        #expect(later.valid) // Stable stored-command validation is independent of wall clock.
        #expect(!action(.later, .init(resurfaceAt: .init(timeIntervalSince1970: .infinity))).valid)
        #expect(!action(.waiting, .init(reviewAt: .init(timeIntervalSince1970: .nan))).valid)
        var future = action(.done); future.issuedAt = issued.addingTimeInterval(301)
        #expect(!future.validForEnqueue(at: issued))
    }
}
