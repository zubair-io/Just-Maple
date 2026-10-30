import SwiftUI

struct ServerSettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var publicAddress = ServerConfigService.shared.hasConfiguredServer
        ? ServerConfigService.shared.getActiveServer().url : ""
    @State private var localAddress = ServerConfigService.shared.localURL ?? ""
    @State private var error: String?
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Server") {
                    TextField("phoebe.justmaple.app", text: $publicAddress)
                        .autocorrectionDisabled()
                    Text("Enter the public address of your JapaneseMaple server.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                Section("Local address (optional)") {
                    TextField("local.phoebe.justmaple.app", text: $localAddress)
                        .autocorrectionDisabled()
                    Text("Used when this device can reach the same server on your network. Otherwise, JapaneseMaple uses the public address.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                if let error { Text(error).foregroundStyle(.red) }
                Button(saving ? "Connecting…" : "Connect") {
                    saving = true
                    error = nil
                    Task {
                        do {
                            try await ServerConfigService.shared.configure(
                                publicAddress: publicAddress, localAddress: localAddress)
                            dismiss()
                        } catch { self.error = error.localizedDescription }
                        saving = false
                    }
                }
                .disabled(saving || publicAddress.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            .formStyle(.grouped)
            .navigationTitle(ServerConfigService.shared.hasConfiguredServer ? "Server settings" : "Connect to JapaneseMaple")
            .toolbar {
                if ServerConfigService.shared.hasConfiguredServer {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .frame(minWidth: 320, minHeight: 360)
        .interactiveDismissDisabled(!ServerConfigService.shared.hasConfiguredServer)
    }
}
