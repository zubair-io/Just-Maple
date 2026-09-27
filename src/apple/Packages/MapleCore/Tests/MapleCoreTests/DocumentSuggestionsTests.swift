import Foundation
import Testing
import MapleNotebooks
@testable import MapleCore

struct DocumentSuggestionsTests {
    @Test func offersDoNotMutateAndInsertionReplaysAfterTaskChangesWhileClearSuppresses()async throws {
        let fixture=ManagedDocumentTests()
        let(root,_,store,coordinator,id)=try await fixture.fixture();defer{try? FileManager.default.removeItem(at:root)}
        var task=LifeTask();task.title="Synthetic proposal follow up"
        task=try await store.saveTask(task,expectedVersion:0,requestID:"task")
        let day=try await coordinator.open(notebookID:id,day:"2026-10-30")
        let offers=try await store.documentSuggestions(documentID:day.documentID)
        #expect(offers.tasks.map(\.taskID)==["task:"+task.id])
        #expect(try await coordinator.open(documentID:day.documentID).revision==day.revision)
        let inserted=try await coordinator.insertTask(documentID:day.documentID,expectedRevision:day.revision,commandID:"insert",taskID:"task:"+task.id)
        #expect(inserted.content.contains("Synthetic proposal follow up"))
        task.title="Updated canonical title";task=try await store.saveTask(task,expectedVersion:task.version,requestID:"rename")
        #expect(try await coordinator.insertTask(documentID:day.documentID,expectedRevision:day.revision,commandID:"insert",taskID:"task:"+task.id).revision==inserted.revision)
        let block=try #require(inserted.blocks.first(where:{$0.taskID=="task:"+task.id}))
        let cleared=try await coordinator.mutateBlock(.init(commandID:"clear",documentID:day.documentID,expectedRevision:inserted.revision,blockID:block.blockID,expectedBlockVersion:block.version,kind:"clear"))
        #expect(try await store.documentSuggestions(documentID:day.documentID).tasks.isEmpty)
        #expect(try await store.tasks().first?.status == .open)
        await #expect(throws:Error.self){try await coordinator.insertTask(documentID:day.documentID,expectedRevision:cleared.revision,commandID:"resurrect",taskID:"task:"+task.id)}
    }
    @Test func carryForwardOffersUnfinishedLinkedTasksWithoutChangingEitherDay()async throws {
        let(root,_,store,coordinator,id)=try await ManagedDocumentTests().fixture();defer{try? FileManager.default.removeItem(at:root)}
        var task=LifeTask();task.title="Synthetic carry forward"
        task=try await store.saveTask(task,expectedVersion:0,requestID:"task")
        let first=try await coordinator.open(notebookID:id,day:"2026-10-29")
        let previous=try await coordinator.insertTask(documentID:first.documentID,expectedRevision:first.revision,commandID:"link",taskID:"task:"+task.id)
        let today=try await coordinator.open(notebookID:id,day:"2026-10-30")
        let offers=try await store.documentSuggestions(documentID:today.documentID)
        #expect(offers.carryForward.count==1)
        #expect(offers.carryForward.first?.revision==previous.revision)
        #expect(try await coordinator.open(documentID:today.documentID).revision==today.revision)
        task.status = .completed
        _ = try await store.saveTask(task,expectedVersion:task.version,requestID:"done")
        #expect(try await store.documentSuggestions(documentID:today.documentID).carryForward.isEmpty)
    }
}
