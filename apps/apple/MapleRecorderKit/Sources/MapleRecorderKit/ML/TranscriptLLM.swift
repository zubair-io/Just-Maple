#if !os(watchOS)
import Foundation

/// Shared engine for running an LLM over a (possibly long) transcript using
/// map-reduce, so the request always fits the provider's context window.
///
/// Both the auto-summarizer (`Summarizer`) and Ask AI (`PromptRunner`) use this —
/// one chunking/format/collapse implementation, no duplication. When the transcript
/// fits in a single request, `single` is used directly; otherwise `map` runs over
/// each chunk and `reduce` combines the per-chunk outputs.
enum TranscriptLLM {

    struct Prompts {
        /// System prompt used when the whole transcript fits in one request.
        let single: String
        /// System prompt applied to each chunk when the transcript is split.
        let map: String
        /// System prompt that merges/shortens the *per-chunk outputs* (not transcript
        /// text) into a smaller set so they fit before the final reduce. Distinct from
        /// `map`, whose "this is a transcript section" framing is false during collapse.
        let collapse: String
        /// System prompt that combines the per-chunk outputs into the final result.
        let reduce: String
    }

    static func run(
        transcript: [TranscriptSegment],
        speakers: [Speaker],
        provider: LLMProvider,
        service: any LLMService,
        prompts: Prompts,
        additionalContext: String? = nil
    ) async throws -> String {
        let maxChunk = provider.maxChunkCharacters
        let chunks = splitIntoChunks(transcript, speakers: speakers, maxChunkCharacters: maxChunk)

        // Fits in one request — run directly. A single chunk can still exceed
        // `maxChunk` when one segment's text is longer than the budget (splitting
        // never breaks within a segment), so cap it like the reduce/collapse paths do.
        if chunks.count <= 1 {
            let text = formatTranscript(transcript, speakers: speakers)
            return try await service.generate(
                systemPrompt: prompts.single,
                userMessage: withContext(String(text.prefix(maxChunk)), additionalContext)
            )
        }

        // Map: process each chunk independently.
        var partials: [String] = []
        for chunk in chunks {
            // Same guard as above: a lone over-budget segment must not send an
            // oversized message and trip the provider's context limit.
            let text = formatTranscript(chunk, speakers: speakers)
            let out = try await service.generate(
                systemPrompt: prompts.map,
                userMessage: withContext(String(text.prefix(maxChunk)), additionalContext)
            )
            let trimmed = out.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { partials.append(trimmed) }
        }
        guard !partials.isEmpty else { return "" }

        // Collapse the partials until they fit, then reduce into the final output.
        var combined = combine(partials)
        while combined.count > maxChunk && partials.count > 1 {
            partials = try await collapse(partials, service: service, prompt: prompts.collapse, maxChunkCharacters: maxChunk)
            combined = combine(partials)
        }

        return try await service.generate(
            systemPrompt: prompts.reduce,
            userMessage: withContext(String(combined.prefix(maxChunk)), additionalContext)
        )
    }

    // MARK: - Formatting

    static func formatTranscript(_ segments: [TranscriptSegment], speakers: [Speaker]) -> String {
        segments.map { segment in
            let name = speakers.first { $0.id == segment.speakerId }?.displayName ?? segment.speakerId
            return "\(name): \(segment.text)"
        }.joined(separator: "\n")
    }

    // MARK: - Private

    private static func withContext(_ message: String, _ context: String?) -> String {
        guard let context, !context.isEmpty else { return message }
        return message + "\n\nAdditional context: \(context)"
    }

    private static func combine(_ partials: [String]) -> String {
        partials.enumerated()
            .map { "Part \($0.offset + 1):\n\($0.element)" }
            .joined(separator: "\n\n")
    }

    private static func splitIntoChunks(
        _ segments: [TranscriptSegment],
        speakers: [Speaker],
        maxChunkCharacters: Int
    ) -> [[TranscriptSegment]] {
        var chunks: [[TranscriptSegment]] = []
        var current: [TranscriptSegment] = []
        var currentLength = 0

        for segment in segments {
            let name = speakers.first { $0.id == segment.speakerId }?.displayName ?? segment.speakerId
            let segmentLength = name.count + 2 + segment.text.count + 1 // "name: text\n"

            if currentLength + segmentLength > maxChunkCharacters && !current.isEmpty {
                chunks.append(current)
                current = []
                currentLength = 0
            }
            current.append(segment)
            currentLength += segmentLength
        }
        if !current.isEmpty { chunks.append(current) }
        return chunks
    }

    /// Pairwise-combine partial outputs into a shorter list so the combined text
    /// fits within the context window before the final reduce step.
    private static func collapse(
        _ partials: [String],
        service: any LLMService,
        prompt: String,
        maxChunkCharacters: Int
    ) async throws -> [String] {
        var groups: [[String]] = []
        var current: [String] = []
        var currentLength = 0
        for partial in partials {
            if currentLength + partial.count > maxChunkCharacters && !current.isEmpty {
                groups.append(current)
                current = []
                currentLength = 0
            }
            current.append(partial)
            currentLength += partial.count
        }
        if !current.isEmpty { groups.append(current) }

        var collapsed: [String] = []
        for group in groups {
            guard group.count > 1 else {
                collapsed.append(contentsOf: group)
                continue
            }
            let joined = group.joined(separator: "\n\n")
            let merged = try await service.generate(
                systemPrompt: prompt,
                userMessage: String(joined.prefix(maxChunkCharacters))
            )
            let trimmed = merged.trimmingCharacters(in: .whitespacesAndNewlines)
            collapsed.append(trimmed.isEmpty ? group.joined(separator: " ") : trimmed)
        }
        return collapsed
    }
}
#endif
