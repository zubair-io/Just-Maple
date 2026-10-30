import SwiftUI

struct ServerSettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var publicAddress = ServerConfigService.shared.hasConfiguredServer
        ? ServerConfigService.shared.getActiveServer().url : ""
    @State private var error: String?
    @State private var saving = false
    @State private var discoveredLocal = ServerConfigService.shared.localURL
    @State private var connectedLocally = false
    private let isWelcome = !ServerConfigService.shared.hasConfiguredServer

    var body: some View {
        NavigationStack {
            Form {
                if isWelcome {
                    Section {
                        VStack(spacing: 12) {
                            Image("MapleLeaf")
                                .resizable()
                                .scaledToFit()
                                .frame(width: 120, height: 52)
                                .accessibilityLabel("Maple leaf")
                            Text("Welcome to JapaneseMaple")
                                .font(.title2.bold())
                            Text("Connect to your server to get started.")
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 20)
                    }
                }
                Section("Server address") {
                    TextField("Server address", text: $publicAddress)
                        .autocorrectionDisabled()
                        .disabled(saving)
                    Text("Enter the primary domain of your JapaneseMaple server.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if !isWelcome, let discoveredLocal {
                    Section("Local connection") {
                        Text(discoveredLocal).textSelection(.enabled)
                        Text(connectedLocally ? "Connected locally" : "Using the primary address")
                            .foregroundStyle(.secondary)
                        Text("Provided by your server. JapaneseMaple uses it automatically when reachable. An administrator can change it in the server’s network settings.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
                if let error { Text(error).foregroundStyle(.red) }
                Button(saving ? "Connecting…" : "Connect") {
                    saving = true
                    error = nil
                    Task {
                        do {
                            try await ServerConfigService.shared.configure(publicAddress: publicAddress)
                            dismiss()
                        } catch { self.error = error.localizedDescription }
                        saving = false
                    }
                }
                .disabled(saving || publicAddress.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .formStyle(.grouped)
            .navigationTitle(isWelcome ? "Welcome" : "Server settings")
            .toolbar {
                if !isWelcome { Button("Cancel") { dismiss() } }
            }
            .task {
                guard !isWelcome else { return }
                let config = ServerConfigService.shared
                let endpoint = await config.resolveEndpoint()
                discoveredLocal = config.localURL
                connectedLocally = discoveredLocal != nil && endpoint == discoveredLocal
            }
        }
        .frame(minWidth: 320, minHeight: 440)
        .interactiveDismissDisabled(isWelcome)
    }
}
