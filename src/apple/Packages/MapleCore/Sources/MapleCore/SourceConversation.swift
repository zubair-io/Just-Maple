import Foundation

public struct SourceConversationMessage: Codable, Sendable {
    public let eventID:String
    public let occurredAt:Date
    public let receivedAt:Date
    public let sender:String?
    public let direction:String?
    public let content:String
    public let truncated:Bool
    public let selected:Bool
    public let historicalRevision:Bool
}
public struct SourceConversation: Codable, Sendable {
    public let threadID:String
    public let connector:String
    public let account:String
    public let messages:[SourceConversationMessage]
    public let totalMessages:Int
    public let omittedMessages:Int
    public let asOf:Date
}
extension KnowledgeStore {
    /// Inspect one explicit conversation; never infer membership from a sender,
    /// subject line or company name. Original selected revisions remain inspectable.
    func sourceConversation(_ selected:Event,at:Date) throws -> SourceConversation? {
        guard ["gmail","imessage"].contains(selected.source.connector),selected.occurredAt<=at,selected.receivedAt<=at else{return nil}
        let threads=Set(selected.subjects.filter{$0.hasPrefix("thread:\(selected.source.connector):")})
        guard threads.count==1,let thread=threads.first else{return nil}
        let filter="""
          e.connector=? AND e.account=? AND e.occurred_at<=? AND e.received_at<=?
          AND EXISTS (SELECT 1 FROM event_subjects s WHERE s.event_id=e.id AND s.subject=?)
          AND NOT EXISTS (SELECT 1 FROM events n WHERE n.connector=e.connector AND n.account=e.account AND n.external_id=e.external_id
            AND n.occurred_at<=? AND n.received_at<=? AND (n.received_at>e.received_at OR (n.received_at=e.received_at AND n.rowid>e.rowid)))
        """
        let timestamp=String(at.timeIntervalSince1970)
        let values=[selected.source.connector,selected.source.account,timestamp,timestamp,thread,timestamp,timestamp]
        let total=Int(try db.rows("SELECT COUNT(*) AS count FROM events e WHERE \(filter)",values).first?["count"] ?? "0") ?? 0
        var events=try db.rows("SELECT e.json FROM events e WHERE \(filter) ORDER BY e.occurred_at DESC,e.id DESC LIMIT 50",values).map{try JSONCodec.decode(Event.self,from:Data($0["json"]!.utf8))}
        let selectedLatest = !(try db.rows("SELECT e.id FROM events e WHERE \(filter) AND e.id=?",values+[selected.id])).isEmpty
        if !events.contains(where:{$0.id==selected.id}) {events.append(selected)}
        events.sort{$0.occurredAt==$1.occurredAt ? $0.id<$1.id:$0.occurredAt<$1.occurredAt}
        let messages=events.map { event in
            let headers=event.content.components(separatedBy:"\n").prefix(20)
            func header(_ key:String)->String? {headers.first{$0.hasPrefix(key+": ")}.map{String($0.dropFirst(key.count+2).prefix(240))}}
            let direction=header("Direction").flatMap{["incoming","outgoing"].contains($0) ? $0:nil}
            let excerpt=Self.utf8Excerpt(event.content,limit:1600)
            return SourceConversationMessage(eventID:event.id,occurredAt:event.occurredAt,receivedAt:event.receivedAt,
                sender:header("Sender") ?? header("From"),direction:direction,content:excerpt,truncated:event.content.utf8.count>1600,
                selected:event.id==selected.id,historicalRevision:event.id==selected.id && !selectedLatest)
        }
        let displayedLatest=events.count-(selectedLatest ? 0:1)
        return SourceConversation(threadID:thread,connector:selected.source.connector,account:selected.source.account,
            messages:messages,totalMessages:total,omittedMessages:max(0,total-displayedLatest),asOf:at)
    }
}
