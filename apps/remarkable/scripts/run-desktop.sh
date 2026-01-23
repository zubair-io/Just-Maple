#!/bin/bash
# Run Just Maple in desktop mode for development
# This runs natively on macOS/Linux/Windows

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Running Just Maple in Desktop Mode${NC}"
echo "====================================="

# Set environment variables for development
export MAPLE_API_URL="${MAPLE_API_URL:-http://localhost:8081}"
export MAPLE_WS_URL="${MAPLE_WS_URL:-ws://localhost:8081/ws}"
export MAPLE_STORAGE_PATH="${MAPLE_STORAGE_PATH:-$HOME/.local/share/justmaple-dev}"
export RUST_LOG="${RUST_LOG:-info}"

echo "API URL: $MAPLE_API_URL"
echo "Storage: $MAPLE_STORAGE_PATH"
echo ""

# Create storage directory
mkdir -p "$MAPLE_STORAGE_PATH"

# Run with desktop feature (default)
cargo run --features desktop

echo -e "\n${GREEN}Done${NC}"
