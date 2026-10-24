import SwiftUI
#if os(macOS)
import AppKit
#elseif os(iOS)
import UIKit
#endif

struct RecordingDetailView: View {
    @Bindable var store: RecordingStore
    let recordingId: UUID
    @State private var player = AudioPlayer()
    @State private var syncEngine = PlaybackSyncEngine()
    @State private var editingSpeaker: Speaker?
    @State private var isLoadingAudio = false
    @State private var audioLoaded = false

    #if !os(watchOS)
    // Section expansion state
    @State private var isSummaryExpanded = true
    @State private var isDetailsExpanded = true
    @State private var isTagsExpanded = true
    @State private var isNotesExpanded = true
    @State private var isPresenterNotesExpanded = true
    @State private var isTimelineExpanded = true
    @State private var isTranscriptExpanded = false
    @State private var isAIInsightsExpanded = true

    // Editing state
    @State private var editableTitle = ""
    @State private var isEditingSummary = false
    @State private var editableSummary = ""
    @State private var isEditingTags = false
    @State private var editableTagsText = ""
    @State private var isEditingNotes = false
    @State private var editableNotes = ""
    @State private var didCopyTranscript = false
    #endif

    #if !os(watchOS)
    var processingPipeline: ProcessingPipeline?
    var settingsManager: SettingsManager?
    var promptStore: PromptStore?
    var autoProcessor: AutoProcessor?
    @State private var showingAskAI = false
    @State private var searchQuery = ""
    #endif

    private var recording: MapleRecording? {
        store.recordings.first { $0.id == recordingId }
    }

    var body: some View {
        if var recording = recording {
            ZStack(alignment: .bottomTrailing) {
                ScrollView {
                    VStack(spacing: 16) {
                        summarySection(recording: recording)
                        detailsSection(recording: recording)
                        tagsSection(recording: recording)
                        notesSection(recording: recording)
                        presenterNotesSection(recording: recording)
                        timelineSection(recording: recording)
                        transcriptSection(recording: recording)
                        #if !os(watchOS)
                        aiInsightsSection(recording: recording)
                        #endif

                        #if !os(watchOS)
                        if recording.transcript.isEmpty, let pipeline = processingPipeline {
                            processingIndicator(pipeline: pipeline)
                        }
                        #endif
                    }
                    .padding()
                }
                .safeAreaInset(edge: .bottom) {
                    if !recording.audioFiles.isEmpty {
                        if isLoadingAudio {
                            HStack(spacing: 8) {
                                ProgressView()
                                    .controlSize(.small)
                                Text("Downloading audio…")
                                    .font(.caption)
                                    .foregroundStyle(MapleTheme.textSecondary)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .background(MapleTheme.surface)
                        } else {
                            PlaybackBar(
                                player: player,
                                onToggle: {
                                    if !audioLoaded {
                                        Task { await loadAudioOnDemand(recording: recording) }
                                        return
                                    }
                                    player.togglePlayPause()
                                    if player.isPlaying {
                                        syncEngine.start(player: player, transcript: recording.transcript)
                                    } else {
                                        syncEngine.stop()
                                    }
                                },
                                onSeek: { time in
                                    player.seek(to: time)
                                }
                            )
                        }
                    }
                }

                #if !os(watchOS)
                // AI FAB
                if !recording.transcript.isEmpty, promptStore != nil, settingsManager != nil {
                    Button {
                        showingAskAI = true
                    } label: {
                        Image(systemName: "sparkles")
                            .font(.title2)
                            .foregroundStyle(.white)
                            .frame(width: 56, height: 56)
                            .background(MapleTheme.primary, in: .circle)
                            .shadow(color: MapleTheme.primary.opacity(0.3), radius: 8, y: 4)
                    }
                    .buttonStyle(.plain)
                    .padding(.trailing, 20)
                    .padding(.bottom, 100)
                }
                #endif
            }
            .background(MapleTheme.background)
            #if os(watchOS)
            .navigationTitle(recording.title)
            #else
            .toolbar {
                ToolbarItem(placement: .principal) {
                    TextField("Title", text: $editableTitle)
                        .font(.headline)
                        .multilineTextAlignment(.center)
                        .onSubmit { commitTitleEdit(recording: recording) }
                }
                if let autoProcessor {
                    ToolbarItem(placement: .primaryAction) {
                        reprocessButton(recording: recording, autoProcessor: autoProcessor)
                    }
                }
            }
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #elseif os(macOS)
            .navigationTitle("")
            #endif
            #endif
            .speakerEditor(
                recording: Binding(
                    get: { recording },
                    set: { recording = $0 }
                ),
                editingSpeaker: $editingSpeaker,
                onSave: { updated in
                    try? store.update(updated)
                }
            )
            #if !os(watchOS)
            .sheet(isPresented: $showingAskAI) {
                if let promptStore, let settingsManager {
                    AskAISheet(
                        promptStore: promptStore,
                        settingsManager: settingsManager,
                        recording: recording,
                        store: store
                    )
                }
            }
            #endif
            #if !os(watchOS)
            .onAppear {
                editableTitle = recording.title
            }
            .onChange(of: recordingId) {
                // On macOS the detail column reuses this view when the selection
                // changes, so the audio player would keep playing the previous
                // recording. Tear it down and load the newly selected recording.
                syncEngine.stop()
                player.pause()
                player.seek(to: 0)
                audioLoaded = false
                isLoadingAudio = false
                if let rec = store.recordings.first(where: { $0.id == recordingId }) {
                    editableTitle = rec.title
                    loadAudioIfLocal(recording: rec)
                }
            }
            .onChange(of: recording.title) { _, newTitle in
                editableTitle = newTitle
            }
            #endif
            .task {
                loadAudioIfLocal(recording: recording)
            }
        } else {
            ContentUnavailableView(
                "Recording Not Found",
                systemImage: "waveform",
                description: Text("This recording may have been deleted.")
            )
        }
    }

    // MARK: - Clean Notes Section

    @ViewBuilder
    private func notesSection(recording: MapleRecording) -> some View {
        #if os(watchOS)
        if !recording.notes.isEmpty || !recording.transcript.isEmpty {
            watchSection(title: "Notes") {
                Text(recording.notes.isEmpty ? "No spoken content." : recording.notes)
                    .font(.body)
                    .foregroundStyle(MapleTheme.textPrimary)
            }
        }
        #else
        if !recording.notes.isEmpty || !recording.transcript.isEmpty {
            DisclosureGroup(isExpanded: $isNotesExpanded) {
                Text(recording.notes.isEmpty ? "No spoken content." : recording.notes)
                    .font(.body)
                    .foregroundStyle(recording.notes.isEmpty ? MapleTheme.textSecondary : MapleTheme.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            } label: {
                HStack(spacing: 6) {
                    Text("Notes")
                        .font(.subheadline)
                        .fontWeight(.bold)
                        .foregroundStyle(MapleTheme.primary)
                    Text("S1-cleaned")
                        .font(.caption)
                        .foregroundStyle(MapleTheme.textSecondary)
                }
            }
            .disclosureGroupStyle(MapleSectionStyle())
        }
        #endif
    }

    // MARK: - Presenter Notes Section

    @ViewBuilder
    private func presenterNotesSection(recording: MapleRecording) -> some View {
        #if os(watchOS)
        if !recording.userNotes.isEmpty {
            watchSection(title: "Presenter Notes") {
                Text(recording.userNotes)
                    .font(.body)
                    .foregroundStyle(MapleTheme.textPrimary)
            }
        }
        #else
        if !recording.userNotes.isEmpty || isEditingNotes {
            DisclosureGroup(isExpanded: $isPresenterNotesExpanded) {
                if isEditingNotes {
                    VStack(alignment: .trailing, spacing: 8) {
                        TextEditor(text: $editableNotes)
                            .font(.body)
                            .foregroundStyle(MapleTheme.textPrimary)
                            .frame(minHeight: 100)
                            .scrollContentBackground(.hidden)

                        HStack(spacing: 12) {
                            Button("Cancel") { isEditingNotes = false }
                                .foregroundStyle(MapleTheme.textSecondary)
                            Button("Save") { commitNotesEdit(recording: recording) }
                                .foregroundStyle(MapleTheme.primary)
                                .fontWeight(.semibold)
                        }
                    }
                } else {
                    Text(recording.userNotes)
                        .font(.body)
                        .foregroundStyle(MapleTheme.textPrimary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                        .contentShape(Rectangle())
                        .contextMenu {
                            Button("Edit Notes") {
                                editableNotes = recording.userNotes
                                isEditingNotes = true
                            }
                        }
                }
            } label: {
                Text("Presenter Notes")
                    .font(.subheadline)
                    .fontWeight(.bold)
                    .foregroundStyle(MapleTheme.primary)
            }
            .disclosureGroupStyle(MapleSectionStyle())
        }
        #endif
    }

    // MARK: - Visual Timeline Section

    @ViewBuilder
    private func timelineSection(recording: MapleRecording) -> some View {
        #if os(watchOS)
        if !recording.screenshots.isEmpty {
            watchSection(title: "Timeline") {
                Text("\(recording.screenshots.count) visual moments — view on iPhone or Mac.")
                    .font(.body)
                    .foregroundStyle(MapleTheme.textSecondary)
            }
        }
        #else
        if !recording.screenshots.isEmpty {
            DisclosureGroup(isExpanded: $isTimelineExpanded) {
                LazyVStack(spacing: 12) {
                    ForEach(recording.screenshots.sorted(by: { $0.timestamp < $1.timestamp })) { screenshot in
                        HStack(alignment: .top, spacing: 12) {
                            VStack(spacing: 0) {
                                Circle()
                                    .fill(MapleTheme.primary)
                                    .frame(width: 9, height: 9)
                                Rectangle()
                                    .fill(MapleTheme.border.opacity(0.45))
                                    .frame(width: 1)
                            }
                            .frame(maxHeight: .infinity)
                            .frame(width: 10)

                            VStack(alignment: .leading, spacing: 6) {
                                Button {
                                    seek(to: screenshot.timestamp, in: recording)
                                } label: {
                                    Label(
                                        MarkdownSerializer.formattedTimestamp(screenshot.timestamp),
                                        systemImage: "play.circle.fill"
                                    )
                                    .font(.system(.caption, design: .monospaced, weight: .semibold))
                                    .foregroundStyle(MapleTheme.primary)
                                }
                                .buttonStyle(.plain)
                                .help("Play from this moment")

                                RecordingTimelineImage(fileName: screenshot.fileName)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
            } label: {
                HStack(spacing: 6) {
                    Text("Timeline")
                        .font(.subheadline)
                        .fontWeight(.bold)
                        .foregroundStyle(MapleTheme.primary)
                    Text("\(recording.screenshots.count) moments")
                        .font(.caption)
                        .foregroundStyle(MapleTheme.textSecondary)
                }
            }
            .disclosureGroupStyle(MapleSectionStyle())
        }
        #endif
    }

    // MARK: - Summary Section

    @ViewBuilder
    private func summarySection(recording: MapleRecording) -> some View {
        #if os(watchOS)
        if !recording.summary.isEmpty {
            watchSection(title: "Summary") {
                Text(recording.summary)
                    .font(.body)
                    .foregroundStyle(MapleTheme.textPrimary)
            }
        }
        #else
        if !recording.summary.isEmpty || isEditingSummary {
            DisclosureGroup(isExpanded: $isSummaryExpanded) {
                if isEditingSummary {
                    VStack(alignment: .trailing, spacing: 8) {
                        TextEditor(text: $editableSummary)
                            .font(.body)
                            .foregroundStyle(MapleTheme.textPrimary)
                            .frame(minHeight: 80)
                            .scrollContentBackground(.hidden)

                        HStack(spacing: 12) {
                            Button("Cancel") {
                                isEditingSummary = false
                            }
                            .foregroundStyle(MapleTheme.textSecondary)

                            Button("Save") {
                                commitSummaryEdit(recording: recording)
                            }
                            .foregroundStyle(MapleTheme.primary)
                            .fontWeight(.semibold)
                        }
                    }
                } else {
                    Text(recording.summary)
                        .font(.body)
                        .foregroundStyle(MapleTheme.textPrimary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                        .contextMenu {
                            Button("Edit Summary") {
                                editableSummary = recording.summary
                                isEditingSummary = true
                            }
                        }
                }
            } label: {
                Text("Summary")
                    .font(.subheadline)
                    .fontWeight(.bold)
                    .foregroundStyle(MapleTheme.primary)
            }
            .disclosureGroupStyle(MapleSectionStyle())
        }
        #endif
    }

    // MARK: - Details Section

    @ViewBuilder
    private func detailsSection(recording: MapleRecording) -> some View {
        #if os(watchOS)
        watchSection(title: "Details") {
            VStack(alignment: .leading, spacing: 6) {
                detailRow(icon: "calendar", label: "Date", value: MarkdownSerializer.formattedDate(recording.createdAt))
                detailRow(icon: "clock", label: "Duration", value: MarkdownSerializer.formattedDuration(recording.duration))
                detailRow(icon: "person.2", label: "Speakers", value: "\(recording.speakers.count)")
            }
        }
        #else
        DisclosureGroup(isExpanded: $isDetailsExpanded) {
            VStack(alignment: .leading, spacing: 8) {
                detailRow(icon: "calendar", label: "Date", value: MarkdownSerializer.formattedDate(recording.createdAt))
                detailRow(icon: "clock", label: "Duration", value: MarkdownSerializer.formattedDuration(recording.duration))
                detailRow(icon: "person.2", label: "Speakers", value: "\(recording.speakers.count)")
            }
        } label: {
            Text("Details")
                .font(.subheadline)
                .fontWeight(.bold)
                .foregroundStyle(MapleTheme.primary)
        }
        .disclosureGroupStyle(MapleSectionStyle())
        #endif
    }

    private func detailRow(icon: String, label: String, value: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .foregroundStyle(MapleTheme.textSecondary)
                .frame(width: 20)
            Text(label)
                .font(.subheadline)
                .foregroundStyle(MapleTheme.textSecondary)
            Spacer()
            Text(value)
                .font(.subheadline)
                .foregroundStyle(MapleTheme.textPrimary)
        }
    }

    // MARK: - Tags Section

    @ViewBuilder
    private func tagsSection(recording: MapleRecording) -> some View {
        #if os(watchOS)
        if !recording.tags.isEmpty {
            watchSection(title: "Tags") {
                FlowLayout(spacing: 6) {
                    ForEach(recording.tags, id: \.self) { tag in
                        TagPill(tag: tag)
                    }
                }
            }
        }
        #else
        if !recording.tags.isEmpty || isEditingTags {
            DisclosureGroup(isExpanded: $isTagsExpanded) {
                if isEditingTags {
                    VStack(alignment: .trailing, spacing: 8) {
                        TextField("#tag1 #tag2 #tag3", text: $editableTagsText)
                            .font(.body)
                            .textFieldStyle(.plain)

                        HStack(spacing: 12) {
                            Button("Cancel") {
                                isEditingTags = false
                            }
                            .foregroundStyle(MapleTheme.textSecondary)

                            Button("Save") {
                                commitTagsEdit(recording: recording)
                            }
                            .foregroundStyle(MapleTheme.primary)
                            .fontWeight(.semibold)
                        }
                    }
                } else {
                    FlowLayout(spacing: 6) {
                        ForEach(recording.tags, id: \.self) { tag in
                            TagPill(tag: tag)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                    .contextMenu {
                        Button("Edit Tags") {
                            editableTagsText = recording.tags.map { "#\($0)" }.joined(separator: " ")
                            isEditingTags = true
                        }
                    }
                }
            } label: {
                Text("Tags")
                    .font(.subheadline)
                    .fontWeight(.bold)
                    .foregroundStyle(MapleTheme.primary)
            }
            .disclosureGroupStyle(MapleSectionStyle())
        }
        #endif
    }

    // MARK: - Transcript Section

    @ViewBuilder
    private func transcriptSection(recording: MapleRecording) -> some View {
        #if os(watchOS)
        if !recording.transcript.isEmpty {
            watchSection(title: "Transcript") {
                Text("\(recording.transcript.count) segments — process on iPhone to view.")
                    .font(.body)
                    .foregroundStyle(MapleTheme.textSecondary)
                    .italic()
            }
        }
        #else
        if !recording.transcript.isEmpty {
            DisclosureGroup(isExpanded: $isTranscriptExpanded) {
                VStack(spacing: 0) {
                    // Search bar
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass")
                            .foregroundStyle(MapleTheme.textSecondary)
                        TextField("Search transcript…", text: $searchQuery)
                            .font(.subheadline)
                        if !searchQuery.isEmpty {
                            Button {
                                searchQuery = ""
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .foregroundStyle(MapleTheme.textSecondary)
                            }
                            .buttonStyle(.plain)
                        }

                        Divider()
                            .frame(height: 16)

                        Button {
                            copyTranscript(recording)
                        } label: {
                            Image(systemName: didCopyTranscript ? "checkmark" : "doc.on.doc")
                                .foregroundStyle(didCopyTranscript ? MapleTheme.primary : MapleTheme.textSecondary)
                        }
                        .buttonStyle(.plain)
                        .help("Copy transcript")
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(MapleTheme.surfaceAlt, in: .rect(cornerRadius: 10))
                    .padding(.bottom, 8)

                    TranscriptView(
                        transcript: recording.transcript,
                        speakers: recording.speakers,
                        syncEngine: syncEngine,
                        searchQuery: searchQuery,
                        onSeekToWord: { word in
                            player.seek(to: word.start)
                        },
                        onRenameSpeaker: { speaker in
                            editingSpeaker = speaker
                        }
                    )
                }
            } label: {
                HStack {
                    Text("Transcript")
                        .font(.subheadline)
                        .fontWeight(.bold)
                        .foregroundStyle(MapleTheme.primary)
                    Text("\(recording.transcript.count) segments")
                        .font(.caption)
                        .foregroundStyle(MapleTheme.textSecondary)
                }
            }
            .disclosureGroupStyle(MapleSectionStyle())
        }
        #endif
    }

    #if !os(watchOS)
    /// Copies the transcript as plain "Speaker: text" lines to the clipboard.
    private func copyTranscript(_ recording: MapleRecording) {
        let text = TranscriptLLM.formatTranscript(recording.transcript, speakers: recording.speakers)
        guard !text.isEmpty else { return }
        #if os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #elseif os(iOS)
        UIPasteboard.general.string = text
        #endif
        didCopyTranscript = true
        Task {
            try? await Task.sleep(for: .seconds(1.5))
            didCopyTranscript = false
        }
    }
    #endif

    // MARK: - watchOS Section Helper

    #if os(watchOS)
    private func watchSection<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.subheadline)
                .fontWeight(.bold)
                .foregroundStyle(MapleTheme.primary)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(MapleTheme.surface, in: .rect(cornerRadius: 12))
    }
    #endif

    // MARK: - AI Insights Section

    #if !os(watchOS)
    @ViewBuilder
    private func aiInsightsSection(recording: MapleRecording) -> some View {
        if !recording.promptResults.isEmpty {
            DisclosureGroup(isExpanded: $isAIInsightsExpanded) {
                VStack(spacing: 12) {
                    ForEach(recording.promptResults) { result in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text(result.promptName)
                                    .font(.headline)
                                    .foregroundStyle(MapleTheme.textPrimary)
                                Spacer()
                                ProviderBadge(provider: result.llmProvider)
                                Button {
                                    var updated = recording
                                    updated.promptResults.removeAll { $0.id == result.id }
                                    try? store.update(updated)
                                } label: {
                                    Image(systemName: "trash")
                                        .font(.caption)
                                        .foregroundStyle(MapleTheme.textSecondary)
                                }
                                .buttonStyle(.plain)
                            }

                            Text(result.result)
                                .font(.body)
                                .foregroundStyle(MapleTheme.textPrimary)
                        }
                        .padding()
                        .background(MapleTheme.surfaceAlt, in: .rect(cornerRadius: 10))
                    }
                }
            } label: {
                Text("AI Insights")
                    .font(.subheadline)
                    .fontWeight(.bold)
                    .foregroundStyle(MapleTheme.primary)
            }
            .disclosureGroupStyle(MapleSectionStyle())
        }
    }
    #endif

    // MARK: - Subviews

    #if !os(watchOS)
    @ViewBuilder
    private func reprocessButton(recording: MapleRecording, autoProcessor: AutoProcessor) -> some View {
        let isProcessing = autoProcessor.processingIds.contains(recording.id)
        Button {
            Task { await autoProcessor.reprocess(recording) }
        } label: {
            if isProcessing {
                ProgressView()
                    .controlSize(.small)
            } else {
                Label(
                    recording.transcript.isEmpty ? "Process" : "Reprocess",
                    systemImage: "arrow.clockwise"
                )
            }
        }
        .disabled(isProcessing || recording.audioFiles.isEmpty)
    }

    @ViewBuilder
    private func processingIndicator(pipeline: ProcessingPipeline) -> some View {
        VStack(spacing: 8) {
            ProgressView()
                .controlSize(.regular)
            Text(pipeline.progress)
                .font(.subheadline)
                .foregroundStyle(MapleTheme.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.vertical, 20)
    }
    #endif

    // MARK: - Editing

    #if !os(watchOS)
    private func commitTitleEdit(recording: MapleRecording) {
        let trimmed = editableTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed != recording.title else {
            editableTitle = recording.title
            return
        }
        var updated = recording
        updated.title = trimmed
        updated.modifiedAt = Date()
        try? store.update(updated)
    }

    private func commitSummaryEdit(recording: MapleRecording) {
        let trimmed = editableSummary.trimmingCharacters(in: .whitespacesAndNewlines)
        var updated = recording
        updated.summary = trimmed
        updated.modifiedAt = Date()
        try? store.update(updated)
        isEditingSummary = false
    }

    private func commitTagsEdit(recording: MapleRecording) {
        let parsed = editableTagsText
            .components(separatedBy: .whitespaces)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .map { $0.hasPrefix("#") ? String($0.dropFirst()) : $0 }
            .filter { !$0.isEmpty }
        var updated = recording
        updated.tags = parsed
        updated.modifiedAt = Date()
        try? store.update(updated)
        isEditingTags = false
    }

    private func commitNotesEdit(recording: MapleRecording) {
        var updated = recording
        updated.userNotes = editableNotes.trimmingCharacters(in: .whitespacesAndNewlines)
        updated.modifiedAt = Date()
        try? store.update(updated)
        isEditingNotes = false
    }

    private func seek(to timestamp: TimeInterval, in recording: MapleRecording) {
        if audioLoaded {
            player.seek(to: timestamp)
            if !player.isPlaying { player.play() }
            syncEngine.start(player: player, transcript: recording.transcript)
        } else {
            Task {
                await loadAudioOnDemand(recording: recording)
                player.seek(to: timestamp)
            }
        }
    }
    #endif

    // MARK: - Audio

    /// Eagerly load the recording's audio if all files are already downloaded
    /// locally (otherwise playback loads on demand). Shared by initial appearance
    /// and switching recordings.
    private func loadAudioIfLocal(recording: MapleRecording) {
        let micURLs = recording.audioFiles.map { StorageLocation.recordingsURL.appendingPathComponent($0) }
        let systemURLs = recording.systemAudioFiles.map { StorageLocation.recordingsURL.appendingPathComponent($0) }
        let allLocal = (micURLs + systemURLs).allSatisfy { ICloudFileDownloader.isDownloaded(url: $0) }
        if allLocal && !micURLs.isEmpty {
            loadAudioSync(recording: recording)
        }
    }

    private func loadAudioSync(recording: MapleRecording) {
        let micURLs = recording.audioFiles.map { StorageLocation.recordingsURL.appendingPathComponent($0) }
        let systemURLs = recording.systemAudioFiles.map { StorageLocation.recordingsURL.appendingPathComponent($0) }

        do {
            if systemURLs.isEmpty {
                if micURLs.count == 1 {
                    try player.load(url: micURLs[0])
                } else if micURLs.count > 1 {
                    try player.loadChunks(urls: micURLs)
                }
            } else {
                try player.loadWithSystemTracks(micURLs: micURLs, systemURLs: systemURLs)
            }
            audioLoaded = true
        } catch {
            print("Failed to load audio: \(error.localizedDescription)")
            audioLoaded = false
        }
    }

    private func loadAudioOnDemand(recording: MapleRecording) async {
        let micURLs = recording.audioFiles.map { StorageLocation.recordingsURL.appendingPathComponent($0) }
        let systemURLs = recording.systemAudioFiles.map { StorageLocation.recordingsURL.appendingPathComponent($0) }
        let allURLs = micURLs + systemURLs
        guard !micURLs.isEmpty else { return }

        isLoadingAudio = true
        defer { isLoadingAudio = false }

        do {
            try await ICloudFileDownloader.ensureAllDownloaded(urls: allURLs)
        } catch {
            print("Failed to download audio from iCloud: \(error)")
            return
        }

        loadAudioSync(recording: recording)
        player.play()
        syncEngine.start(player: player, transcript: recording.transcript)
    }
}

#if !os(watchOS)
private struct RecordingTimelineImage: View {
    let fileName: String
    @State private var image: PlatformTimelineImage?
    @State private var failed = false

    var body: some View {
        Group {
            if let image {
                #if os(macOS)
                Image(nsImage: image)
                    .resizable()
                #else
                Image(uiImage: image)
                    .resizable()
                #endif
            } else if failed {
                ContentUnavailableView("Image unavailable", systemImage: "photo")
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, minHeight: 120)
            }
        }
        .scaledToFit()
        .frame(maxWidth: 720)
        .background(MapleTheme.surfaceAlt, in: .rect(cornerRadius: 10))
        .clipShape(.rect(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(MapleTheme.border.opacity(0.3), lineWidth: 1)
        )
        .task(id: fileName) {
            await loadImage()
        }
    }

    private func loadImage() async {
        let url = StorageLocation.recordingsURL.appendingPathComponent(fileName)
        do {
            try await ICloudFileDownloader.ensureDownloaded(url: url)
            let data = try Data(contentsOf: url)
            #if os(macOS)
            image = NSImage(data: data)
            #else
            image = UIImage(data: data)
            #endif
            failed = image == nil
        } catch {
            failed = true
        }
    }
}

#if os(macOS)
private typealias PlatformTimelineImage = NSImage
#else
private typealias PlatformTimelineImage = UIImage
#endif
#endif

// MARK: - Maple Section Style

#if !os(watchOS)
struct MapleSectionStyle: DisclosureGroupStyle {
    func makeBody(configuration: Configuration) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.25)) {
                    configuration.isExpanded.toggle()
                }
            } label: {
                HStack {
                    configuration.label
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(MapleTheme.textSecondary)
                        .rotationEffect(.degrees(configuration.isExpanded ? 90 : 0))
                        .animation(.easeInOut(duration: 0.25), value: configuration.isExpanded)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .buttonStyle(.plain)

            if configuration.isExpanded {
                configuration.content
                    .padding(.horizontal, 16)
                    .padding(.bottom, 12)
            }
        }
        .background(MapleTheme.surface, in: .rect(cornerRadius: 12))
    }
}
#endif
