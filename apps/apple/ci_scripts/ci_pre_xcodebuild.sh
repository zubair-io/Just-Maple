#!/bin/sh
# The committed marketing version is authoritative; Cloud assigns build numbers.
set -eu
SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=${CI_PRIMARY_REPOSITORY_PATH:-$(CDPATH='' cd -- "$SCRIPT_DIR/../../.." && pwd)}
python3 "$SCRIPT_DIR/validate_version.py" "$REPO_ROOT/apps/apple/JapaneseMaple.xcodeproj/project.pbxproj"
