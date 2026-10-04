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
    /// Resolve selection from the saved document, never from a client-supplied prose copy.
    public static func canvasContext(_ request:InlineMapleRequest,in markdown:String) throws -> InlineCanvasContext? {
        try validateRequest(request,in:markdown)
        let parsed=try blocks(markdown)
        guard let anchor=parsed.first(where:{$0.fields["id"] as? String==request.requestBlockID}),let raw=anchor.fields["contextBlockIDs"] else{return nil}
        guard let ids=raw as? [String],!ids.isEmpty,ids.count<=32,Set(ids).count==ids.count,!ids.contains(request.requestBlockID) else {throw MapleError.invalid("Invalid selected-card context.")}
        let selected=try ids.map { id -> InlineCanvasBlock in
            let matches=parsed.filter{$0.fields["id"] as? String==id}
            guard matches.count==1 else {throw MapleError.invalid("A selected card moved or was removed. Select the cards again.")}
            let body=String(markdown[matches[0].body]).trimmingCharacters(in:.whitespacesAndNewlines)
            var eventID:String?
            if body.hasPrefix("```maple-ref\n"),let end=body.range(of:"\n```",range:body.index(body.startIndex,offsetBy:13)..<body.endIndex) {
                let json=String(body[body.index(body.startIndex,offsetBy:13)..<end.lowerBound])
                guard let data=json.data(using:.utf8),let ref=try JSONSerialization.jsonObject(with:data) as? [String:Any],let id=ref["eventID"] as? String else {throw MapleError.invalid("Selected source reference is malformed.")}
                eventID=id
            }
            return InlineCanvasBlock(blockID:id,markdown:body,eventID:eventID)
        }
        let context=InlineCanvasContext(revision:request.expectedRevision,blocks:selected)
        try context.validate()
        return context
    }
    public static func applying(_ run:InlineMapleRun,to markdown:String,events:[Event]) throws -> String {
        try validateRequest(run.request,in:markdown)
        let parsed=try blocks(markdown)
        if parsed.contains(where:{$0.fields["runID"] as? String==run.runID && $0.fields["kind"] as? String=="maple-reply"}) {return markdown}
        guard let anchor=parsed.first(where:{$0.fields["id"] as? String==run.requestBlockID}),let response=run.text else{throw MapleError.invalid("Response anchor unavailable.")}
        // Every paragraph owns a stable identity so a shared editor can insert
        // individual nodes. Provider text is escaped; it cannot create headings,
        // code fences, lists, or reserved Maple nodes.
        var paragraphs=paragraphBodies(response)
        if let coverage=run.coverage {paragraphs += paragraphBodies(coverage)}
        if paragraphs.isEmpty {paragraphs=["<!-- maple:empty -->"]}
        var reply="\n"
        for (index,body) in paragraphs.enumerated() {
            let id=index==0 ? run.replyBlockID:run.replyBlockID+"-paragraph-"+String(index)
            reply += (try ManagedMarkdown.marker(["id":id,"kind":"maple-reply","runID":run.runID,"requestID":run.request.commandID]))+body+"\n\n"
        }
        for (index,event) in events.enumerated() {
            let title=event.content.components(separatedBy:"\n").first(where:{$0.hasPrefix("Subject: ") || $0.hasPrefix("Title: ")}) ?? "Source"
            let kind=ManagedMarkdown.referenceKind(connector:event.source.connector)
            let reference:[String:Any]=["v":1,"kind":kind,"eventID":event.id,"label":String(title.prefix(200))]
            let json=String(decoding:try JSONSerialization.data(withJSONObject:reference,options:.sortedKeys),as:UTF8.self)
            reply += try ManagedMarkdown.marker(["id":run.replyBlockID+"-source-"+String(index)])
            reply += "```maple-ref\n"+json+"\n```\n\n"
        }
        var result=markdown;result.insert(contentsOf:reply,at:anchor.range.upperBound)
        guard result.utf8.count<=256000 else{throw MapleError.invalid("The reply exceeds this note's limit. Keep it in run history or insert it in another note.")}
        return result
    }
    private static func paragraphBodies(_ value:String)->[String] {
        let normalized=value.replacingOccurrences(of:"\r\n",with:"\n").replacingOccurrences(of:"\r",with:"\n")
        var paragraphs:[String]=[],lines:[String]=[]
        for line in normalized.components(separatedBy:"\n") {
            if line.trimmingCharacters(in:.whitespaces).isEmpty {
                if !lines.isEmpty {paragraphs.append(lines.joined(separator:"  \n"));lines=[]}
            } else {
                // Encode indentation as entities so an indented provider line
                // remains literal paragraph text instead of becoming a code node.
                let indent=line.prefix(while:{$0 == " " || $0 == "\t"})
                let prefix=indent.map{$0 == " " ? "&#32;":"&#9;"}.joined()
                lines.append(prefix+plain(String(line.dropFirst(indent.count))))
            }
        }
        if !lines.isEmpty {paragraphs.append(lines.joined(separator:"  \n"))}
        return paragraphs
    }
    private static func plain(_ value:String)->String {
        value.map { character in
            if character == "&" {return "&amp;"}
            if "\\`*_{}[]<>()#+-.!|~".contains(character) {return "\\"+String(character)}
            return String(character)
        }.joined()
    }
}


public struct InlineMapleResponseProposal:Codable,Sendable {
    public let runID:String
    public let documentID:String
    public let revision:String
    public let requestBlockID:String
    public let blocks:[AutomaticTodayProposal.Block]
}

extension TodayDocumentCoordinator {
    public func inlineResponseProposal(runID:String) async throws -> InlineMapleResponseProposal {
        let run=try await store.inlineMapleRun(runID)
        guard run.status == "unapplied" || run.status == "succeeded" else {throw MapleError.invalid("The Maple response is not ready.")}
        let id=run.request.documentID
        try await acquire([id]);defer{renewEditorSession(documentID:id);release([id])}
        let record=try await record(id)
        guard let disk=try await library.readIfPresent(notebookID:record.notebookID,path:record.path) else {throw MapleError.invalid("The managed file is unavailable.")}
        try ManagedMarkdown.validate(disk.content,documentID:id)
        // A durable acceptance receipt also covers a user deleting the reply
        // before its first save. Replayed proposals must respect that decision.
        if run.status == "succeeded" {
            return InlineMapleResponseProposal(runID:runID,documentID:id,revision:disk.revision,requestBlockID:run.requestBlockID,blocks:[])
        }
        var events:[Event]=[]
        for eventID in run.eventIDs {if let event=try await store.event(eventID) {events.append(event)}}
        let content=try InlineMarkdown.applying(run,to:disk.content,events:events)
        let existing=Set(try ManagedMarkdown.segments(disk.content).map(\.id))
        let blocks=try ManagedMarkdown.segments(content).filter{!existing.contains($0.id)}.map{AutomaticTodayProposal.Block(blockID:$0.id,markdown:$0.content)}
        return InlineMapleResponseProposal(runID:runID,documentID:id,revision:disk.revision,requestBlockID:run.requestBlockID,blocks:blocks)
    }
}

extension KnowledgeStore {
    /// A run is acknowledged only when the shared editor's ordinary file commit
    /// has durably saved its reserved reply identity in the intended document.
    func acknowledgeInlineReplies(documentID:String,content:String,revision:String) throws {
        for segment in try ManagedMarkdown.segments(content) {
            guard segment.metadata["kind"] as? String == "maple-reply",
                  let runID=segment.metadata["runID"] as? String,
                  let run=try? inlineMapleRun(runID),run.status == "unapplied",
                  run.request.documentID == documentID,segment.id == run.replyBlockID,
                  segment.metadata["requestID"] as? String == run.request.commandID else {continue}
            _ = try markInlineMapleApplied(run.runID,revision:revision)
        }
    }
}
