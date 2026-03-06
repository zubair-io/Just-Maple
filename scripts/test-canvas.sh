#!/usr/bin/env bash
# Run canvas E2E tests with optional Playwright flags
#
# Usage:
#   ./scripts/test-canvas.sh              # Run all canvas tests
#   ./scripts/test-canvas.sh --headed     # Run in headed mode
#   ./scripts/test-canvas.sh --ui         # Open Playwright UI
#   ./scripts/test-canvas.sh --debug      # Run with Playwright inspector

set -euo pipefail

cd "$(dirname "$0")/.."

# Build the e2e bundle first
bun run build:e2e

# Run canvas spec with any extra flags
exec npx playwright test e2e/canvas.spec.ts "$@"
