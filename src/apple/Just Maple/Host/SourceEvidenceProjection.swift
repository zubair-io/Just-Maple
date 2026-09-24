import Foundation
import MapleCore
import MapleCompanionTransport

/// Source text is displayed as text, never HTML, instructions, or an outbound action.
enum SourceEvidenceProjection {
    static func make(_ event:Event?,id:String,contentLimit:Int=256_000)->SyncSourceEvidence {
        guard let event else{return .init(id:id,connector:"Unknown source",content:"",truncated:false,available:false)}
        let header=event.content.components(separatedBy:"\n\n").first ?? event.content
        func field(_ name:String)->String? {
            guard let line=header.components(separatedBy:"\n").first(where:{$0.hasPrefix(name+": ")}) else{return nil}
            return bounded(String(line.dropFirst(name.count+2)),256)
        }
        let content=bounded(event.content,contentLimit)
        return .init(id:event.id,connector:bounded(event.source.connector,80),sender:field("Sender"),subject:field("Subject") ?? field("Thread") ?? field("Title"),occurredAt:event.occurredAt,content:content,truncated:content.utf8.count<event.content.utf8.count)
    }
    static func bounded(_ value:String,_ limit:Int)->String {
        var output="",bytes=0
        for scalar in value.unicodeScalars {
            guard bytes+scalar.utf8.count<=limit else{break}
            output.unicodeScalars.append(scalar);bytes+=scalar.utf8.count
        }
        return output
    }
    @MainActor static func attach(to response:inout SyncResponse,store:KnowledgeStore)async throws {
        let count=response.tasks.reduce(0){$0+min($1.sourceIDs?.count ?? 0,2)}
        let limit=min(4096,48_000/max(1,count))
        var cache:[String:SyncSourceEvidence]=[:]
        for index in response.tasks.indices {
            var previews:[SyncSourceEvidence]=[]
            for id in (response.tasks[index].sourceIDs ?? []).prefix(2) {
                if cache[id]==nil {cache[id]=make(try await store.event(id),id:id,contentLimit:limit)}
                if let source=cache[id]{previews.append(source)}
            }
            response.tasks[index].sources=previews
        }
        // Preserve task rows and explicitly report a shorter source preview if escaping
        // or existing descriptions consume the encrypted frame's remaining capacity.
        while try SyncCodec.encode(response).count>240_000 {
            let candidates=response.tasks.indices.filter{!(response.tasks[$0].sources ?? []).allSatisfy{$0.content.isEmpty}}
            guard let index=candidates.last,let sourceIndex=response.tasks[index].sources?.indices.last(where:{!(response.tasks[index].sources?[$0].content.isEmpty ?? true)}) else{break}
            response.tasks[index].sources?[sourceIndex].content=""
            response.tasks[index].sources?[sourceIndex].truncated=true
        }
        // Metadata also has a cost; omit cached previews, keeping source IDs/count visible.
        while try SyncCodec.encode(response).count>240_000 {
            guard let index=response.tasks.indices.last(where:{!(response.tasks[$0].sources ?? []).isEmpty}) else{break}
            response.tasks[index].sources=[]
        }
    }
}
