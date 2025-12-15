# Build stage
FROM oven/bun:1.1-alpine AS builder

WORKDIR /app

# Copy workspace package files
COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# Build shared package
WORKDIR /app/packages/shared
RUN bun run build

# Build API
WORKDIR /app/apps/api
RUN bun build src/index.ts --outdir dist --target bun --minify

# Production stage
FROM oven/bun:1.1-alpine

WORKDIR /app

# Install wget for health checks
RUN apk add --no-cache wget

# Copy built files and dependencies
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/package.json ./
COPY --from=builder /app/node_modules ./node_modules

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:7071/api/health || exit 1

EXPOSE 7071

CMD ["bun", "run", "dist/index.js"]
