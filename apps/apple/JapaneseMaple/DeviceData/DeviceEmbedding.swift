//
//  DeviceEmbedding.swift
//  JapaneseMaple
//
//  Apple's on-device sentence model, shared by every device that collects data. Items
//  are embedded on the device (free, private) and the vectors are uploaded with them,
//  so the server can rank by meaning without its own model.
//

import Foundation
import NaturalLanguage

/// Apple's on-device sentence embeddings, normalized so a dot product is cosine similarity.
nonisolated enum DeviceEmbedding {
    static let maxChunks = 4
    static let wordsPerChunk = 160

    private static let model = NLEmbedding.sentenceEmbedding(for: .english)
    /// NLEmbedding crashes when two threads use it at once (a search during background
    /// embedding), so every call goes through this lock.
    private static let lock = NSLock()

    static var isAvailable: Bool { model != nil }
    static var dimensions: Int { model?.dimension ?? 0 }

    static func vector(_ text: String) -> [Float]? {
        guard let model else { return nil }
        let raw = lock.withLock { model.vector(for: text) }
        guard let raw, !raw.isEmpty else { return nil }
        let norm = sqrt(raw.reduce(0) { $0 + $1 * $1 })
        guard norm.isFinite, norm > 0 else { return nil }
        return raw.map { Float($0 / norm) }
    }

    /// Overlapping word windows so long emails are searchable past their first lines.
    static func chunks(_ text: String) -> [String] {
        let words = text.split(whereSeparator: \.isWhitespace)
        guard !words.isEmpty else { return [] }
        let step = wordsPerChunk - 30
        return stride(from: 0, to: words.count, by: step).prefix(maxChunks).map {
            words[$0..<min($0 + wordsPerChunk, words.count)].joined(separator: " ")
        }
    }

    /// Vectors for a piece of text: one per chunk.
    static func vectors(for text: String) -> [[Float]] {
        chunks(text).compactMap(vector)
    }

    static func encode(_ vector: [Float]) -> Data {
        vector.withUnsafeBufferPointer { Data(buffer: $0) }
    }

    static func decode(_ data: Data) -> [Float] {
        guard data.count % MemoryLayout<Float>.size == 0 else { return [] }
        return data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
    }

    /// How vectors travel to the server: little-endian float32 values, chunks back to
    /// back, base64. Apple platforms are little-endian, so the raw bytes are already right.
    static func base64(_ vectors: [[Float]]) -> String {
        vectors.reduce(into: Data()) { $0.append(encode($1)) }.base64EncodedString()
    }
}
