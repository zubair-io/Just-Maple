#!/bin/bash
# Just Maple - ACR Setup Script
# For deployments with existing MongoDB and Redis

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[INFO]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    error "Please run as root or with sudo"
fi

ACR_REGISTRY="acrjustmaple.azurecr.io"
APP_DIR="/opt/justmaple"

log "Starting Just Maple setup with Azure Container Registry..."

# Update and install dependencies
log "Installing dependencies..."
apt-get update
apt-get install -y ca-certificates curl gnupg

# Install Docker if not present
if ! command -v docker &> /dev/null; then
    log "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
else
    log "Docker already installed"
fi

# Create app directory
log "Creating application directory..."
mkdir -p "${APP_DIR}"
cd "${APP_DIR}"

# Download ACR-specific compose file
log "Downloading deployment files..."
REPO_URL="https://raw.githubusercontent.com/justmapleapp/Just-Maple/main/deploy/proxmox"
curl -fsSL "${REPO_URL}/docker-compose.acr.yml" -o docker-compose.yml
curl -fsSL "${REPO_URL}/.env.acr.example" -o .env.example

# Create .env if doesn't exist
if [ ! -f .env ]; then
    cp .env.example .env
    JWT_SECRET=$(openssl rand -base64 32)
    sed -i "s|JWT_SECRET=change-this-to-a-secure-random-string|JWT_SECRET=${JWT_SECRET}|" .env
fi

# Prompt for ACR login
echo ""
echo "=========================================="
echo "Azure Container Registry Login Required"
echo "=========================================="
echo ""
echo "You need to authenticate with ACR to pull images."
echo ""
echo "Option 1: Service Principal (recommended for automation)"
echo "  docker login ${ACR_REGISTRY} -u <service-principal-id> -p <password>"
echo ""
echo "Option 2: Azure CLI"
echo "  az acr login --name acrjustmaple"
echo ""
echo "Option 3: Admin credentials (if enabled)"
echo "  docker login ${ACR_REGISTRY}"
echo ""

read -p "Have you already logged in to ACR? (y/n): " acr_logged_in

if [ "$acr_logged_in" != "y" ]; then
    log "Attempting Docker login to ACR..."
    docker login ${ACR_REGISTRY}
fi

# Verify login by pulling image
log "Verifying ACR access..."
if docker pull ${ACR_REGISTRY}/justmaple-api:latest; then
    log "ACR authentication successful!"
else
    error "Failed to pull image. Check your ACR credentials."
fi

# Create systemd service
log "Creating systemd service..."
cat > /etc/systemd/system/justmaple.service << EOF
[Unit]
Description=Just Maple Application
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable justmaple.service

# Create update script
cat > "${APP_DIR}/update.sh" << 'EOF'
#!/bin/bash
cd /opt/justmaple
docker compose pull
docker compose up -d
docker image prune -f
EOF
chmod +x "${APP_DIR}/update.sh"

echo ""
echo "=========================================="
echo -e "${GREEN}Setup Complete!${NC}"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Edit configuration: nano ${APP_DIR}/.env"
echo "     - Set MONGODB_URI to your MongoDB connection string"
echo "     - Set REDIS_URL to your Redis connection string"
echo "     - Configure RP_ID and ORIGIN for your domain"
echo ""
echo "  2. Start the app: systemctl start justmaple"
echo ""
echo "  3. Access at: http://YOUR-IP:7071"
echo ""
echo "Auto-updates: Watchtower checks ACR every 24 hours"
echo ""
