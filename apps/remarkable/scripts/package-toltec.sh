#!/bin/bash
# Package Just Maple for Toltec repository
# Creates an .ipk package for opkg installation

set -e

# Configuration
PKG_NAME="justmaple"
PKG_VERSION="0.1.0"
PKG_ARCH="armv7-3.2"
PKG_MAINTAINER="Just Maple Team"
PKG_DESCRIPTION="Note-taking app with Notes, Whiteboard, Messages, and Lego features"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Packaging Just Maple for Toltec${NC}"
echo "================================="

# Create package structure
PKG_DIR="pkg-build"
rm -rf "$PKG_DIR"
mkdir -p "$PKG_DIR/opt/bin"
mkdir -p "$PKG_DIR/opt/share/applications"
mkdir -p "$PKG_DIR/opt/share/icons"
mkdir -p "$PKG_DIR/DEBIAN"

# Copy binary
BINARY="target/armv7-unknown-linux-gnueabihf/release/justmaple-remarkable"
if [ ! -f "$BINARY" ]; then
    echo "Error: Binary not found. Run ./scripts/build.sh first"
    exit 1
fi
cp "$BINARY" "$PKG_DIR/opt/bin/justmaple"

# Create control file
cat > "$PKG_DIR/DEBIAN/control" << EOF
Package: $PKG_NAME
Version: $PKG_VERSION
Architecture: $PKG_ARCH
Maintainer: $PKG_MAINTAINER
Description: $PKG_DESCRIPTION
Depends: display
Priority: optional
Section: utils
EOF

# Create desktop entry
cat > "$PKG_DIR/opt/share/applications/justmaple.draft" << EOF
name=Just Maple
desc=Note-taking, Whiteboard, Messages & Lego
call=/opt/bin/justmaple
term=:
imgFile=justmaple
EOF

# Create postinst script
cat > "$PKG_DIR/DEBIAN/postinst" << 'EOF'
#!/bin/bash
# Register with draft launcher
if command -v update-draft &> /dev/null; then
    update-draft
fi
EOF
chmod +x "$PKG_DIR/DEBIAN/postinst"

# Create prerm script
cat > "$PKG_DIR/DEBIAN/prerm" << 'EOF'
#!/bin/bash
# Remove from draft launcher
rm -f /opt/share/applications/justmaple.draft
if command -v update-draft &> /dev/null; then
    update-draft
fi
EOF
chmod +x "$PKG_DIR/DEBIAN/prerm"

# Build package
PKG_FILE="${PKG_NAME}_${PKG_VERSION}_${PKG_ARCH}.ipk"
dpkg-deb --build "$PKG_DIR" "$PKG_FILE"

# Cleanup
rm -rf "$PKG_DIR"

echo -e "\n${GREEN}Package created: $PKG_FILE${NC}"
echo ""
echo "To install on reMarkable with Toltec:"
echo "  scp $PKG_FILE root@10.11.99.1:/tmp/"
echo "  ssh root@10.11.99.1 'opkg install /tmp/$PKG_FILE'"
