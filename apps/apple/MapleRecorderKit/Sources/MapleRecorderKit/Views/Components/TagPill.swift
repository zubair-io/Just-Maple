import SwiftUI

struct TagPill: View {
    let tag: String
    /// When set, the pill is capped to this width and long tags are truncated —
    /// used in the recording list so a stray long tag stays on one line.
    var maxWidth: CGFloat? = nil

    var body: some View {
        Text(tag.uppercased())
            .font(.caption2)
            .fontWeight(.semibold)
            .foregroundStyle(MapleTheme.textSecondary)
            .lineLimit(1)
            .truncationMode(.tail)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(MapleTheme.surfaceAlt, in: .capsule)
            .frame(maxWidth: maxWidth, alignment: .leading)
    }
}
