#!/bin/bash
# Just Maple - Docker VM Setup Script for Proxmox
# This script sets up Docker and Docker Compose on a fresh Debian/Ubuntu VM

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    error "Please run as root or with sudo"
fi

log "Starting Just Maple Docker environment setup..."

# Update system
log "Updating system packages..."
apt-get update
apt-get upgrade -y

# Install dependencies
log "Installing dependencies..."
apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    git \
    wget

# Install Docker
log "Installing Docker..."
if ! command -v docker &> /dev/null; then
    # Add Docker's official GPG key
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/$(. /etc/os-release && echo "$ID")/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    # Add Docker repository
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$(. /etc/os-release && echo "$ID") \
      $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
    log "Docker already installed, skipping..."
fi

# Start and enable Docker
log "Enabling Docker service..."
systemctl start docker
systemctl enable docker

# Create app directory
APP_DIR="/opt/justmaple"
log "Creating application directory at ${APP_DIR}..."
mkdir -p "${APP_DIR}"
cd "${APP_DIR}"

# Download deployment files
log "Downloading deployment files..."
REPO_URL="https://raw.githubusercontent.com/justmapleapp/Just-Maple/main/deploy/proxmox"

# Download docker-compose and env template
curl -fsSL "${REPO_URL}/docker-compose.prod.yml" -o docker-compose.yml
curl -fsSL "${REPO_URL}/.env.example" -o .env.example

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    log "Creating .env file from template..."
    cp .env.example .env

    # Generate a random JWT secret
    JWT_SECRET=$(openssl rand -base64 32)
    sed -i "s|JWT_SECRET=change-this-to-a-secure-random-string|JWT_SECRET=${JWT_SECRET}|" .env

    warn "Please edit ${APP_DIR}/.env and configure your settings"
else
    log ".env file already exists, skipping..."
fi

# Create systemd service
log "Creating systemd service..."
cat > /etc/systemd/system/justmaple.service << 'EOF'
[Unit]
Description=Just Maple Application
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/justmaple
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable justmaple.service

# Create helpful scripts
log "Creating helper scripts..."

# Update script
cat > "${APP_DIR}/update.sh" << 'EOF'
#!/bin/bash
# Manual update script - pulls latest images and restarts
cd /opt/justmaple
docker compose pull
docker compose up -d
docker image prune -f
EOF
chmod +x "${APP_DIR}/update.sh"

# Backup script
cat > "${APP_DIR}/backup.sh" << 'EOF'
#!/bin/bash
# Backup MongoDB data
BACKUP_DIR="/opt/justmaple/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "${BACKUP_DIR}"

echo "Creating MongoDB backup..."
docker exec justmaple-mongodb mongodump --archive="/data/db/backup_${TIMESTAMP}.archive"
docker cp justmaple-mongodb:/data/db/backup_${TIMESTAMP}.archive "${BACKUP_DIR}/"
docker exec justmaple-mongodb rm "/data/db/backup_${TIMESTAMP}.archive"

echo "Backup saved to ${BACKUP_DIR}/backup_${TIMESTAMP}.archive"

# Keep only last 7 backups
ls -t "${BACKUP_DIR}"/backup_*.archive 2>/dev/null | tail -n +8 | xargs -r rm
echo "Cleanup complete. Keeping last 7 backups."
EOF
chmod +x "${APP_DIR}/backup.sh"

# Status script
cat > "${APP_DIR}/status.sh" << 'EOF'
#!/bin/bash
cd /opt/justmaple
echo "=== Just Maple Status ==="
docker compose ps
echo ""
echo "=== Container Logs (last 20 lines) ==="
docker compose logs --tail=20
EOF
chmod +x "${APP_DIR}/status.sh"

# Print summary
echo ""
echo "=========================================="
echo -e "${GREEN}Just Maple Docker setup complete!${NC}"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Edit configuration:  nano ${APP_DIR}/.env"
echo "  2. Start the app:       systemctl start justmaple"
echo "  3. Check status:        ${APP_DIR}/status.sh"
echo ""
echo "Helpful commands:"
echo "  - View logs:            docker compose -f ${APP_DIR}/docker-compose.yml logs -f"
echo "  - Manual update:        ${APP_DIR}/update.sh"
echo "  - Backup database:      ${APP_DIR}/backup.sh"
echo "  - Stop application:     systemctl stop justmaple"
echo ""
echo "Auto-updates are handled by Watchtower (checks every 24 hours)"
echo ""
warn "Remember to configure your .env file before starting!"
