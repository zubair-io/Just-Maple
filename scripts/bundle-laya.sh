#!/bin/bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODEL_ROOT="$REPO_ROOT/.build/laya-model"
MODEL_NAME="laya_english_fp16_L512_options32"
python3 "$REPO_ROOT/scripts/prepare-laya.py" --offline
COMPILER_VERSION="$(xcrun --find coremlcompiler)-$(xcodebuild -version)"
STAMP="$MODEL_ROOT/compiled-version.txt"
if [[ ! -d "$MODEL_ROOT/$MODEL_NAME.mlmodelc" || ! -f "$STAMP" || "$(cat "$STAMP")" != "$COMPILER_VERSION" ]]; then
  xcrun coremlcompiler compile "$MODEL_ROOT/$MODEL_NAME.mlpackage" "$MODEL_ROOT"
  printf '%s' "$COMPILER_VERSION" > "$STAMP"
fi
DEST="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/Laya"
mkdir -p "$DEST/tokenizer"
/usr/bin/rsync -a --delete "$MODEL_ROOT/$MODEL_NAME.mlmodelc/" "$DEST/$MODEL_NAME.mlmodelc/"
cp "$MODEL_ROOT/tokenizer/tokenizer.json" "$MODEL_ROOT/tokenizer/tokenizer_config.json" "$DEST/tokenizer/"
cp "$MODEL_ROOT/rl_agent_config.json" "$MODEL_ROOT/LICENSE" "$DEST/"
cp "$REPO_ROOT/scripts/laya-assets.json" "$DEST/assets.json"
cp "$REPO_ROOT/scripts/laya-validation.json" "$DEST/validation.json"
