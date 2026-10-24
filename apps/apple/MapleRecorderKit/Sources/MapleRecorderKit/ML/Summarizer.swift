#if !os(watchOS)
import Foundation

struct SummaryResult: Sendable {
    var title: String
    var tags: [String]
    var summary: String
}

enum Summarizer {
    private static let systemPrompt = """
        You are a concise meeting summarizer. Given a transcript of a recording, produce:\
        \n\nLine 1: A short descriptive title (3-7 words, no quotes, no prefix).\
        \nLine 2: 3-5 comma-separated single-word uppercase tags categorizing the recording (e.g. MEETING, DESIGN, PLANNING, STANDUP, INTERVIEW).\
        \nLine 3+: A brief summary paragraph (2-4 sentences) capturing the key topics discussed, \
        decisions made, and any action items. Do not use bullet points or headers — \
        write a flowing paragraph. Be specific about who said what when relevant.
        """

    private static let chunkSummaryPrompt = """
        You are a concise meeting summarizer. Given a portion of a transcript, write a brief \
        summary paragraph (2-4 sentences) capturing the key topics discussed, decisions made, \
        and any action items. Be specific about who said what when relevant. \
        Output only the summary paragraph, nothing else.
        """

    private static let collapsePrompt = """
        You are a concise meeting summarizer. You are given several partial summaries from \
        sections of the same recording. Merge them into a single shorter summary paragraph \
        that preserves the key topics, decisions made, and action items. Do not add a title \
        or tags. Output only the merged summary paragraph, nothing else.
        """

    private static let combinePrompt = """
        You are a concise meeting summarizer. You are given multiple partial summaries from \
        different sections of the same recording. Combine them into a single cohesive result:\
        \n\nLine 1: A short descriptive title (3-7 words, no quotes, no prefix).\
        \nLine 2: 3-5 comma-separated single-word uppercase tags categorizing the recording (e.g. MEETING, DESIGN, PLANNING, STANDUP, INTERVIEW).\
        \nLine 3+: A brief summary paragraph (2-4 sentences) capturing the key topics discussed, \
        decisions made, and any action items. Do not use bullet points or headers — \
        write a flowing paragraph. Be specific about who said what when relevant.
        """

    static func summarize(
        transcript: [TranscriptSegment],
        speakers: [Speaker],
        provider: LLMProvider
    ) async throws -> SummaryResult {
        guard let service = LLMServiceFactory.service(for: provider) else {
            return SummaryResult(title: "", tags: [], summary: "")
        }
        guard service.isAvailable else { return SummaryResult(title: "", tags: [], summary: "") }
        guard !TranscriptLLM.formatTranscript(transcript, speakers: speakers).isEmpty else {
            return SummaryResult(title: "", tags: [], summary: "")
        }

        // Map-reduce over the transcript (shared with Ask AI) so long meetings fit
        // the provider's context window.
        let response = try await TranscriptLLM.run(
            transcript: transcript,
            speakers: speakers,
            provider: provider,
            service: service,
            prompts: .init(single: systemPrompt, map: chunkSummaryPrompt, collapse: collapsePrompt, reduce: combinePrompt)
        )
        return parseResponse(response)
    }

    // MARK: - Parsing

    private static func parseResponse(_ response: String) -> SummaryResult {
        let trimmed = response.trimmingCharacters(in: .whitespacesAndNewlines)
        let lines = trimmed.components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }

        guard lines.count >= 3 else {
            // Less than 3 lines — treat entire response as summary, no tags
            return SummaryResult(title: lines.first ?? "", tags: [], summary: trimmed)
        }

        let title = lines[0]
        let tags = sanitizeTags(lines[1])
        let summary = lines.dropFirst(2).joined(separator: " ")
        return SummaryResult(title: title, tags: tags, summary: summary)
    }

    /// Turn the model's "tags" line into clean, short, single-word tags. Models
    /// often ignore the format and emit a sentence here; without this guard those
    /// sentences became giant tags. We keep only short single tokens, drop anything
    /// with spaces/sentence text, de-duplicate, and cap the count.
    private static func sanitizeTags(_ line: String) -> [String] {
        let maxTagLength = 24
        let maxTagCount = 5
        var result: [String] = []
        for raw in line.components(separatedBy: CharacterSet(charactersIn: ",#\n")) {
            let tag = raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            guard !tag.isEmpty, tag.count <= maxTagLength else { continue }
            // Single token only: letters/digits/hyphen/&. Rejects sentence fragments.
            guard tag.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" || $0 == "&" }) else { continue }
            if !result.contains(tag) { result.append(tag) }
            if result.count >= maxTagCount { break }
        }
        return result
    }
}
#endif
