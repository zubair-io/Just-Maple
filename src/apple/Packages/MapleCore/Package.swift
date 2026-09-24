// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "MapleCore",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [
        .library(name: "MapleNotebooks", targets: ["MapleNotebooks"]),
        .library(name: "MapleCore", targets: ["MapleCore"]),
        .library(name: "MapleCompanionTransport", targets: ["MapleCompanionTransport"]),
        .executable(name: "just-maple", targets: ["JustMapleCLI"]),
    ],
    targets: [
        .target(name: "MapleNotebooks"),
        .target(name: "MapleCompanionTransport"),
        .testTarget(name: "MapleCompanionTransportTests", dependencies: ["MapleCompanionTransport"]),
        .systemLibrary(name: "CSQLite", pkgConfig: "sqlite3"),
        .target(name: "MapleCore", dependencies: ["CSQLite", "MapleNotebooks"]),
        .executableTarget(name: "JustMapleCLI", dependencies: ["MapleCore"]),
        .testTarget(name: "MapleCoreTests", dependencies: ["MapleCore"]),
    ]
)
