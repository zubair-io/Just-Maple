import SwiftUI

enum MapleTheme {
    // MARK: - Primary

    static let primary = Color("maplePrimary")
    static let primaryHover = Color("maplePrimaryHover")
    static let primaryLight = Color("maplePrimaryLight")

    // MARK: - Surfaces

    static let background = Color("mapleBackground")
    static let surface = Color("mapleSurface")
    static let surfaceAlt = Color("mapleSurfaceAlt")
    static let surfaceHover = Color("mapleSurfaceHover")

    // MARK: - Text

    static let textPrimary = Color("mapleTextPrimary")
    static let textSecondary = Color("mapleTextSecondary")

    // MARK: - Borders & Status

    static let border = Color("mapleBorder")
    static let error = Color("mapleError")
    static let success = Color("mapleSuccess")
    static let info = Color("mapleInfo")

    // MARK: - Speaker Colors

    static let speakerColors: [Color] = [
        Color("speaker0"),
        Color("speaker1"),
        Color("speaker2"),
        Color("speaker3"),
        Color("speaker4"),
        Color("speaker5"),
        Color("speaker6"),
        Color("speaker7"),
    ]

    static func speakerColor(for index: Int) -> Color {
        speakerColors[index % speakerColors.count]
    }
}
