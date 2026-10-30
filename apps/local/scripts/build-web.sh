#!/bin/bash
set -euo pipefail
local_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
web_root="$local_root/web"
bundle_root="$local_root/apple/JustMaple/WebApp"
# Explicitly built assets are required; a missing editor must fail the build.
if [[ "${MAPLE_LOCAL_SKIP_WEB_BUILD:-0}" != "1" ]]; then
    bun run --cwd "$web_root" build:production
fi
test -f "$web_root/dist/web/browser/index.html"
mkdir -p "$bundle_root"
rsync -a --delete --exclude 'offline.html' "$web_root/dist/web/browser/" "$bundle_root/"
