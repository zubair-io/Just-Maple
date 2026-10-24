// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "MapleRecorderKit",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [.library(name: "MapleRecorderKit", targets: ["MapleRecorderKit"])],
    dependencies: [
        .package(url: "https://github.com/FluidInference/FluidAudio.git", exact: "0.13.6"),
        .package(url: "https://github.com/ml-explore/mlx-swift-lm.git", exact: "3.31.3"),
        .package(url: "https://github.com/huggingface/swift-huggingface.git", exact: "0.9.0"),
        .package(url: "https://github.com/huggingface/swift-transformers.git", exact: "1.3.4"),
    ],
    targets: [
        .target(name: "MapleRecorderKit", dependencies: [
            .product(name: "FluidAudio", package: "FluidAudio"),
            .product(name: "MLXLLM", package: "mlx-swift-lm"),
            .product(name: "MLXLMCommon", package: "mlx-swift-lm"),
            .product(name: "HuggingFace", package: "swift-huggingface"),
            .product(name: "Tokenizers", package: "swift-transformers"),
        ], swiftSettings: [.defaultIsolation(MainActor.self)]),
        .testTarget(name: "MapleRecorderKitTests", dependencies: ["MapleRecorderKit"],
                    swiftSettings: [.defaultIsolation(MainActor.self)]),
    ],
    swiftLanguageModes: [.v5]
)
