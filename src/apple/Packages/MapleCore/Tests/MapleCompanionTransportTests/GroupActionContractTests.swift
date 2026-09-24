import Foundation
import Testing
@testable import MapleCompanionTransport
struct GroupActionContractTests {
    func review()->SyncGroupReview {.init(id:"review",context:.init(intentID:"Review forms",actorID:"Fixture actor",targetID:"Fixture forms",connector:"gmail",account:"fixture",sourceScopeID:"thread:fixture"),maximumSpan:3600,children:[.init(nodeID:"task:a",expectedVersion:1),.init(nodeID:"task:b",expectedVersion:2)])}
    @Test func membershipVersionAndUndoRoundTripWithoutSingleTaskSemantics() throws {
        let value=SyncGroupAction(intent:.done,review:review())
        #expect(value.valid)
        #expect(try SyncCodec.decode(SyncGroupAction.self,from:SyncCodec.encode(value))==value)
        let undo=SyncGroupAction(intent:.undo,targetMutationID:value.id)
        #expect(undo.valid)
        #expect(try SyncCodec.decode(SyncGroupAction.self,from:SyncCodec.encode(undo))==undo)
        var duplicate=review();duplicate.children.append(duplicate.children[0])
        #expect(!duplicate.valid)
        #expect(!SyncGroupAction(intent:.done).valid)
        #expect(!SyncGroupAction(intent:.undo,review:review(),targetMutationID:value.id).valid)
        #expect(!SyncGroupActionReceipt(id:value.id,outcome:"applied").valid)
        #expect(SyncGroupActionReceipt(id:value.id,outcome:"unsupported").valid)
    }
}
