#if !os(watchOS)
import FluidAudio
import Foundation

nonisolated enum MapleAudioConverter {
    enum LoadError: LocalizedError {
        case missingFile(URL)
        case emptyFile(URL)

        var errorDescription: String? {
            switch self {
            case .missingFile(let url): "Audio file not found: \(url.lastPathComponent)"
            case .emptyFile(let url): "Audio file is empty: \(url.lastPathComponent)"
            }
        }
    }

    /// Verify the URL points to a readable, non-empty file.
    /// FluidAudio / AVAudioFile will crash with a fatal precondition
    /// (`buffer.frameCapacity != 0`) when handed a zero-length or missing file.
    private static func validate(_ url: URL) throws {
        let fm = FileManager.default
        guard fm.fileExists(atPath: url.path(percentEncoded: false)) else { throw LoadError.missingFile(url) }
        let size = (try? fm.attributesOfItem(atPath: url.path(percentEncoded: false))[.size] as? NSNumber)?.intValue ?? 0
        guard size > 0 else { throw LoadError.emptyFile(url) }
    }

    static func loadAndResample(url: URL) throws -> [Float] {
        try validate(url)
        let converter = AudioConverter()
        return try converter.resampleAudioFile(url)
    }

    /// Concatenate and resample multiple audio chunk files into a single sample buffer
    static func loadAndResampleChunks(urls: [URL]) throws -> [Float] {
        let converter = AudioConverter()
        var allSamples: [Float] = []
        for url in urls {
            try validate(url)
            let samples = try converter.resampleAudioFile(url)
            allSamples.append(contentsOf: samples)
        }
        return allSamples
    }

    /// Mix two sample arrays by addition, clamped to [-1, 1].
    /// If lengths differ, the shorter one is zero-padded.
    static func mixSamples(_ a: [Float], _ b: [Float], levelA: Float = 1.0, levelB: Float = 0.7) -> [Float] {
        let count = max(a.count, b.count)
        var result = [Float](repeating: 0, count: count)
        for i in 0..<count {
            let va = i < a.count ? a[i] * levelA : 0
            let vb = i < b.count ? b[i] * levelB : 0
            result[i] = max(-1.0, min(1.0, va + vb))
        }
        return result
    }
}
#endif
