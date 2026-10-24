#if !os(watchOS)
import Foundation
import HuggingFace
import MLXLLM
import MLXLMCommon
import Tokenizers

/// Runs S1-mini by Superwhisper locally after ASR, producing a readable transcript
/// without changing the timed transcript used for playback.
final class S1TextNormalizer {
    nonisolated struct Chunk: Equatable, Sendable {
        let speakerName: String
        let text: String
    }

    static let modelID = "mlx-community/S1-mini-MLX-4bit"

    // S1-mini's wording is part of its trained input format and must remain exact.
    static let systemPrompt = "You are a text normalizer for speech-to-text transcripts. The input begins with a control line specifying the styling, structure, and context settings; clean the transcript to match those settings and output only the cleaned text."
    static let controlLine = "[Styling: semi-formal] [Structure: prose] [Context: general]"

    /// A conservative character ceiling keeps English input below the model's
    /// recommended ~1,000-token limit, including its system/control prompt.
    static let maximumChunkCharacters = 3_000

    private var model: ModelContainer?

    var isModelReady: Bool { model != nil }

    func initialize(
        progressHandler: @Sendable @escaping (Double) -> Void = { _ in }
    ) async throws {
        guard model == nil else {
            progressHandler(1)
            return
        }

        model = try await loadModelContainer(
            from: S1HuggingFaceDownloader(),
            using: S1TokenizerLoader(),
            configuration: ModelConfiguration(id: Self.modelID),
            progressHandler: { progress in
                progressHandler(progress.fractionCompleted)
            }
        )
        progressHandler(1)
    }

    func normalize(
        transcript: [TranscriptSegment],
        speakers: [Speaker],
        progressHandler: (Int, Int) -> Void = { _, _ in }
    ) async throws -> String {
        guard !transcript.isEmpty else { return "" }
        let chunks = Self.makeChunks(transcript: transcript, speakers: speakers)
        return try await normalize(
            chunks: chunks,
            includesSpeakerNames: true,
            progressHandler: progressHandler
        )
    }

    /// Cleans arbitrary note text without adding transcript speaker labels.
    func normalize(
        text: String,
        progressHandler: (Int, Int) -> Void = { _, _ in }
    ) async throws -> String {
        let chunks = Self.makeTextChunks(text)
            .map { Chunk(speakerName: "", text: $0) }
        return try await normalize(
            chunks: chunks,
            includesSpeakerNames: false,
            progressHandler: progressHandler
        )
    }

    static func makeTextChunks(
        _ text: String,
        maximumCharacters: Int = maximumChunkCharacters
    ) -> [String] {
        guard maximumCharacters > 0 else { return [] }
        return split(text, maximumCharacters: maximumCharacters)
    }

    private func normalize(
        chunks: [Chunk],
        includesSpeakerNames: Bool,
        progressHandler: (Int, Int) -> Void
    ) async throws -> String {
        guard !chunks.isEmpty else { return "" }
        if model == nil {
            try await initialize()
        }
        guard let model else { throw S1TextNormalizerError.modelNotLoaded }

        var cleanedBlocks: [String] = []
        cleanedBlocks.reserveCapacity(chunks.count)

        for (index, chunk) in chunks.enumerated() {
            progressHandler(index + 1, chunks.count)

            let userMessage = "\(Self.controlLine)\n\(chunk.text)"
            let inputTokenCount = await model.encode(userMessage).count
            let maximumOutputTokens = Int(ceil(Double(inputTokenCount) * 1.3)) + 32
            let session = ChatSession(
                model,
                instructions: Self.systemPrompt,
                generateParameters: GenerateParameters(
                    maxTokens: maximumOutputTokens,
                    temperature: 0
                ),
                additionalContext: ["enable_thinking": false]
            )

            // Empty output is valid when an input chunk contains only filler/noise.
            let cleaned = try await session.respond(to: userMessage)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !cleaned.isEmpty {
                cleanedBlocks.append(
                    includesSpeakerNames ? "\(chunk.speakerName): \(cleaned)" : cleaned
                )
            }
        }

        return cleanedBlocks.joined(separator: "\n\n")
    }

    /// Joins adjacent segments from the same speaker so self-corrections can cross
    /// ASR sentence boundaries, then splits oversized turns on word boundaries.
    static func makeChunks(
        transcript: [TranscriptSegment],
        speakers: [Speaker],
        maximumCharacters: Int = maximumChunkCharacters
    ) -> [Chunk] {
        guard maximumCharacters > 0 else { return [] }
        var speakerNames: [String: String] = [:]
        for speaker in speakers {
            speakerNames[speaker.id] = speaker.displayName
        }
        var chunks: [Chunk] = []

        for segment in transcript {
            let speakerName = speakerNames[segment.speakerId] ?? segment.speakerId
            for piece in split(segment.text, maximumCharacters: maximumCharacters) {
                if let last = chunks.last,
                   last.speakerName == speakerName,
                   last.text.count + 1 + piece.count <= maximumCharacters {
                    chunks[chunks.count - 1] = Chunk(
                        speakerName: speakerName,
                        text: "\(last.text) \(piece)"
                    )
                } else {
                    chunks.append(Chunk(speakerName: speakerName, text: piece))
                }
            }
        }

        return chunks
    }

    private static func split(_ text: String, maximumCharacters: Int) -> [String] {
        let words = text.split(whereSeparator: { $0.isWhitespace })
        var pieces: [String] = []
        var current = ""

        for wordSlice in words {
            let word = String(wordSlice)
            if word.count > maximumCharacters {
                if !current.isEmpty {
                    pieces.append(current)
                    current = ""
                }
                var remaining = word[...]
                while !remaining.isEmpty {
                    let end = remaining.index(
                        remaining.startIndex,
                        offsetBy: min(maximumCharacters, remaining.count)
                    )
                    pieces.append(String(remaining[..<end]))
                    remaining = remaining[end...]
                }
            } else if current.isEmpty {
                current = word
            } else if current.count + 1 + word.count <= maximumCharacters {
                current += " \(word)"
            } else {
                pieces.append(current)
                current = word
            }
        }

        if !current.isEmpty {
            pieces.append(current)
        }
        return pieces
    }
}

enum S1TextNormalizerError: LocalizedError {
    case modelNotLoaded
    case invalidRepositoryID(String)

    var errorDescription: String? {
        switch self {
        case .modelNotLoaded:
            "S1-mini by Superwhisper could not be loaded."
        case .invalidRepositoryID(let id):
            "Invalid S1 model repository ID: \(id)"
        }
    }
}

// MARK: - Hugging Face adapters

/// Small local adapters avoid requiring an executable Swift macro in the app while
/// still using the official Hugging Face downloader and tokenizer packages.
private struct S1HuggingFaceDownloader: MLXLMCommon.Downloader {
    private let client = HuggingFace.HubClient()

    func download(
        id: String,
        revision: String?,
        matching patterns: [String],
        useLatest: Bool,
        progressHandler: @Sendable @escaping (Progress) -> Void
    ) async throws -> URL {
        guard let repositoryID = HuggingFace.Repo.ID(rawValue: id) else {
            throw S1TextNormalizerError.invalidRepositoryID(id)
        }
        return try await client.downloadSnapshot(
            of: repositoryID,
            revision: revision ?? "main",
            matching: patterns,
            progressHandler: { @MainActor progress in
                progressHandler(progress)
            }
        )
    }
}

private struct S1TokenizerLoader: MLXLMCommon.TokenizerLoader {
    func load(from directory: URL) async throws -> any MLXLMCommon.Tokenizer {
        let tokenizer = try await Tokenizers.AutoTokenizer.from(modelFolder: directory)
        return S1TokenizerAdapter(tokenizer)
    }
}

private struct S1TokenizerAdapter: MLXLMCommon.Tokenizer {
    private let tokenizer: any Tokenizers.Tokenizer

    init(_ tokenizer: any Tokenizers.Tokenizer) {
        self.tokenizer = tokenizer
    }

    func encode(text: String, addSpecialTokens: Bool) -> [Int] {
        tokenizer.encode(text: text, addSpecialTokens: addSpecialTokens)
    }

    func decode(tokenIds: [Int], skipSpecialTokens: Bool) -> String {
        tokenizer.decode(tokens: tokenIds, skipSpecialTokens: skipSpecialTokens)
    }

    func convertTokenToId(_ token: String) -> Int? { tokenizer.convertTokenToId(token) }
    func convertIdToToken(_ id: Int) -> String? { tokenizer.convertIdToToken(id) }

    var bosToken: String? { tokenizer.bosToken }
    var eosToken: String? { tokenizer.eosToken }
    var unknownToken: String? { tokenizer.unknownToken }

    func applyChatTemplate(
        messages: [[String: any Sendable]],
        tools: [[String: any Sendable]]?,
        additionalContext: [String: any Sendable]?
    ) throws -> [Int] {
        do {
            return try tokenizer.applyChatTemplate(
                messages: messages,
                tools: tools,
                additionalContext: additionalContext
            )
        } catch Tokenizers.TokenizerError.missingChatTemplate {
            throw MLXLMCommon.TokenizerError.missingChatTemplate
        }
    }
}
#endif
