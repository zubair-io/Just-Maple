import SwiftUI

struct UnderlineTabBar<Selection: Hashable>: View {
    @Binding var selection: Selection
    let tabs: [(label: String, value: Selection)]

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                ForEach(Array(tabs.enumerated()), id: \.offset) { _, tab in
                    TabBarButton(
                        label: tab.label,
                        isSelected: selection == tab.value
                    ) {
                        withAnimation(.easeInOut(duration: 0.2)) {
                            selection = tab.value
                        }
                    }
                }
            }

            Rectangle()
                .fill(MapleTheme.border.opacity(0.1))
                .frame(height: 1)
        }
    }
}

private struct TabBarButton: View {
    let label: String
    let isSelected: Bool
    let action: () -> Void
    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Text(label)
                    .font(.subheadline)
                    .fontWeight(isSelected ? .semibold : .regular)
                    .foregroundStyle(
                        isSelected
                            ? MapleTheme.primary
                            : MapleTheme.textSecondary.opacity(0.7)
                    )

                RoundedRectangle(cornerRadius: 1.5)
                    .fill(isSelected ? MapleTheme.primary : Color.clear)
                    .frame(height: 3)
            }
            .padding(.top, 4)
            .frame(maxWidth: .infinity)
            // Whole tab area is tappable and shows a hover highlight.
            .contentShape(Rectangle())
            .background(
                isHovering && !isSelected ? MapleTheme.surfaceHover.opacity(0.4) : .clear,
                in: .rect(cornerRadius: 6)
            )
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
        #if !os(watchOS)
        .onHover { isHovering = $0 }
        #endif
    }
}
