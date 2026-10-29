# Angular 22 requires Node 24.15 or newer in the build environment.
FROM node:24.15.0-bookworm-slim AS node-runtime

# Build stage
FROM oven/bun:1.4.3 AS builder
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node

WORKDIR /app

# Copy workspace package files and tsconfig
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/whiteboard/package.json ./packages/whiteboard/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# Install dependencies
RUN bun install

# Copy source code
COPY packages/shared ./packages/shared
COPY packages/whiteboard ./packages/whiteboard
COPY apps/api ./apps/api
COPY apps/web ./apps/web

# Build shared package
WORKDIR /app/packages/shared
RUN bun run build

# Build API (mark sharp as external since it requires native binaries at runtime)
WORKDIR /app/apps/api
RUN bun run build

# Build Web (paperbark config outputs to apps/api/dist/web/paperbark)
WORKDIR /app/apps/web
RUN bun run build:paperbark

# Production stage
FROM oven/bun:1.4.3

WORKDIR /app

# Install wget for health checks (curl is pre-installed in bun:latest)
RUN apt-get update && apt-get install -y --no-install-recommends wget && rm -rf /var/lib/apt/lists/*

# Copy built API and frontend files
COPY --from=builder /app/apps/api/dist ./dist

# Install native modules that can't be bundled
# sharp requires platform-specific binaries
RUN bun add sharp@0.34.5

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:7071/api/health || exit 1

ENV HOST=0.0.0.0

EXPOSE 7071

# Run from dist directory so public/browser is found
WORKDIR /app/dist
CMD ["bun", "run", "index.js"]
