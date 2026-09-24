import Foundation

extension KnowledgeStore {
    public func context(for eventID: String) throws -> Context {
        guard let event = try event(eventID) else { throw MapleError.invalid("Unknown event \(eventID)") }
        let threads = event.subjects.filter { $0.hasPrefix("thread:imessage:") || $0.hasPrefix("thread:gmail:") }
        // Shared person:self must not mix unrelated conversations into a message's thread history.
        let historySubjects: [String]
        if event.source.connector == "home_assistant" {
            // Shared self is useful for claims, not an entity's observation history.
            historySubjects = event.subjects.filter { $0.hasPrefix("home:") && $0 != "home:self" }
        } else {
            historySubjects = threads.isEmpty ? event.subjects : threads
        }
        let marks = Array(repeating: "?", count: historySubjects.count).joined(separator: ",")
        let recent = try db.rows("""
            SELECT DISTINCT e.json FROM events e JOIN event_subjects s ON e.id=s.event_id
            WHERE s.subject IN (\(marks)) AND e.id<>? AND e.occurred_at<=?
            ORDER BY e.occurred_at DESC, e.id LIMIT 6
            """, historySubjects + [event.id, String(event.occurredAt.timeIntervalSince1970)])
            .map { try JSONCodec.decode(Event.self, from: Data($0["json"]!.utf8)) }
        let state = try state(subjects: event.subjects)
        // Direct provenance joins ensure key state evidence survives a lexical miss.
        var evidence: [Event] = []
        for claim in state.prefix(12) {
            if let source = try self.event(claim.evidenceEventID), !evidence.contains(where: { $0.id == source.id }) {
                evidence.append(source)
            }
        }
        var matches = try search(event.content, limit: 4, subjects: historySubjects)
        if try indexStatus().chunks > 0 {
            matches += try semanticSearch(event.content, limit: 4, before: event.occurredAt, subjects: historySubjects)
        }
        for match in matches where match.id != event.id && match.occurredAt <= event.occurredAt && !evidence.contains(where: { $0.id == match.id }) {
            if evidence.count < 12 { evidence.append(match) }
        }
        return Context(event: excerpt(event, limit: 12_000), currentState: Array(state.prefix(24)),
                       recentEvents: recent.map { excerpt($0, limit: 1_500) },
                       relatedEvidence: evidence.map { excerpt($0, limit: 1_500) }, version: threads.isEmpty ? "context-v2" : "imessage-context-v2",
                       sourceFacts: try sourceFacts(subjects: event.subjects, limit: 12).map { fact in
                         var dated=fact; dated.sourceOccurredAt=try self.event(fact.eventID)?.occurredAt; return dated
                       },
                       world: ReasoningWorldContext(asOf: Date(),
                         activities: Array(try activities().filter{$0.lifecycle == .active}.prefix(30)),
                         tasks: Array(try tasks().filter{!$0.status.terminal}.sorted{$0.updatedAt>$1.updatedAt}.prefix(40)),
                         states: try worldStates().filter{["person:self","home:self"].contains($0.subject) || event.subjects.contains($0.subject)}))
    }

    public func search(_ query: String, limit: Int = 10, subjects: [String]? = nil) throws -> [Event] {
        // Quote token literals: arbitrary incoming text cannot become an FTS query program.
        let terms = query.lowercased().split(whereSeparator: { !$0.isLetter && !$0.isNumber })
            .filter { $0.count > 2 }.prefix(12)
        guard !terms.isEmpty else { return [] }
        let expression = terms.map { "\"\(String($0))\"" }.joined(separator: " OR ")
        var filter = ""
        var args: [String?] = [expression]
        if let subjects {
            guard !subjects.isEmpty else { return [] }
            filter = " AND e.id IN (SELECT event_id FROM event_subjects WHERE subject IN (\(Array(repeating: "?", count: subjects.count).joined(separator: ","))))"
            args += subjects
        }
        args.append(String(max(1, min(limit, 100))))
        return try db.rows("""
            SELECT e.json FROM events_fts JOIN events e ON e.id=events_fts.event_id
            WHERE events_fts MATCH ?\(filter) ORDER BY bm25(events_fts), e.occurred_at DESC LIMIT ?
            """, args).map { try JSONCodec.decode(Event.self, from: Data($0["json"]!.utf8)) }
    }

    static func utf8Excerpt(_ text: String, limit: Int) -> String {
        var result = String.UnicodeScalarView(), count = 0
        for scalar in text.unicodeScalars {
            let bytes = scalar.utf8.count
            guard count + bytes <= limit else { break }
            result.append(scalar); count += bytes
        }
        return String(result)
    }

    private func excerpt(_ event: Event, limit: Int) -> Event {
        Event(id: event.id, type: event.type, source: event.source, occurredAt: event.occurredAt,
              receivedAt: event.receivedAt, subjects: event.subjects,
              content: Self.utf8Excerpt(event.content, limit: limit))
    }
}

extension KnowledgeStore {
    public func auditCommunication(query:String) throws -> [Event] {
        let matches=try search(query,limit:100).filter{["gmail","imessage"].contains($0.source.connector)}
        return Dictionary(grouping:matches,by:{$0.source.connector+"|"+$0.source.account+"|"+$0.source.externalID}).values.compactMap{$0.max{$0.receivedAt<$1.receivedAt}}.sorted{$0.occurredAt<$1.occurredAt}
    }
}
