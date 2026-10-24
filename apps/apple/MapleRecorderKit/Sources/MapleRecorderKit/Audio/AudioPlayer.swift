import AVFoundation
import Foundation
import Observation

@Observable
final class AudioPlayer: NSObject, AVAudioPlayerDelegate, @unchecked Sendable {
    var isPlaying = false
    var currentTime: TimeInterval = 0
    var duration: TimeInterval = 0
    var speed: PlaybackSpeed = .x1
    var playbackRate: Float { speed.rawValue }

    private var players: [(player: AVAudioPlayer, startOffset: TimeInterval, fileDuration: TimeInterval)] = []
    private var currentChunkIndex = 0
    private var timer: Timer?
    private var preloadThreshold: TimeInterval = 5.0

    // System audio track (plays simultaneously with mic track)
    private var systemPlayers: [(player: AVAudioPlayer, startOffset: TimeInterval, fileDuration: TimeInterval)] = []
    private var currentSystemChunkIndex = 0

    /// Load a single audio file
    func load(url: URL) throws {
        try loadChunks(urls: [url])
    }

    /// Load multiple chunks for seamless playback
    func loadChunks(urls: [URL]) throws {
        try loadWithSystemTracks(micURLs: urls, systemURLs: [])
    }

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

    /// Load mic and system audio tracks for simultaneous playback
    func loadWithSystemTracks(micURLs: [URL], systemURLs: [URL]) throws {
        stopTimeUpdates()
        players = []
        systemPlayers = []

        // Load mic chunks
        var micOffset: TimeInterval = 0
        for url in micURLs {
            try Self.validate(url)
            let audioPlayer = try AVAudioPlayer(contentsOf: url)
            audioPlayer.delegate = self
            audioPlayer.enableRate = true
            audioPlayer.prepareToPlay()

            players.append((
                player: audioPlayer,
                startOffset: micOffset,
                fileDuration: audioPlayer.duration
            ))
            micOffset += audioPlayer.duration
        }

        // Load system audio chunks
        var sysOffset: TimeInterval = 0
        for url in systemURLs {
            try Self.validate(url)
            let audioPlayer = try AVAudioPlayer(contentsOf: url)
            audioPlayer.enableRate = true
            audioPlayer.prepareToPlay()

            systemPlayers.append((
                player: audioPlayer,
                startOffset: sysOffset,
                fileDuration: audioPlayer.duration
            ))
            sysOffset += audioPlayer.duration
        }

        // Duration is the max of both track sets
        self.duration = max(micOffset, sysOffset)
        self.currentTime = 0
        self.currentChunkIndex = 0
        self.currentSystemChunkIndex = 0
    }

    func play() {
        guard !players.isEmpty else { return }

        let chunk = players[currentChunkIndex]
        chunk.player.rate = playbackRate
        chunk.player.play()

        // Also play the corresponding system audio chunk
        if !systemPlayers.isEmpty, currentSystemChunkIndex < systemPlayers.count {
            let sysChunk = systemPlayers[currentSystemChunkIndex]
            sysChunk.player.rate = playbackRate
            sysChunk.player.play()
        }

        isPlaying = true
        startTimeUpdates()
    }

    func pause() {
        for entry in players {
            entry.player.pause()
        }
        for entry in systemPlayers {
            entry.player.pause()
        }
        isPlaying = false
        stopTimeUpdates()
    }

    func togglePlayPause() {
        if isPlaying {
            pause()
        } else {
            play()
        }
    }

    func seek(to time: TimeInterval) {
        let clamped = max(0, min(time, duration))

        // Seek mic track
        if let index = chunkIndex(for: clamped, in: players) {
            if index != currentChunkIndex {
                players[currentChunkIndex].player.pause()
            }
            currentChunkIndex = index
            let chunk = players[index]
            let localTime = clamped - chunk.startOffset
            chunk.player.currentTime = localTime

            if isPlaying {
                chunk.player.rate = playbackRate
                chunk.player.play()
            }
        }

        // Seek system track
        if !systemPlayers.isEmpty, let sysIndex = chunkIndex(for: clamped, in: systemPlayers) {
            if sysIndex != currentSystemChunkIndex {
                systemPlayers[currentSystemChunkIndex].player.pause()
            }
            currentSystemChunkIndex = sysIndex
            let sysChunk = systemPlayers[sysIndex]
            let localTime = clamped - sysChunk.startOffset
            sysChunk.player.currentTime = localTime

            if isPlaying {
                sysChunk.player.rate = playbackRate
                sysChunk.player.play()
            }
        }

        currentTime = clamped
    }

    func skipForward(_ seconds: TimeInterval = 15) {
        seek(to: currentTime + seconds)
    }

    func skipBack(_ seconds: TimeInterval = 15) {
        seek(to: currentTime - seconds)
    }

    func cycleSpeed() {
        speed = speed.next()
        if isPlaying {
            players[currentChunkIndex].player.rate = playbackRate
            if !systemPlayers.isEmpty, currentSystemChunkIndex < systemPlayers.count {
                systemPlayers[currentSystemChunkIndex].player.rate = playbackRate
            }
        }
    }

    func setRate(_ rate: Float) {
        // Find the closest PlaybackSpeed or default to x1
        speed = PlaybackSpeed.allCases.first { $0.rawValue == rate } ?? .x1
        if isPlaying {
            players[currentChunkIndex].player.rate = playbackRate
            if !systemPlayers.isEmpty, currentSystemChunkIndex < systemPlayers.count {
                systemPlayers[currentSystemChunkIndex].player.rate = playbackRate
            }
        }
    }

    // MARK: - AVAudioPlayerDelegate

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            self.handleChunkFinished(player)
        }
    }

    private func handleChunkFinished(_ player: AVAudioPlayer) {
        // Check if this is a mic player finishing
        let isMicPlayer = players.contains { $0.player === player }

        if isMicPlayer {
            let nextIndex = currentChunkIndex + 1
            if nextIndex < players.count {
                currentChunkIndex = nextIndex
                let next = players[nextIndex]
                next.player.currentTime = 0
                next.player.rate = playbackRate
                next.player.play()
            }

            // Also advance system track if it finished around the same time
            advanceSystemTrackIfNeeded()
        } else {
            // System player finished — advance to next system chunk
            let nextSysIndex = currentSystemChunkIndex + 1
            if nextSysIndex < systemPlayers.count {
                currentSystemChunkIndex = nextSysIndex
                let next = systemPlayers[nextSysIndex]
                next.player.currentTime = 0
                next.player.rate = playbackRate
                next.player.play()
            }
        }

        // Check if all tracks are done
        let micDone = currentChunkIndex >= players.count - 1
            && (players.last.map { !$0.player.isPlaying } ?? true)
        let sysDone = systemPlayers.isEmpty
            || (currentSystemChunkIndex >= systemPlayers.count - 1
                && (systemPlayers.last.map { !$0.player.isPlaying } ?? true))

        if micDone && sysDone {
            isPlaying = false
            currentTime = duration
            stopTimeUpdates()
        }
    }

    private func advanceSystemTrackIfNeeded() {
        guard !systemPlayers.isEmpty else { return }
        let sysChunk = systemPlayers[currentSystemChunkIndex]
        if !sysChunk.player.isPlaying, currentSystemChunkIndex + 1 < systemPlayers.count {
            currentSystemChunkIndex += 1
            let next = systemPlayers[currentSystemChunkIndex]
            next.player.currentTime = 0
            next.player.rate = playbackRate
            next.player.play()
        }
    }

    // MARK: - Private

    private static func validate(_ url: URL) throws {
        let fm = FileManager.default
        guard fm.fileExists(atPath: url.path(percentEncoded: false)) else { throw LoadError.missingFile(url) }
        let size = (try? fm.attributesOfItem(atPath: url.path(percentEncoded: false))[.size] as? NSNumber)?.intValue ?? 0
        guard size > 0 else { throw LoadError.emptyFile(url) }
    }

    private func chunkIndex(for time: TimeInterval, in entries: [(player: AVAudioPlayer, startOffset: TimeInterval, fileDuration: TimeInterval)]) -> Int? {
        for (i, entry) in entries.enumerated() {
            let chunkEnd = entry.startOffset + entry.fileDuration
            if time < chunkEnd || i == entries.count - 1 {
                return i
            }
        }
        return entries.isEmpty ? nil : 0
    }

    private func startTimeUpdates() {
        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                guard currentChunkIndex < self.players.count else { return }
                let chunk = self.players[self.currentChunkIndex]
                self.currentTime = chunk.startOffset + chunk.player.currentTime

                // Pre-load next chunk check
                let timeLeftInChunk = chunk.fileDuration - chunk.player.currentTime
                if timeLeftInChunk < self.preloadThreshold,
                   self.currentChunkIndex + 1 < self.players.count {
                    self.players[self.currentChunkIndex + 1].player.prepareToPlay()
                }

                // Pre-load next system chunk
                if !self.systemPlayers.isEmpty,
                   self.currentSystemChunkIndex < self.systemPlayers.count {
                    let sysChunk = self.systemPlayers[self.currentSystemChunkIndex]
                    let sysTimeLeft = sysChunk.fileDuration - sysChunk.player.currentTime
                    if sysTimeLeft < self.preloadThreshold,
                       self.currentSystemChunkIndex + 1 < self.systemPlayers.count {
                        self.systemPlayers[self.currentSystemChunkIndex + 1].player.prepareToPlay()
                    }
                }
            }
        }
    }

    private func stopTimeUpdates() {
        timer?.invalidate()
        timer = nil
    }
}
