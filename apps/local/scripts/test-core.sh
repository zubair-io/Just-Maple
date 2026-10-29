#!/bin/bash
set -euo pipefail
local_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
check_dir="$(mktemp -d "${TMPDIR:-/tmp}/maple-local-core.XXXXXX")"
trap 'rm -rf "$check_dir"' EXIT
mkdir -p "$check_dir/Sources/LocalMaple" "$check_dir/Sources/MapleRecorderKit" "$check_dir/Tests/LocalTests" "$check_dir/Tests/RecorderTests"
cp "$local_root/apple/LocalMaple/LocalDocumentStore.swift" "$local_root/apple/LocalMaple/LocalAssetPath.swift" "$check_dir/Sources/LocalMaple/"
cp "$local_root/../apple/MapleRecorderKit/Sources/MapleRecorderKit/RecorderHostConfiguration.swift" "$check_dir/Sources/MapleRecorderKit/"
cp "$local_root/apple/LocalMapleTests/LocalDocumentStoreTests.swift" "$check_dir/Tests/LocalTests/"
cp "$local_root/../apple/MapleRecorderKit/Tests/MapleRecorderKitTests/RecorderHostConfigurationTests.swift" "$check_dir/Tests/RecorderTests/"
cat > "$check_dir/Package.swift" <<'PACKAGE'
// swift-tools-version: 6.2
import PackageDescription
let package = Package(name: "LocalCoreChecks", platforms: [.macOS(.v14)], targets: [
    .target(name: "LocalMaple"), .target(name: "MapleRecorderKit"),
    .testTarget(name: "LocalTests", dependencies: ["LocalMaple"]),
    .testTarget(name: "RecorderTests", dependencies: ["MapleRecorderKit"]),
])
PACKAGE
swift test --package-path "$check_dir"
