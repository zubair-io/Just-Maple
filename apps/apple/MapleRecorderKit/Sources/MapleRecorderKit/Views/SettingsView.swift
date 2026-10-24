#if !os(watchOS)
import EventKit
import SwiftUI

struct SettingsView: View {
    @Bindable var settingsManager: SettingsManager
    @Bindable var promptStore: PromptStore
    var calendarManager: CalendarManager?
    @State private var claudeKey: String = ""
    @State private var openAIKey: String = ""
    @State private var showingAddPrompt = false
    @State private var newPromptName = ""
    @State private var newPromptBody = ""
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    summarizerSection
                    transcriptCleanupSection
                    assistSection
                    apiKeysSection
                    recordingSection
                    calendarSection
                    promptsSection
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
            }
            .background(MapleTheme.background)
            .navigationTitle("Settings")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .onAppear {
                claudeKey = settingsManager.claudeAPIKey
                openAIKey = settingsManager.openAIAPIKey
            }
            .alert("New Prompt", isPresented: $showingAddPrompt) {
                TextField("Prompt name", text: $newPromptName)
                TextField("System prompt", text: $newPromptBody)
                Button("Cancel", role: .cancel) {
                    newPromptName = ""
                    newPromptBody = ""
                }
                Button("Add") {
                    let prompt = CustomPrompt(
                        id: UUID(),
                        name: newPromptName,
                        systemPrompt: newPromptBody,
                        createdAt: Date()
                    )
                    try? promptStore.add(prompt)
                    newPromptName = ""
                    newPromptBody = ""
                }
            } message: {
                Text("Enter a name and system prompt for your custom prompt.")
            }
        }
    }

    // MARK: - Transcript Cleanup

    private var transcriptCleanupSection: some View {
        SettingsCard {
            SettingsSectionHeader(icon: "text.badge.checkmark", title: "Transcript Cleanup")

            Text("S1-mini by Superwhisper turns an English raw transcript into clean, readable Notes after each recording.")
                .font(.caption)
                .foregroundStyle(MapleTheme.textSecondary)

            Label {
                Text("Runs entirely on-device after the model is downloaded.")
                    .font(.caption2)
            } icon: {
                Image(systemName: "lock.shield.fill")
            }
            .foregroundStyle(MapleTheme.success)
        }
    }

    // MARK: - Live Assist

    private var assistSection: some View {
        SettingsCard {
            SettingsSectionHeader(icon: "sparkles.rectangle.stack", title: "Live Assist")

            Text("Assist starts on while recording and drafts a new Q&A response when the five-second sampler finds a meaningful screen change. This prompt controls its response style.")
                .font(.caption)
                .foregroundStyle(MapleTheme.textSecondary)

            TextEditor(text: $settingsManager.assistPrompt)
                .font(.body)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 110)
                .padding(8)
                .background(MapleTheme.surfaceAlt, in: .rect(cornerRadius: 8))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(MapleTheme.border.opacity(0.25), lineWidth: 1)
                )

            if settingsManager.preferredProvider == .claude || settingsManager.preferredProvider == .openai {
                Toggle(isOn: $settingsManager.shareAssistScreenshotsWithCloudAI) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Share current screenshot with cloud AI")
                        Text("While Assist is on, sends only meaningful changes from the focused presentation window.")
                            .font(.caption2)
                            .foregroundStyle(MapleTheme.textSecondary)
                    }
                }
                .toggleStyle(.switch)
            }

            HStack(alignment: .top) {
                Label(assistPrivacyMessage, systemImage: assistPrivacyIcon)
                .font(.caption2)
                .foregroundStyle(MapleTheme.textSecondary)

                Spacer()

                Button("Reset") {
                    settingsManager.assistPrompt = AppSettings.defaultAssistPrompt
                }
                .font(.caption)
                .buttonStyle(.plain)
                .foregroundStyle(MapleTheme.primary)
            }
        }
    }

    private var assistPrivacyIcon: String {
        switch settingsManager.preferredProvider {
        case .appleFoundationModels: "lock.shield"
        case .claude, .openai: "cloud"
        case .none: "xmark.circle"
        }
    }

    private var assistPrivacyMessage: String {
        switch settingsManager.preferredProvider {
        case .appleFoundationModels:
            "Screen text is read locally; screen text and notes stay on this device."
        case .claude, .openai:
            if settingsManager.shareAssistScreenshotsWithCloudAI {
                "While recording, changed screenshots, extracted text, and notes are sent to \(settingsManager.preferredProvider.displayName) while Assist is on."
            } else {
                "While recording, extracted screen text and notes are sent to \(settingsManager.preferredProvider.displayName) while Assist is on; screenshots stay local."
            }
        case .none:
            "Choose an AI provider above to enable Assist."
        }
    }

    // MARK: - Summarizer

    private var summarizerSection: some View {
        SettingsCard {
            SettingsSectionHeader(icon: "brain", title: "Summarization")

            Picker(selection: $settingsManager.preferredProvider) {
                Label("Apple On-Device", systemImage: "apple.logo")
                    .tag(LLMProvider.appleFoundationModels)
                Label("Claude", systemImage: "cloud")
                    .tag(LLMProvider.claude)
                Label("OpenAI", systemImage: "cloud")
                    .tag(LLMProvider.openai)
                Label("Off", systemImage: "xmark.circle")
                    .tag(LLMProvider.none)
            } label: {
                Text("Provider")
            }
            .pickerStyle(.menu)

            if settingsManager.preferredProvider == .appleFoundationModels {
                Label {
                    Text("Runs entirely on-device — audio and text never leave your device.")
                        .font(.caption)
                } icon: {
                    Image(systemName: "lock.shield.fill")
                }
                .foregroundStyle(MapleTheme.success)
                .padding(.top, 2)
            }
        }
    }

    // MARK: - API Keys

    @ViewBuilder
    private var apiKeysSection: some View {
        if settingsManager.preferredProvider == .claude || settingsManager.preferredProvider == .openai {
            SettingsCard {
                SettingsSectionHeader(icon: "key", title: "API Keys")

                if settingsManager.preferredProvider == .claude {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Claude API Key")
                            .font(.caption)
                            .foregroundStyle(MapleTheme.textSecondary)
                        SecureField("sk-ant-...", text: $claudeKey)
                            .textFieldStyle(.roundedBorder)
                            .textContentType(.password)
                            .autocorrectionDisabled()
                            .onChange(of: claudeKey) { _, newValue in
                                settingsManager.claudeAPIKey = newValue
                            }
                    }
                }

                if settingsManager.preferredProvider == .openai {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("OpenAI API Key")
                            .font(.caption)
                            .foregroundStyle(MapleTheme.textSecondary)
                        SecureField("sk-...", text: $openAIKey)
                            .textFieldStyle(.roundedBorder)
                            .textContentType(.password)
                            .autocorrectionDisabled()
                            .onChange(of: openAIKey) { _, newValue in
                                settingsManager.openAIAPIKey = newValue
                            }
                    }
                }

                Text("Stored in your device's Keychain. Never synced to iCloud.")
                    .font(.caption2)
                    .foregroundStyle(MapleTheme.textSecondary)
                    .padding(.top, 2)
            }
        }
    }

    // MARK: - Recording

    private var recordingSection: some View {
        SettingsCard {
            SettingsSectionHeader(icon: "mic", title: "Recording")

            Text("Audio is captured at 48 kHz / 128 kbps AAC.")
                .font(.caption)
                .foregroundStyle(MapleTheme.textSecondary)

            #if os(macOS)
            Text("Maple leaves the Dock while recording. Share a specific presentation window to keep the separate notes panel private; full-display sharing can include any visible window.")
                .font(.caption2)
                .foregroundStyle(MapleTheme.textSecondary)
            #endif
        }
    }

    // MARK: - Calendar

    private var calendarSection: some View {
        SettingsCard {
            SettingsSectionHeader(icon: "calendar", title: "Calendar")

            if let calendarManager {
                calendarContent(calendarManager)
            } else {
                Text("Calendar integration unavailable")
                    .font(.caption)
                    .foregroundStyle(MapleTheme.textSecondary)
            }
        }
    }

    @ViewBuilder
    private func calendarContent(_ manager: CalendarManager) -> some View {
        let isConnected = settingsManager.calendarEnabled && manager.authorizationStatus == .fullAccess

        // Connect / Disconnect button
        if isConnected {
            HStack {
                Label {
                    Text("Connected")
                        .font(.subheadline)
                } icon: {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(MapleTheme.success)
                }

                Spacer()

                Button("Disconnect") {
                    settingsManager.calendarEnabled = false
                    manager.disconnectAccess()
                }
                .font(.caption)
                .foregroundStyle(MapleTheme.error)
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Text("Name recordings after the current calendar event.")
                    .font(.caption)
                    .foregroundStyle(MapleTheme.textSecondary)

                if manager.authorizationStatus == .denied {
                    Label {
                        Text("Calendar access was denied. Enable it in System Settings > Privacy > Calendars.")
                            .font(.caption)
                    } icon: {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(MapleTheme.error)
                    }
                }

                Button {
                    Task {
                        let granted = await manager.requestAccess()
                        if granted {
                            settingsManager.calendarEnabled = true
                        }
                    }
                } label: {
                    Label("Connect Calendar", systemImage: "calendar.badge.plus")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                }
                .buttonStyle(.borderedProminent)
                .tint(MapleTheme.primary)
            }
        }

        // Calendar picker + title mode (only shown when connected)
        if isConnected {
            Divider()
                .padding(.vertical, 4)

            // Calendar picker (multi-select)
            VStack(alignment: .leading, spacing: 6) {
                Text("Calendars")
                    .font(.caption)
                    .foregroundStyle(MapleTheme.textSecondary)

                let allSelected = settingsManager.selectedCalendarIdentifiers.isEmpty

                Button {
                    settingsManager.selectedCalendarIdentifiers = []
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: allSelected ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(allSelected ? MapleTheme.primary : MapleTheme.textSecondary)
                            .font(.subheadline)
                        Text("All Calendars")
                            .font(.subheadline)
                            .foregroundStyle(MapleTheme.textPrimary)
                    }
                }
                .buttonStyle(.plain)

                ForEach(manager.calendars) { cal in
                    let isSelected = !allSelected && settingsManager.selectedCalendarIdentifiers.contains(cal.id)
                    Button {
                        toggleCalendar(cal.id)
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(isSelected ? MapleTheme.primary : MapleTheme.textSecondary)
                                .font(.subheadline)
                            Circle()
                                .fill(calendarColor(cal.color))
                                .frame(width: 8, height: 8)
                            Text(cal.title)
                                .font(.subheadline)
                                .foregroundStyle(MapleTheme.textPrimary)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }

            Divider()
                .padding(.vertical, 4)

            // Title mode
            VStack(alignment: .leading, spacing: 6) {
                Text("Recording title")
                    .font(.caption)
                    .foregroundStyle(MapleTheme.textSecondary)

                Picker(selection: $settingsManager.calendarTitleMode) {
                    Text("Use as title").tag(CalendarTitleMode.exactName)
                    Text("Prefix with event name").tag(CalendarTitleMode.hint)
                } label: {
                    EmptyView()
                }
                .pickerStyle(.segmented)

                Text(titleModeExample)
                    .font(.caption2)
                    .foregroundStyle(MapleTheme.textSecondary)
                    .padding(.top, 2)
            }
        }
    }

    private func toggleCalendar(_ id: String) {
        var ids = settingsManager.selectedCalendarIdentifiers
        if ids.contains(id) {
            ids.removeAll { $0 == id }
        } else {
            // If switching from "All", start fresh with just this one
            if ids.isEmpty {
                ids = [id]
            } else {
                ids.append(id)
            }
        }
        // If all individual calendars are now selected, revert to "All"
        if let calendarManager, ids.count >= calendarManager.calendars.count {
            ids = []
        }
        settingsManager.selectedCalendarIdentifiers = ids
    }

    private var titleModeExample: String {
        switch settingsManager.calendarTitleMode {
        case .off:
            return "Calendar disabled"
        case .hint:
            return "e.g. \"Weekly Standup \u{2014} Recording\""
        case .exactName:
            return "e.g. \"Weekly Standup\""
        }
    }

    private func calendarColor(_ cgColor: CGColor?) -> Color {
        guard let cgColor else { return MapleTheme.primary }
        #if os(macOS)
        return Color(nsColor: NSColor(cgColor: cgColor) ?? .controlAccentColor)
        #else
        return Color(uiColor: UIColor(cgColor: cgColor))
        #endif
    }

    // MARK: - Custom Prompts

    private var promptsSection: some View {
        SettingsCard {
            SettingsSectionHeader(icon: "text.bubble", title: "Custom Prompts")

            if promptStore.prompts.isEmpty {
                Text("No custom prompts yet.")
                    .font(.caption)
                    .foregroundStyle(MapleTheme.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 4)
            } else {
                VStack(spacing: 0) {
                    ForEach(promptStore.prompts) { prompt in
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(prompt.name)
                                    .font(.subheadline.weight(.medium))
                                Text(prompt.systemPrompt)
                                    .font(.caption)
                                    .foregroundStyle(MapleTheme.textSecondary)
                                    .lineLimit(2)
                            }

                            Spacer()

                            Button {
                                try? promptStore.delete(prompt)
                            } label: {
                                Image(systemName: "trash")
                                    .font(.caption)
                                    .foregroundStyle(MapleTheme.error.opacity(0.8))
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(.vertical, 8)

                        if prompt.id != promptStore.prompts.last?.id {
                            Divider()
                        }
                    }
                }
            }

            Button {
                showingAddPrompt = true
            } label: {
                Label("Add Prompt", systemImage: "plus.circle")
                    .font(.subheadline)
            }
            .buttonStyle(.plain)
            .foregroundStyle(MapleTheme.primary)
            .padding(.top, 4)

            Text("Prompts sync across your devices via iCloud.")
                .font(.caption2)
                .foregroundStyle(MapleTheme.textSecondary)
                .padding(.top, 2)
        }
    }
}

// MARK: - Settings Card

private struct SettingsCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(MapleTheme.surface, in: .rect(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(MapleTheme.border.opacity(0.15), lineWidth: 0.5)
        )
    }
}

// MARK: - Section Header

private struct SettingsSectionHeader: View {
    let icon: String
    let title: String

    var body: some View {
        Label {
            Text(title)
                .font(.headline)
                .foregroundStyle(MapleTheme.textPrimary)
        } icon: {
            Image(systemName: icon)
                .font(.subheadline)
                .foregroundStyle(MapleTheme.primary)
        }
        .padding(.bottom, 4)
    }
}
#endif
