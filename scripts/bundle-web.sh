#!/bin/bash
set -euo pipefail
# Xcode's non-login shell does not inherit Homebrew's Node path.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT/src/web"
if [[ ! -d node_modules ]]; then
  echo 'error: Install the Angular dependencies first: npm ci --prefix src/web'
  exit 1
fi
if [[ "${PLATFORM_NAME:-}" == iphone* ]]; then
  export npm_config_cache="$DERIVED_FILE_DIR/npm-cache"
fi
npm run build
# iPhone uses Xcode Copy Bundle Resources for the generated browser folder.
# Keep User Script Sandboxing enabled: this phase never writes inside its app bundle.
if [[ "${PLATFORM_NAME:-}" == iphone* ]]; then exit 0; fi
WEB_DEST="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/Web"
mkdir -p "$WEB_DEST"
/usr/bin/rsync -a --delete dist/just-maple/browser/ "$WEB_DEST/"
PROVIDER_SOURCE="$REPO_ROOT/src/providers"
if [[ ! -d "$PROVIDER_SOURCE/node_modules" ]]; then
  echo 'error: Install provider dependencies: npm ci --prefix src/providers'
  exit 1
fi
PROVIDER_DEST="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/Providers"
mkdir -p "$PROVIDER_DEST"
/usr/bin/rsync -a --delete --exclude='test' "$PROVIDER_SOURCE/" "$PROVIDER_DEST/"
