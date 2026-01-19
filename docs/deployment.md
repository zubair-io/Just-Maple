# Deployment Guide

This guide covers building, deploying, and maintaining Just Maple in production environments.

## Overview

Just Maple supports two deployment models:

1. **Azure (Production)** - Azure Container Apps with Cosmos DB
2. **Self-Hosted (Paperbark)** - Proxmox LXC with local MongoDB

---

## Build Process

### Build Order

Dependencies must be built in order:

```bash
# 1. Build shared types
bun run build:shared

# 2. Build API
bun run build:api

# 3. Build Web (choose one)
bun run build:production     # Azure deployment
bun run build:paperbark      # Self-hosted
```

Or use the all-in-one command:

```bash
bun run build
```

### Build Outputs

| Package          | Output Path                    |
| ---------------- | ------------------------------ |
| `@maple/shared`  | `packages/shared/dist/`        |
| API              | `apps/api/dist/`               |
| Web (production) | `apps/web/dist/`               |
| Web (paperbark)  | `apps/api/dist/web/paperbark/` |

### Web Build Configurations

| Configuration      | Environment | Use Case              |
| ------------------ | ----------- | --------------------- |
| `build`            | Development | Local testing         |
| `build:paperbark`  | Paperbark   | Self-hosted servers   |
| `build:production` | Azure       | Production deployment |

---

## Azure Deployment

### Prerequisites

- Azure subscription
- Azure CLI installed
- GitHub Actions configured

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Azure Resource Group                          │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              Azure Container Apps Environment              │ │
│  │                                                            │ │
│  │  ┌────────────────┐    ┌────────────────┐                 │ │
│  │  │  API Container │    │ Web Container  │                 │ │
│  │  │  (PaperbarkMaple) │    │ (SugarMaple)   │                 │ │
│  │  └────────┬───────┘    └────────────────┘                 │ │
│  └───────────┼────────────────────────────────────────────────┘ │
│              │                                                   │
│  ┌───────────▼───────┐    ┌────────────────────┐               │
│  │    Cosmos DB      │    │  Azure Comm Svcs   │               │
│  │   (MongoDB API)   │    │  (Email)           │               │
│  └───────────────────┘    └────────────────────┘               │
│                                                                  │
│  ┌───────────────────┐    ┌────────────────────┐               │
│  │    Key Vault      │    │  Blob Storage      │               │
│  │   (Secrets)       │    │  (Media)           │               │
│  └───────────────────┘    └────────────────────┘               │
└─────────────────────────────────────────────────────────────────┘
```

### Container Apps Configuration

```yaml
# Container App configuration
resources:
    cpu: 0.5
    memory: 1Gi

scale:
    minReplicas: 0
    maxReplicas: 10
    rules:
        - name: http-rule
          http:
              metadata:
                  concurrentRequests: 100
```

### Environment Variables

Set these in Azure Container Apps:

```env
# Server
PORT=7071
NODE_ENV=production

# Database
MONGODB_URI=<from-key-vault>

# Authentication
JWT_SECRET=<from-key-vault>
RP_NAME=Just Maple
RP_ID=justmaple.app
ORIGIN=https://justmaple.app

# CORS
CORS_ORIGINS=https://justmaple.app,https://www.justmaple.app

# Email
AZURE_COMMUNICATION_CONNECTION_STRING=<from-key-vault>
EMAIL_FROM=noreply@justmaple.app

# Push Notifications
APNS_KEY_ID=<from-key-vault>
APNS_TEAM_ID=<from-key-vault>
APNS_KEY=<from-key-vault>

# Redis (for multi-replica)
REDIS_URL=<from-key-vault>

# External Services
REBRICKABLE_API_KEY=<from-key-vault>
BRIGHT_DATA_API_KEY=<from-key-vault>
CLAUDE_API_KEY=<from-key-vault>
```

### GitHub Actions Workflow

```yaml
# .github/workflows/deploy-api.yml
name: Deploy API

on:
    push:
        branches: [main]
        paths:
            - 'apps/api/**'
            - 'packages/shared/**'

jobs:
    build-and-deploy:
        runs-on: ubuntu-latest

        steps:
            - uses: actions/checkout@v4

            - uses: oven-sh/setup-bun@v1
              with:
                  bun-version: latest

            - name: Install dependencies
              run: bun install

            - name: Build
              run: bun run build

            - name: Login to Azure
              uses: azure/login@v2
              with:
                  creds: ${{ secrets.AZURE_CREDENTIALS }}

            - name: Build and push container
              run: |
                  az acr build \
                    --registry ${{ secrets.ACR_NAME }} \
                    --image paperbarkmaple:${{ github.sha }} \
                    --file apps/api/Dockerfile .

            - name: Deploy to Container Apps
              run: |
                  az containerapp update \
                    --name paperbarkmaple \
                    --resource-group just-maple-rg \
                    --image ${{ secrets.ACR_NAME }}.azurecr.io/paperbarkmaple:${{ github.sha }}
```

### Dockerfile

```dockerfile
# apps/api/Dockerfile
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lockb ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
COPY tsconfig.base.json ./

# Build
RUN bun run build:shared && bun run build:api

# Production image
FROM oven/bun:1-slim

WORKDIR /app

COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 7071

CMD ["bun", "run", "dist/index.js"]
```

---

## Self-Hosted Deployment (Paperbark)

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Proxmox Host                                │
│                                                                  │
│  ┌─────────────────────┐    ┌─────────────────────┐            │
│  │  LXC: api           │    │  LXC: mongodb       │            │
│  │  192.168.50.20      │    │  192.168.50.10      │            │
│  │                     │    │                     │            │
│  │  - Bun runtime      │───▶│  - MongoDB 7        │            │
│  │  - PaperbarkMaple   │    │  - Auth enabled     │            │
│  │  - systemd managed  │    │                     │            │
│  │  Port: 7071         │    │  Port: 27017        │            │
│  └─────────────────────┘    └─────────────────────┘            │
│                                                                  │
│  ┌─────────────────────┐                                       │
│  │  Reverse Proxy      │                                       │
│  │  (Caddy)            │                                       │
│  │  - SSL termination  │                                       │
│  │  - WebSocket proxy  │                                       │
│  └─────────────────────┘                                       │
└─────────────────────────────────────────────────────────────────┘
```

### MongoDB Setup

```bash
# Install MongoDB 7
wget -qO- https://www.mongodb.org/static/pgp/server-7.0.asc | sudo tee /etc/apt/trusted.gpg.d/server-7.0.asc
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt update
sudo apt install -y mongodb-org

# Enable auth
sudo vim /etc/mongod.conf
# security:
#   authorization: enabled

# Create admin user
mongosh
> use admin
> db.createUser({
    user: "admin",
    pwd: "secure-password",
    roles: ["root"]
  })

# Create app user
> use maple
> db.createUser({
    user: "api",
    pwd: "api-password",
    roles: [{ role: "readWrite", db: "maple" }]
  })

# Restart
sudo systemctl restart mongod
```

### Bun Installation

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# Verify
bun --version
```

### Application Setup

```bash
# Clone repository
cd /opt
git clone https://github.com/your-org/just-maple.git
cd just-maple

# Install dependencies
bun install

# Build
bun run build:shared
bun run build:api
bun run build:paperbark

# Copy web build to API
cp -r apps/web/dist/paperbark/* apps/api/dist/web/
```

### Systemd Service

```ini
# /etc/systemd/system/paperbarkmaple.service
[Unit]
Description=PaperbarkMaple API
After=network.target mongod.service
Wants=mongod.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/just-maple/apps/api
ExecStart=/root/.bun/bin/bun run dist/index.js
Restart=always
RestartSec=5

Environment=NODE_ENV=production
Environment=PORT=7071
Environment=MONGODB_URI=mongodb://api:password@192.168.50.10:27017/maple
Environment=JWT_SECRET=your-secret
Environment=RP_NAME=Just Maple
Environment=RP_ID=maple.local
Environment=ORIGIN=https://maple.local
Environment=CORS_ORIGINS=https://maple.local

[Install]
WantedBy=multi-user.target
```

```bash
# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable paperbarkmaple
sudo systemctl start paperbarkmaple

# Check status
sudo systemctl status paperbarkmaple
```

### Caddy Reverse Proxy

```caddyfile
# /etc/caddy/Caddyfile
maple.local {
    reverse_proxy localhost:7071

    # WebSocket support
    @websocket {
        header Connection *Upgrade*
        header Upgrade websocket
    }
    reverse_proxy @websocket localhost:7071
}
```

```bash
sudo systemctl restart caddy
```

---

## iOS App Deployment

### TestFlight

1. **Archive the app**
    - Product > Archive in Xcode

2. **Upload to App Store Connect**
    - Distribute App > App Store Connect > Upload

3. **Submit for TestFlight review**
    - App Store Connect > TestFlight > Submit for Review

### App Store

1. **Prepare metadata**
    - Screenshots (all device sizes)
    - App description
    - Keywords
    - Privacy policy URL

2. **Submit for App Review**
    - App Store Connect > App Store > Submit for Review

### Build Settings

| Setting      | Development    | TestFlight    | App Store     |
| ------------ | -------------- | ------------- | ------------- |
| API URL      | localhost:4200 | justmaple.app | justmaple.app |
| Debug        | Enabled        | Disabled      | Disabled      |
| Optimization | None           | Optimized     | Optimized     |

---

## CI/CD Pipeline

### GitHub Actions

```yaml
# .github/workflows/ci.yml
name: CI

on:
    push:
        branches: [main, develop]
    pull_request:
        branches: [main]

jobs:
    lint-and-test:
        runs-on: ubuntu-latest
        steps:
            - uses: actions/checkout@v4

            - uses: oven-sh/setup-bun@v1
              with:
                  bun-version: latest

            - name: Install dependencies
              run: bun install

            - name: Type check
              run: bun run typecheck

            - name: Lint
              run: bun run lint

            - name: Test
              run: bun run test:coverage

            - name: Upload coverage
              uses: codecov/codecov-action@v4

    e2e-tests:
        runs-on: ubuntu-latest
        needs: lint-and-test
        steps:
            - uses: actions/checkout@v4

            - uses: oven-sh/setup-bun@v1

            - name: Install dependencies
              run: bun install

            - name: Install Playwright
              run: bunx playwright install --with-deps

            - name: Start MongoDB
              uses: supercharge/mongodb-github-action@v1.10.0
              with:
                  mongodb-version: '7.0'

            - name: Run E2E tests
              run: bun run e2e
              env:
                  MONGODB_URI: mongodb://localhost:27017/maple-test
                  JWT_SECRET: test-secret

            - name: Upload results
              if: always()
              uses: actions/upload-artifact@v4
              with:
                  name: playwright-report
                  path: playwright-report/
```

---

## Monitoring & Logging

### Health Checks

```bash
# API health
curl https://api.justmaple.app/server/info

# Expected response
{
  "name": "Just Maple",
  "version": "1.0.0",
  "status": "ok"
}
```

### Logging

```typescript
// Structured logging
console.log(
    JSON.stringify({
        level: 'info',
        message: 'Request processed',
        path: req.path,
        method: req.method,
        duration: Date.now() - start,
        userId: auth?.userId,
    }),
);
```

### Azure Application Insights

```typescript
import { ApplicationInsights } from '@applicationinsights/web';

const appInsights = new ApplicationInsights({
    config: {
        connectionString: process.env.APPINSIGHTS_CONNECTION_STRING,
    },
});
appInsights.loadAppInsights();
```

---

## Backup & Recovery

### MongoDB Backup

```bash
# Daily backup script
#!/bin/bash
DATE=$(date +%Y%m%d)
mongodump --uri="mongodb://admin:password@localhost:27017" --out=/backups/mongo/$DATE
tar -czf /backups/mongo/$DATE.tar.gz /backups/mongo/$DATE
rm -rf /backups/mongo/$DATE

# Keep 30 days
find /backups/mongo -name "*.tar.gz" -mtime +30 -delete
```

### Restore

```bash
mongorestore --uri="mongodb://admin:password@localhost:27017" /backups/mongo/20240115
```

---

## Security Checklist

### Production Readiness

- [ ] HTTPS enabled everywhere
- [ ] JWT secret is strong and unique
- [ ] MongoDB authentication enabled
- [ ] CORS configured correctly
- [ ] Rate limiting enabled
- [ ] Secrets in Key Vault/environment
- [ ] Logging excludes sensitive data
- [ ] Error messages don't leak details

### Updates

```bash
# Update Bun
bun upgrade

# Update dependencies
bun update

# Check for vulnerabilities
bun audit
```

---

## Rollback Procedures

### Azure Container Apps

```bash
# List revisions
az containerapp revision list \
  --name paperbarkmaple \
  --resource-group just-maple-rg

# Activate previous revision
az containerapp revision activate \
  --name paperbarkmaple \
  --resource-group just-maple-rg \
  --revision paperbarkmaple--abc123
```

### Self-Hosted

```bash
# Keep previous version
mv /opt/just-maple /opt/just-maple.bak

# Restore previous version
mv /opt/just-maple.bak /opt/just-maple

# Restart service
sudo systemctl restart paperbarkmaple
```

---

## Next Steps

- [Testing Guide](./testing.md) - Pre-deployment testing
- [Best Practices](./best-practices.md) - Production patterns
- [Architecture](./architecture.md) - System design
