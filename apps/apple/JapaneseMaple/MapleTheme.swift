//
//  MapleTheme.swift
//  JapaneseMaple
//
//  Color constants matching the web app's theme.
//

import SwiftUI

enum MapleTheme {
    // MARK: - Adaptive colors (light/dark)

    static let sidebarBackground = Color("SidebarBackground")
    static let surface = Color("Surface")
    static let surfaceHover = Color("SurfaceHover")
    static let textMain = Color("TextMain")
    static let textMuted = Color("TextMuted")
    static let primary = Color(hex: 0x993629)
    static let border = Color("Border")

    // MARK: - Fixed colors

    static let badgeText = Color.white
}

// MARK: - Hex initializer

extension Color {
    init(hex: UInt, opacity: Double = 1.0) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}
