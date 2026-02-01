# Deploying Just Maple on Proxmox

This guide covers deploying Just Maple on Proxmox VE with automatic updates.

## Deployment Options

| Option                      | Proxmox Version | Best For                   | Compose Support | Auto-Updates |
| --------------------------- | --------------- | -------------------------- | --------------- | ------------ |
| **Docker VM** (Recommended) | Any             | Production, full stack     | Yes             | Watchtower   |
| **Native OCI**              | 9.1+            | Single containers, testing | No              | Manual       |

**Recommendation**: Use the Docker VM approach for Just Maple since it requires multiple services (API, MongoDB, Redis) that work together via Docker Compose.

---

## Option A: Docker VM (Recommended)

This approach runs a lightweight VM with Docker installed, supporting the full docker-compose stack.

### Step 1: Create VM in Proxmox

1. Download a cloud image (Debian 12 or Ubuntu 24.04 recommended)
2. Create VM with these minimum specs:
    - **CPU**: 2 cores
    - **RAM**: 2GB (4GB recommended)
    - **Disk**: 20GB
    - **Network**: Bridge to your LAN

**Via Proxmox UI:**

```
Datacenter → Create VM →
  OS: Upload ISO or use cloud image
  System: QEMU Agent enabled
  Disks: 20GB minimum
  CPU: 2 cores
  Memory: 2048MB
```

**Via CLI:**

```bash
# Create VM (adjust storage and network as needed)
qm create 100 --name justmaple --memory 2048 --cores 2 \
  --net0 virtio,bridge=vmbr0 \
  --scsihw virtio-scsi-pci --scsi0 local-lvm:20

# Import cloud image (example with Debian)
wget https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.qcow2
qm importdisk 100 debian-12-genericcloud-amd64.qcow2 local-lvm
qm set 100 --scsi0 local-lvm:vm-100-disk-0
qm set 100 --boot c --bootdisk scsi0
```

### Step 2: Install Docker and Just Maple

SSH into your VM and run the setup script:

```bash
# Download and run setup script
curl -fsSL https://raw.githubusercontent.com/justmapleapp/Just-Maple/main/deploy/proxmox/setup-docker-vm.sh | sudo bash
```

Or manually:

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Create app directory
sudo mkdir -p /opt/justmaple
cd /opt/justmaple

# Download compose file
curl -fsSL https://raw.githubusercontent.com/justmapleapp/Just-Maple/main/deploy/proxmox/docker-compose.prod.yml -o docker-compose.yml
curl -fsSL https://raw.githubusercontent.com/justmapleapp/Just-Maple/main/deploy/proxmox/.env.example -o .env

# Configure
nano .env  # Edit your settings

# Start
docker compose up -d
```

### Step 3: Configure Environment

Edit `/opt/justmaple/.env`:

```bash
# REQUIRED
JWT_SECRET=your-secure-random-string    # Generate: openssl rand -base64 32
RP_NAME=Just Maple
RP_ID=maple.yourdomain.com              # Your domain (no https://)
ORIGIN=https://maple.yourdomain.com     # Full URL with protocol
```

### Step 4: Start the Application

```bash
cd /opt/justmaple
docker compose up -d
```

Access Just Maple at `http://YOUR-VM-IP:7071`

### Auto-Updates with Watchtower

The docker-compose includes Watchtower which automatically:

- Checks for new images every 24 hours
- Pulls and restarts updated containers
- Cleans up old images

To manually trigger an update:

```bash
cd /opt/justmaple
docker compose pull
docker compose up -d
```

### Useful Commands

```bash
# View status
docker compose ps

# View logs
docker compose logs -f api

# Backup MongoDB
docker exec justmaple-mongodb mongodump --archive=/data/db/backup.archive
docker cp justmaple-mongodb:/data/db/backup.archive ./backup.archive

# Restore MongoDB
docker cp backup.archive justmaple-mongodb:/data/db/backup.archive
docker exec justmaple-mongodb mongorestore --archive=/data/db/backup.archive

# Stop all services
docker compose down

# Stop and remove all data (DESTRUCTIVE)
docker compose down -v
```

---

## Option B: Native OCI Containers (Proxmox 9.1+)

Proxmox 9.1 introduced experimental support for running Docker/OCI images directly as LXC containers.

> **Note**: This is a tech preview feature. For production workloads requiring multiple containers, Option A is recommended.

### Limitations

- No Docker Compose support
- Updates require recreating containers
- Each service runs as a separate LXC container
- Some images may not work correctly

### Deploy Individual Containers

#### 1. MongoDB Container

```bash
# Pull OCI image
pveam download local docker.io/library/mongo:7

# Create container
pct create 101 local:vztmpl/mongo-7.tar.gz \
  --hostname justmaple-mongodb \
  --memory 1024 \
  --cores 1 \
  --rootfs local-lvm:8 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --unprivileged 1

# Add persistent storage for data
pct set 101 --mp0 local-lvm:4,mp=/data/db

# Start container
pct start 101
```

#### 2. Redis Container

```bash
pveam download local docker.io/library/redis:7-alpine

pct create 102 local:vztmpl/redis-7-alpine.tar.gz \
  --hostname justmaple-redis \
  --memory 256 \
  --cores 1 \
  --rootfs local-lvm:2 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --unprivileged 1

pct start 102
```

#### 3. Just Maple API Container

```bash
# Build and push your image to a registry first
# OR use a local image

pveam download local ghcr.io/justmapleapp/just-maple-api:latest

pct create 103 local:vztmpl/just-maple-api-latest.tar.gz \
  --hostname justmaple-api \
  --memory 512 \
  --cores 2 \
  --rootfs local-lvm:4 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --unprivileged 1

# Set environment variables
pct set 103 --description "MONGODB_URI=mongodb://10.0.0.101:27017/justmaple
REDIS_URL=redis://10.0.0.102:6379
JWT_SECRET=your-secret"

pct start 103
```

### Auto-Updates (Native OCI)

Native OCI containers don't support automatic updates. You need to:

1. Pull the new image
2. Create a new container
3. Migrate data volumes
4. Delete old container

Script for manual updates:

```bash
#!/bin/bash
CTID=103
NEW_CTID=104

# Stop old container
pct stop $CTID

# Pull new image
pveam download local ghcr.io/justmapleapp/just-maple-api:latest --force

# Create new container with same config
# (copy settings from old container)

# Start new container
pct start $NEW_CTID

# Verify and delete old
pct destroy $CTID
```

---

## Reverse Proxy Setup

For HTTPS access, set up a reverse proxy. Options:

### Caddy (Recommended - Automatic HTTPS)

Add to docker-compose.yml or run separately:

```yaml
caddy:
    image: caddy:2-alpine
    ports:
        - '80:80'
        - '443:443'
    volumes:
        - ./Caddyfile:/etc/caddy/Caddyfile
        - caddy_data:/data
```

Create `Caddyfile`:

```
maple.yourdomain.com {
    reverse_proxy api:7071
}
```

### Nginx Proxy Manager

If you already use Nginx Proxy Manager in Proxmox:

1. Create proxy host for your domain
2. Forward to the VM's IP:7071
3. Enable SSL with Let's Encrypt

### Proxmox Built-in (for VMs)

Add a reverse proxy rule in Proxmox if you have a gateway VM.

---

## Backup Strategy

### Docker VM Backups

**Option 1: Proxmox VM Backup**

```bash
# Backup entire VM
vzdump 100 --storage backup-storage --mode snapshot
```

**Option 2: Application-level Backup**

```bash
# MongoDB dump
docker exec justmaple-mongodb mongodump --archive=/backup.archive
docker cp justmaple-mongodb:/backup.archive ./backups/

# Redis (if needed)
docker exec justmaple-redis redis-cli SAVE
docker cp justmaple-redis:/data/dump.rdb ./backups/
```

### Automated Backup Cron

```bash
# Add to /etc/crontab
0 3 * * * root /opt/justmaple/backup.sh
```

---

## Monitoring

### Basic Health Check

```bash
# Check API health
curl http://localhost:7071/api/health

# Check all containers
docker compose ps
```

### With Uptime Kuma (Optional)

Run alongside Just Maple:

```yaml
# Add to docker-compose.yml
uptime-kuma:
    image: louislam/uptime-kuma:1
    volumes:
        - uptime_data:/app/data
    ports:
        - '3001:3001'
```

---

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker compose logs api

# Common issues:
# - MongoDB not ready: increase depends_on healthcheck retries
# - Port conflict: change port mapping in compose file
```

### Database Connection Failed

```bash
# Verify MongoDB is running
docker exec justmaple-mongodb mongosh --eval "db.adminCommand('ping')"

# Check network
docker network inspect justmaple_justmaple
```

### Watchtower Not Updating

```bash
# Check Watchtower logs
docker logs justmaple-watchtower

# Manual update
docker compose pull && docker compose up -d
```

### Native OCI Container Issues

```bash
# Check container status
pct status 103

# View logs
pct exec 103 -- journalctl -f

# Enter container
pct enter 103
```

---

## Architecture Diagram

```
                    ┌─────────────────────────────────────┐
                    │           Proxmox Host              │
                    │                                     │
                    │  ┌───────────────────────────────┐  │
                    │  │        Docker VM (100)        │  │
                    │  │                               │  │
Internet ──────────────│  ┌─────────┐  ┌───────────┐  │  │
      :7071         │  │  │   API   │──│  MongoDB  │  │  │
                    │  │  │  :7071  │  │  :27017   │  │  │
                    │  │  └────┬────┘  └───────────┘  │  │
                    │  │       │                      │  │
                    │  │       │       ┌───────────┐  │  │
                    │  │       └───────│   Redis   │  │  │
                    │  │               │   :6379   │  │  │
                    │  │               └───────────┘  │  │
                    │  │                              │  │
                    │  │  ┌──────────────────────┐    │  │
                    │  │  │     Watchtower       │    │  │
                    │  │  │  (auto-updates)      │    │  │
                    │  │  └──────────────────────┘    │  │
                    │  └───────────────────────────────┘  │
                    └─────────────────────────────────────┘
```
