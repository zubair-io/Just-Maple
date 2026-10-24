#if !os(watchOS)
import SwiftUI

struct ProviderBadge: View {
    let provider: LLMProvider

    private var isCloud: Bool {
        provider == .claude || provider == .openai
    }

    private var displayName: String {
        switch provider {
        case .appleFoundationModels: "Apple On-Device"
        case .claude: "Claude"
        case .openai: "OpenAI"
        case .none: "Off"
        }
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: isCloud ? "cloud.fill" : "iphone")
            Text(isCloud ? "Cloud" : "On-Device")
        }
        .font(.caption2)
        .foregroundStyle(isCloud ? MapleTheme.info : MapleTheme.success)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(
            (isCloud ? MapleTheme.info : MapleTheme.success).opacity(0.12),
            in: .capsule
        )
    }
}
#endif
