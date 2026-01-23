#!/bin/bash
# Build Just Maple for reMarkable or Desktop
# Usage: ./build.sh [--desktop|--remarkable]

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

MODE="${1:---remarkable}"

case "$MODE" in
    --desktop)
        echo -e "${YELLOW}Building Just Maple for Desktop${NC}"
        echo "================================="

        cargo build --release --features desktop

        BINARY="target/release/justmaple-remarkable"
        if [ -f "$BINARY" ]; then
            SIZE=$(du -h "$BINARY" | cut -f1)
            echo -e "\n${GREEN}Build successful!${NC}"
            echo "Binary: $BINARY"
            echo "Size: $SIZE"
            echo ""
            echo "To run: ./target/release/justmaple-remarkable"
        else
            echo -e "\n${RED}Build failed${NC}"
            exit 1
        fi
        ;;

    --remarkable)
        echo -e "${YELLOW}Building Just Maple for reMarkable${NC}"
        echo "===================================="

        # Check for cross
        if ! command -v cross &> /dev/null; then
            echo -e "${RED}Error: 'cross' not found${NC}"
            echo "Install it with: cargo install cross"
            exit 1
        fi

        # Target for reMarkable 2 (ARM Cortex-A7)
        TARGET="armv7-unknown-linux-gnueabihf"

        echo -e "\n${YELLOW}Building for $TARGET...${NC}"

        # Build release with remarkable feature
        cross build --release --target "$TARGET" --features remarkable --no-default-features

        # Check result
        BINARY="target/$TARGET/release/justmaple-remarkable"
        if [ -f "$BINARY" ]; then
            SIZE=$(du -h "$BINARY" | cut -f1)
            echo -e "\n${GREEN}Build successful!${NC}"
            echo "Binary: $BINARY"
            echo "Size: $SIZE"
            echo ""
            echo "To deploy to reMarkable:"
            echo "  ./scripts/deploy.sh [ip_address]"
        else
            echo -e "\n${RED}Build failed${NC}"
            exit 1
        fi
        ;;

    *)
        echo "Usage: $0 [--desktop|--remarkable]"
        echo ""
        echo "  --desktop     Build for local development (macOS/Linux/Windows)"
        echo "  --remarkable  Build for reMarkable device (requires cross)"
        exit 1
        ;;
esac
