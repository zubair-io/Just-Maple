import Foundation
import MapleCore
import MapleCompanionTransport

@MainActor enum ReviewedGroupProjection {
    static func attach(to response:inout SyncResponse,world:WorldSnapshot,store:KnowledgeStore)async throws {
        let reviews=try await store.reviewedObligationGroups().sorted{$0.id<$1.id}
        response.reviewedGroupTotal=reviews.count;response.reviewedGroups=[]
        response.supportedGroupIntents=SyncGroupIntent.allCases.map(\.rawValue)
        for review in reviews.prefix(16) {
            let transport=try SyncCodec.decode(SyncGroupReview.self,from:JSONCodec.encode(review))
            guard transport.valid else{continue}
            var titles:[String:String]=[:]
            for child in review.children {
                if child.nodeID.hasPrefix("task:"),let task=world.tasks.first(where:{"task:"+$0.id==child.nodeID && $0.version==child.expectedVersion}){titles[child.nodeID]=SourceEvidenceProjection.bounded(task.title,512)}
                else if let source=world.suggestions.first(where:{"source:"+$0.id==child.nodeID && $0.version==child.expectedVersion}){titles[child.nodeID]=SourceEvidenceProjection.bounded(source.candidate.title,512)}
            }
            guard titles.count==review.children.count else{continue}
            let group=SyncReviewedGroup(review:transport,titles:titles)
            guard try SyncCodec.encode(group).count<=32_000 else{continue}
            response.reviewedGroups?.append(group)
            if try SyncCodec.encode(response).count>235_000 {response.reviewedGroups?.removeLast()}
        }
    }
}
