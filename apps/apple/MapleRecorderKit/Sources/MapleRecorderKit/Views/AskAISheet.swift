#if !os(watchOS)
import SwiftUI

struct AskAISheet: View {
    @Bindable var promptStore: PromptStore
    @Bindable var settingsManager: SettingsManager
    var recording: MapleRecording
    @Bindable var store: RecordingStore

    @State private var selectedSuggestion: SuggestionChip?
    @State private var questionText = ""
    @State private var isRunning = false
    @Environment(\.dismiss) private var dismiss

    private let maxCharacters = 500

    private struct SuggestionChip: Identifiable, Equatable {
        let id: String
        let icon: String
        let label: String
        let promptBody: String
    }

    private var suggestions: [SuggestionChip] {
        var chips: [SuggestionChip] = [
            SuggestionChip(id: "summarize", icon: "text.alignleft", label: "Summarize", promptBody: "Provide a concise summary of this recording, highlighting key points and conclusions."),
            SuggestionChip(id: "trends", icon: "chart.line.uptrend.xyaxis", label: "Analyze Trends", promptBody: "Analyze the main themes and trends discussed in this recording. Identify recurring topics and how they evolved."),
            SuggestionChip(id: "tasks", icon: "checklist", label: "Extract Tasks", promptBody: "Extract all action items and tasks from this transcript. List each with the responsible person and deadline if mentioned."),
            SuggestionChip(id: "speakers", icon: "person.2", label: "Identify Speakers", promptBody: "Analyze the speakers in this recording. For each speaker, describe their role, key contributions, and communication style."),
            SuggestionChip(id: "data", icon: "tablecells", label: "Extract Data", promptBody: "Extract all specific data points, statistics, numbers, dates, and factual claims made in this recording."),
        ]

        // Add user's custom prompts
        for prompt in promptStore.prompts {
            chips.append(SuggestionChip(
                id: prompt.id.uuidString,
                icon: "sparkles",
                label: prompt.name,
                promptBody: prompt.systemPrompt
            ))
        }

        return chips
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    // Provider picker
                    providerSection

                    // Suggestions
                    suggestionsSection

                    // Custom question
                    questionSection

                    // Disclaimer
                    Text("AI responses are generated based on available data and may require verification.")
                        .font(.caption)
                        .foregroundStyle(MapleTheme.textSecondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                }
                .padding()
            }
            .safeAreaInset(edge: .bottom) {
                runButton
                    .padding()
                    .background(MapleTheme.surface)
            }
            .background(MapleTheme.background)
            .navigationTitle("Ask AI")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        #if os(iOS)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        #endif
    }

    // MARK: - Provider Section

    private var providerSection: some View {
        HStack {
            Text("LLM Provider")
                .font(.subheadline)
                .fontWeight(.semibold)
                .foregroundStyle(MapleTheme.textPrimary)

            Spacer()

            Menu {
                Button {
                    settingsManager.preferredProvider = .appleFoundationModels
                } label: {
                    Label("Apple On-Device", systemImage: "iphone")
                }

                Button {
                    settingsManager.preferredProvider = .claude
                } label: {
                    Label("Claude", systemImage: "cloud.fill")
                }

                Button {
                    settingsManager.preferredProvider = .openai
                } label: {
                    Label("OpenAI", systemImage: "cloud.fill")
                }
            } label: {
                ProviderBadge(provider: settingsManager.preferredProvider)
            }
        }
    }

    // MARK: - Suggestions Section

    private var suggestionsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Suggestions")
                .font(.subheadline)
                .fontWeight(.semibold)
                .foregroundStyle(MapleTheme.textPrimary)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(suggestions) { chip in
                        Button {
                            if selectedSuggestion == chip {
                                selectedSuggestion = nil
                            } else {
                                selectedSuggestion = chip
                            }
                        } label: {
                            VStack(spacing: 6) {
                                Image(systemName: chip.icon)
                                    .font(.title3)
                                Text(chip.label)
                                    .font(.caption)
                                    .fontWeight(.medium)
                            }
                            .foregroundStyle(
                                selectedSuggestion == chip
                                    ? MapleTheme.primary
                                    : MapleTheme.textSecondary
                            )
                            .frame(width: 90, height: 70)
                            .background(
                                selectedSuggestion == chip
                                    ? MapleTheme.primaryLight.opacity(0.15)
                                    : MapleTheme.surfaceAlt,
                                in: .rect(cornerRadius: 10)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 10)
                                    .stroke(
                                        selectedSuggestion == chip
                                            ? MapleTheme.primary
                                            : Color.clear,
                                        lineWidth: 1.5
                                    )
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // MARK: - Question Section

    private var questionSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Your Question")
                .font(.subheadline)
                .fontWeight(.semibold)
                .foregroundStyle(MapleTheme.textPrimary)

            ZStack(alignment: .topLeading) {
                TextEditor(text: $questionText)
                    .font(.body)
                    .frame(minHeight: 80, maxHeight: 120)
                    .scrollContentBackground(.hidden)
                    .padding(8)
                    .background(MapleTheme.surfaceAlt, in: .rect(cornerRadius: 10))
                    .onChange(of: questionText) { _, newValue in
                        if newValue.count > maxCharacters {
                            questionText = String(newValue.prefix(maxCharacters))
                        }
                    }

                if questionText.isEmpty {
                    Text("Ask anything about this recording…")
                        .font(.body)
                        .foregroundStyle(MapleTheme.textSecondary.opacity(0.5))
                        .padding(.horizontal, 13)
                        .padding(.vertical, 16)
                        .allowsHitTesting(false)
                }
            }

            HStack {
                Spacer()
                Text("\(questionText.count)/\(maxCharacters)")
                    .font(.caption2)
                    .foregroundStyle(MapleTheme.textSecondary)
            }
        }
    }

    // MARK: - Run Button

    private var runButton: some View {
        Button {
            Task { await runAnalysis() }
        } label: {
            HStack {
                if isRunning {
                    ProgressView()
                        .controlSize(.small)
                        .tint(.white)
                    Text("Running…")
                } else {
                    Image(systemName: "sparkles")
                    Text("Run AI Analysis")
                }
            }
            .font(.headline)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(
                canRun && !isRunning ? MapleTheme.primary : MapleTheme.textSecondary,
                in: .capsule
            )
        }
        .disabled(!canRun || isRunning)
        .buttonStyle(.plain)
    }

    // MARK: - Logic

    private var canRun: Bool {
        selectedSuggestion != nil || !questionText.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private func runAnalysis() async {
        isRunning = true
        defer { isRunning = false }

        let promptBody: String
        let promptName: String

        if let suggestion = selectedSuggestion {
            promptBody = suggestion.promptBody
            promptName = suggestion.label
        } else {
            promptBody = questionText
            promptName = "Custom Question"
        }

        let prompt = CustomPrompt(
            id: UUID(),
            name: promptName,
            systemPrompt: promptBody,
            createdAt: Date()
        )

        let context = questionText.isEmpty ? nil : questionText

        do {
            let result = try await PromptRunner.execute(
                prompt: prompt,
                additionalContext: selectedSuggestion != nil ? context : nil,
                transcript: recording.transcript,
                speakers: recording.speakers,
                provider: settingsManager.preferredProvider
            )
            var updated = recording
            updated.promptResults.append(result)
            try store.update(updated)
            dismiss()
        } catch {
            print("AI analysis failed: \(error)")
        }
    }
}
#endif
