#!/bin/bash
# Deploy Just Maple to reMarkable tablet
# Usage: ./deploy.sh [ip_address]

set -e

# Configuration
REMARKABLE_IP="${1:-10.11.99.1}"
REMARKABLE_USER="root"
BINARY_NAME="justmaple-remarkable"
INSTALL_DIR="/home/root/.local/bin"
SERVICE_DIR="/etc/systemd/system"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Just Maple reMarkable Deployment${NC}"
echo "=================================="

# Check if binary exists
BINARY_PATH="target/armv7-unknown-linux-gnueabihf/release/$BINARY_NAME"
if [ ! -f "$BINARY_PATH" ]; then
    echo -e "${RED}Error: Binary not found at $BINARY_PATH${NC}"
    echo "Please build first with: ./scripts/build.sh"
    exit 1
fi

# Check connection
echo -e "\n${YELLOW}Checking connection to reMarkable at $REMARKABLE_IP...${NC}"
if ! ping -c 1 -W 2 "$REMARKABLE_IP" > /dev/null 2>&1; then
    echo -e "${RED}Error: Cannot reach reMarkable at $REMARKABLE_IP${NC}"
    echo "Make sure your tablet is connected via USB or WiFi"
    exit 1
fi
echo -e "${GREEN}Connection OK${NC}"

# Create install directory
echo -e "\n${YELLOW}Creating install directory...${NC}"
ssh "$REMARKABLE_USER@$REMARKABLE_IP" "mkdir -p $INSTALL_DIR"

# Copy binary
echo -e "\n${YELLOW}Copying binary to reMarkable...${NC}"
scp "$BINARY_PATH" "$REMARKABLE_USER@$REMARKABLE_IP:$INSTALL_DIR/"
echo -e "${GREEN}Binary copied${NC}"

# Set permissions
echo -e "\n${YELLOW}Setting permissions...${NC}"
ssh "$REMARKABLE_USER@$REMARKABLE_IP" "chmod +x $INSTALL_DIR/$BINARY_NAME"

# Copy systemd service (optional)
if [ -f "scripts/justmaple.service" ]; then
    echo -e "\n${YELLOW}Installing systemd service...${NC}"
    scp "scripts/justmaple.service" "$REMARKABLE_USER@$REMARKABLE_IP:$SERVICE_DIR/"
    ssh "$REMARKABLE_USER@$REMARKABLE_IP" "systemctl daemon-reload"
fi

echo -e "\n${GREEN}Deployment complete!${NC}"
echo ""
echo "To run manually:"
echo "  ssh $REMARKABLE_USER@$REMARKABLE_IP '$INSTALL_DIR/$BINARY_NAME'"
echo ""
echo "To install as service:"
echo "  ssh $REMARKABLE_USER@$REMARKABLE_IP 'systemctl enable justmaple && systemctl start justmaple'"
