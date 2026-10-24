import Foundation

enum PlaybackSpeed: Float, CaseIterable {
    case x0_5 = 0.5
    case x0_75 = 0.75
    case x1 = 1.0
    case x1_25 = 1.25
    case x1_5 = 1.5
    case x2 = 2.0

    var label: String {
        switch self {
        case .x1: "1x"
        default: String(format: "%g", rawValue) + "x"
        }
    }

    func next() -> PlaybackSpeed {
        let all = Self.allCases
        let idx = all.firstIndex(of: self) ?? 0
        return all[(idx + 1) % all.count]
    }
}
