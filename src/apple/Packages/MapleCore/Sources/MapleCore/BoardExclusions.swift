import Foundation

public struct BoardExclusion:Codable,Sendable,Equatable {
    public var id:String
    public var scope:String
    public var connector:String
    public var account:String
    public var value:String
    public var label:String
}

extension KnowledgeStore {
    public func boardExclusions() throws -> [BoardExclusion] {
        try db.rows("SELECT json FROM board_exclusions ORDER BY id").map{try JSONCodec.decode(BoardExclusion.self,from:Data($0["json"]!.utf8))}
    }
    private func boardHeader(_ event:Event,_ names:[String])->String? {
        for line in event.content.components(separatedBy:"\n").prefix(20) {
            if line=="Body:" || line=="Body (snippet only):" {break}
            for name in names where line.hasPrefix(name+": ") {return String(line.dropFirst(name.count+2)).trimmingCharacters(in:.whitespacesAndNewlines).lowercased()}
        }
        return nil
    }
    private func boardSender(_ event:Event)->String? {
        guard let sender=boardHeader(event,["Sender","From"]),!sender.isEmpty else{return nil}
        if let regex=try? NSRegularExpression(pattern:#"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}"#,options:.caseInsensitive),let match=regex.firstMatch(in:sender,range:NSRange(sender.startIndex...,in:sender)),let range=Range(match.range,in:sender) {return String(sender[range])}
        return sender
    }
    public func excludeBoardSource(eventID:String,scope:String) throws -> BoardExclusion {
        guard let event=try event(eventID) else {throw MapleError.invalid("This captured source is unavailable.")}
        var rule=BoardExclusion(id:"",scope:scope,connector:event.source.connector,account:event.source.account,value:"",label:"")
        switch scope {
        case "github":
            guard event.source.connector.lowercased().contains("mail"),let sender=boardSender(event),sender.hasSuffix("@github.com") || sender.hasSuffix("@notifications.github.com") else {throw MapleError.invalid("Choose a GitHub notification email to create this rule.")}
            rule.connector="*";rule.account="*";rule.value="github.com";rule.label="GitHub notification emails"
        case "sender":
            guard let sender=boardSender(event) else {throw MapleError.invalid("This source has no captured sender to match.")}
            rule.value=sender;rule.label="Messages from "+sender
        case "type":rule.value=event.type;rule.label="All "+event.source.connector+" · "+event.type
        default:throw MapleError.invalid("Choose a supported board exclusion.")
        }
        guard rule.value.utf8.count<=512 else {throw MapleError.invalid("The sender is too long for an exclusion.")}
        rule.id=ManagedMarkdown.hash(try JSONCodec.string([rule.scope,rule.connector,rule.account,rule.value]))
        try db.execute("INSERT OR IGNORE INTO board_exclusions(id,json) VALUES (?,?)",[rule.id,try JSONCodec.string(rule)])
        return rule
    }
    public func removeBoardExclusion(id:String) throws {
        guard id.count==64,id.allSatisfy({$0.isHexDigit}) else {throw MapleError.invalid("Choose a saved exclusion.")}
        try db.execute("DELETE FROM board_exclusions WHERE id=?",[id])
    }
    func isBoardSourceExcluded(_ event:Event) throws -> Bool {
        for rule in try boardExclusions() {
            if rule.scope=="github" {
                if event.source.connector.lowercased().contains("mail"),let sender=boardSender(event),sender.hasSuffix("@github.com") || sender.hasSuffix("@notifications.github.com") {return true}
            } else if rule.connector==event.source.connector && rule.account==event.source.account {
                if rule.scope=="sender" && boardSender(event)==rule.value {return true}
                if rule.scope=="type" && event.type==rule.value {return true}
            }
        }
        return false
    }
}
