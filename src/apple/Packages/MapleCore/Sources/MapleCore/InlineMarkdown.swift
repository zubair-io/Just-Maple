import Foundation

/// Works only with the reserved, validated block grammar. Provider text cannot introduce nodes.
public enum InlineMarkdown {
    private struct Block {let fields:[String:Any];let range:Range<String.Index>;let body:Range<String.Index>}
    private static func blocks(_ markdown:String) throws -> [Block] {
        let matches=try ManagedMarkdown.outsideFences(markdown,pattern:#"(?m)^<!-- maple:block (\{[^\n]+\}) -->\r?$"#)
        return try matches.enumerated().map {i,match in
            guard let marker=Range(match.range,in:markdown),let metadata=Range(match.range(at:1),in:markdown),let fields=try JSONSerialization.jsonObject(with:Data(markdown[metadata].utf8)) as? [String:Any] else{throw MapleError.invalid("Invalid request block metadata.")}
            let end=i+1<matches.count ? Range(matches[i+1].range,in:markdown)!.lowerBound:markdown.endIndex
            return Block(fields:fields,range:marker.lowerBound..<end,body:marker.upperBound..<end)
        }
    }
    public static func validateRequest(_ request:InlineMapleRequest,in markdown:String) throws {
        let candidates=try blocks(markdown).filter{$0.fields["id"] as? String==request.requestBlockID}
        guard candidates.count==1 else{throw MapleError.invalid("The request block was moved or removed. Save it before submitting.")}
        let body=String(markdown[candidates[0].body]).trimmingCharacters(in:.whitespacesAndNewlines)
        let prompt=body.hasPrefix("@maple") ? String(body.dropFirst(6)).trimmingCharacters(in:.whitespacesAndNewlines):body
        let supplied=request.text.hasPrefix("@maple") ? String(request.text.dropFirst(6)).trimmingCharacters(in:.whitespacesAndNewlines):request.text.trimmingCharacters(in:.whitespacesAndNewlines)
        guard prompt==supplied,!supplied.isEmpty else{throw MapleError.invalid("The request changed. Save and submit its current text.")}
    }
    public static func applying(_ run:InlineMapleRun,to markdown:String,events:[Event]) throws -> String {
        try validateRequest(run.request,in:markdown)
        let parsed=try blocks(markdown)
        if parsed.contains(where:{$0.fields["runID"] as? String==run.runID && $0.fields["kind"] as? String=="maple-reply"}) {return markdown}
        guard let anchor=parsed.first(where:{$0.fields["id"] as? String==run.requestBlockID}),let response=run.text else{throw MapleError.invalid("Response anchor unavailable.")}
        var reply="\n"+(try ManagedMarkdown.marker(["id":run.replyBlockID,"kind":"maple-reply","runID":run.runID,"requestID":run.request.commandID]))+plain(response)+"\n\n"
        if let coverage=run.coverage {reply += plain(coverage)+"\n\n"}
        for (index,event) in events.enumerated() {
            let title=event.content.components(separatedBy:"\n").first(where:{$0.hasPrefix("Subject: ") || $0.hasPrefix("Title: ")}) ?? "Source"
            let kind=event.source.connector=="gmail" ? "email":event.source.connector=="imessage" ? "message":"source"
            let reference:[String:Any]=["v":1,"kind":kind,"eventID":event.id,"label":String(title.prefix(200))]
            let json=String(decoding:try JSONSerialization.data(withJSONObject:reference,options:.sortedKeys),as:UTF8.self)
            reply += try ManagedMarkdown.marker(["id":run.replyBlockID+"-source-"+String(index)])
            reply += "```maple-ref\n"+json+"\n```\n\n"
        }
        var result=markdown;result.insert(contentsOf:reply,at:anchor.range.upperBound)
        guard result.utf8.count<=256000 else{throw MapleError.invalid("The reply exceeds this note's limit. Keep it in run history or insert it in another note.")}
        return result
    }
    private static func plain(_ value:String)->String {
        value.map { character in
            if "\\`*_{}[]<>()#+-.!|~".contains(character) {return "\\"+String(character)}
            return String(character)
        }.joined()
    }
}
