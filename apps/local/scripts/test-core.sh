#!/bin/bash
set -euo pipefail
local_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
check_dir="$(mktemp -d "${TMPDIR:-/tmp}/maple-local-core.XXXXXX")"
trap 'rm -rf "$check_dir"' EXIT
mkdir -p "$check_dir/Sources/JustMaple" "$check_dir/Sources/MapleRecorderKit" "$check_dir/Tests/LocalTests" "$check_dir/Tests/RecorderTests"
cp "$local_root/apple/JustMaple/LocalDocumentStore.swift" "$local_root/apple/JustMaple/LocalAssetPath.swift" "$check_dir/Sources/JustMaple/"
cp "$local_root/../apple/MapleRecorderKit/Sources/MapleRecorderKit/RecorderHostConfiguration.swift" "$check_dir/Sources/MapleRecorderKit/"
cp "$local_root/apple/JustMapleTests/LocalDocumentStoreTests.swift" "$check_dir/Tests/LocalTests/"
cp "$local_root/../apple/MapleRecorderKit/Tests/MapleRecorderKitTests/RecorderHostConfigurationTests.swift" "$check_dir/Tests/RecorderTests/"
cat > "$check_dir/Package.swift" <<'PACKAGE'
// swift-tools-version: 6.2
import PackageDescription
let package = Package(name: "LocalCoreChecks", platforms: [.macOS(.v14)], targets: [
    .target(name: "JustMaple"), .target(name: "MapleRecorderKit"),
    .testTarget(name: "LocalTests", dependencies: ["JustMaple"]),
    .testTarget(name: "RecorderTests", dependencies: ["MapleRecorderKit"]),
])
PACKAGE
swift test --package-path "$check_dir"
