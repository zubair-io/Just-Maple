#if !os(watchOS)
import SwiftUI

struct PromptResultsView: View {
    let results: [PromptResult]
    var onDelete: ((PromptResult) -> Void)?

    var body: some View {
        if !results.isEmpty {
            VStack(alignment: .leading, spacing: 16) {
                Text("Prompt Results")
                    .font(.system(.title2, design: .rounded, weight: .semibold))
                    .foregroundStyle(MapleTheme.textPrimary)

                ForEach(results) { result in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(result.promptName)
                                .font(.headline)
                                .foregroundStyle(MapleTheme.textPrimary)

                            Spacer()

                            ProviderBadge(provider: result.llmProvider)

                            if let onDelete {
                                Button(role: .destructive) {
                                    onDelete(result)
                                } label: {
                                    Image(systemName: "trash")
                                        .font(.caption)
                                }
                            }
                        }

                        Text(result.result)
                            .font(.body)
                            .foregroundStyle(MapleTheme.textPrimary)
                    }
                    .padding()
                    .background(MapleTheme.surfaceAlt, in: .rect(cornerRadius: 12))
                }
            }
        }
    }
}
#endif
