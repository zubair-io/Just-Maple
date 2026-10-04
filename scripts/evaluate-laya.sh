#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
MODEL_DIR="$PWD/.build/laya-model"
OUTPUT="${1:-$PWD/.build/laya-evaluations/run-$(date +%Y%m%d-%H%M%S)}"
python3 scripts/prepare-laya.py --offline
MAPLE_LAYA_MODEL_DIR="$MODEL_DIR" swift test --package-path src/apple/Packages/MapleCore --filter LayaRuntimeTests
swift build --package-path src/apple/Packages/MapleCore --product just-maple
mkdir -p "$(dirname "$OUTPUT")"
STATUS=0
for MODE in evaluate-message-screening evaluate-messages evaluate; do
  src/apple/Packages/MapleCore/.build/debug/just-maple "$MODE" --laya-model "$MODEL_DIR" --output "$OUTPUT/$MODE" > "$OUTPUT-$MODE.json" || STATUS=1
done
printf 'Synthetic local-model evaluation results: %s\n' "$OUTPUT"
# Approval is a reviewed release decision, never a side effect of model installation.
exit "$STATUS"
