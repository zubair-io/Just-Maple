#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
xcodebuild -project 'src/apple/Just Maple.xcodeproj' -scheme 'Just Maple' -configuration Debug -destination 'platform=macOS' -derivedDataPath .build/xcode build
APP_DIR="$PWD/.build/xcode/Build/Products/Debug/Just Maple.app"
if [[ "${1:-}" == "--open" ]]; then open "$APP_DIR"; fi
printf '%s\n' "$APP_DIR"
