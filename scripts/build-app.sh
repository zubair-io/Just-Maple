#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
xcodebuild -project 'src/apple/Just Maple.xcodeproj' -scheme 'Just Maple' -configuration Debug -destination 'platform=macOS' -derivedDataPath .build/xcode build
APP_DIR="$PWD/.build/xcode/Build/Products/Debug/Just Maple.app"
# A successful incremental compile is not enough: bundled web/model resources
# must still match Xcode's signature before we offer the app for testing.
codesign --verify --deep --strict "$APP_DIR"
if [[ "${1:-}" == "--open" ]]; then open "$APP_DIR"; fi
printf '%s\n' "$APP_DIR"
