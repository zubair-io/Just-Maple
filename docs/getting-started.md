# Getting Started

This guide will help you set up the Just Maple development environment and run the application locally.

## Prerequisites

Before you begin, ensure you have the following installed:

| Requirement | Version                | Installation                                                            |
| ----------- | ---------------------- | ----------------------------------------------------------------------- |
| **Bun**     | 1.0+                   | [bun.sh](https://bun.sh)                                                |
| **Node.js** | 18+ (for some tooling) | [nodejs.org](https://nodejs.org)                                        |
| **MongoDB** | 6.0+ or 7.0            | [mongodb.com](https://www.mongodb.com/try/download/community) or Docker |
| **Git**     | Latest                 | [git-scm.com](https://git-scm.com)                                      |

### Optional (for native development)

| Requirement       | Version | Platform                  |
| ----------------- | ------- | ------------------------- |
| **Xcode**         | 15.0+   | macOS (for iOS/macOS app) |
| **iOS Simulator** | iOS 17+ | macOS                     |

---

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/your-org/just-maple.git
cd just-maple
```

### 2. Install Dependencies

```bash
bun install
```

This installs dependencies for all workspaces:

- `packages/shared` - Shared TypeBox schemas
- `apps/api` - Elysia backend
- `apps/web` - Angular frontend

### 3. Start MongoDB

**Option A: Using Docker (recommended)**

```bash
docker run -d -p 27017:27017 --name mongodb mongo:7
```

**Option B: Local MongoDB installation**

```bash
# macOS with Homebrew
brew services start mongodb-community

# Linux
sudo systemctl start mongod
```

### 4. Configure Environment

Copy the example environment file:

```bash
cp apps/api/.env.example apps/api/.env
```

Edit `apps/api/.env` with your configuration:

```env
# Server
PORT=7071
MONGODB_URI=mongodb://localhost:27017/maple

# Authentication
JWT_SECRET=your-secure-secret-key-here
RP_NAME=Just Maple
RP_ID=localhost
ORIGIN=http://localhost:4200


# Optional: Push Notifications
APNS_KEY_ID=your-key-id
APNS_TEAM_ID=your-team-id
APNS_KEY=your-private-key
```

### 5. Start Development Servers

```bash
bun run dev
```

This single command:

1. Builds the shared package (`@maple/shared`)
2. Starts the API server at `http://localhost:7071`
3. Starts the web dev server at `http://localhost:4200`

---

## Verify Installation

### Check API Health

```bash
curl http://localhost:7071/server/info
```

Expected response:

```json
{
    "name": "Just Maple",
    "version": "1.0.0",
    "status": "ok"
}
```

### Access Web App

Open [http://localhost:4200](http://localhost:4200) in your browser.

You should see the login page with options for:

- Passkey signup and sign-in
- Passkey login (if supported by your browser)

---

## Project Structure

```
just-maple/
├── apps/
│   ├── api/                    # Backend (PaperbarkMaple)
│   │   ├── src/
│   │   │   ├── index.ts        # Server entry point
│   │   │   ├── config.ts       # Environment config
│   │   │   ├── db/             # Database connection
│   │   │   ├── routes/         # API endpoints
│   │   │   ├── repositories/   # Data access layer
│   │   │   ├── services/       # Business logic
│   │   │   └── ws/             # WebSocket handlers
│   │   └── package.json
│   │
│   ├── web/                    # Frontend (SugarMaple)
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── components/ # UI components
│   │   │   │   ├── pages/      # Route pages
│   │   │   │   ├── services/   # Angular services
│   │   │   │   └── guards/     # Route guards
│   │   │   └── environments/   # Env configs
│   │   └── package.json
│   │
│   └── apple/                  # Native app (RedSunsetMaple)
│       ├── JapaneseMaple/      # iOS app
│       └── JapaneseMaple.xcodeproj
│
├── packages/
│   └── shared/                 # Shared types (@maple/shared)
│       └── src/schemas/        # TypeBox schemas
│
├── docs/                       # Documentation
├── e2e/                        # E2E tests
└── package.json                # Root workspace
```

---

## Development Commands

### Running Servers

| Command           | Description           |
| ----------------- | --------------------- |
| `bun run dev`     | Start all dev servers |
| `bun run dev:api` | Start API only        |
| `bun run dev:web` | Start web only        |

### Building

| Command                    | Description             |
| -------------------------- | ----------------------- |
| `bun run build`            | Build all packages      |
| `bun run build:api`        | Build API               |
| `bun run build:web`        | Build web (development) |
| `bun run build:production` | Build web (production)  |
| `bun run build:paperbark`  | Build web (self-hosted) |

### Code Quality

| Command             | Description                  |
| ------------------- | ---------------------------- |
| `bun run format`    | Format code with Prettier    |
| `bun run typecheck` | Run TypeScript type checking |
| `bun run lint`      | Run ESLint                   |

### Testing

| Command                 | Description              |
| ----------------------- | ------------------------ |
| `bun run test`          | Run all unit tests       |
| `bun run test:watch`    | Run tests in watch mode  |
| `bun run test:coverage` | Generate coverage report |
| `bun run e2e`           | Run Playwright E2E tests |

---

## Development Workflow

### 1. Create a Feature Branch

```bash
git checkout -b feat/my-new-feature
```

### 2. Make Changes

- Edit files in `apps/web/` for frontend changes
- Edit files in `apps/api/` for backend changes
- Edit files in `packages/shared/` for shared types

### 3. Run Tests

```bash
bun run test
```

### 4. Format Code

```bash
bun run format
```

### 5. Commit Changes

```bash
git add .
git commit -m "feat: add my new feature"
```

### 6. Push and Create PR

```bash
git push -u origin feat/my-new-feature
```

---

## Troubleshooting

### "Cannot find module '@maple/shared'"

The shared package needs to be built first:

```bash
cd packages/shared
bun run build
```

Or simply run any dev command - it builds automatically:

```bash
bun run dev
```

### MongoDB Connection Failed

1. Check if MongoDB is running:

    ```bash
    # Docker
    docker ps | grep mongo

    # Local
    mongosh --eval "db.adminCommand('ping')"
    ```

2. Verify your `MONGODB_URI` in `.env`

### Port Already in Use

Kill the process using the port:

```bash
# macOS/Linux
lsof -ti :7071 | xargs kill -9
lsof -ti :4200 | xargs kill -9
```

### Hot Reload Not Working

1. Check that you're using `bun run dev` (not `ng serve` directly)
2. Clear Angular cache:
    ```bash
    rm -rf apps/web/.angular
    ```

---

## Next Steps

- Read the [Architecture Overview](./architecture.md) to understand the system design
- Explore the [Web App Guide](./web-app.md) for frontend development
- Check the [API Guide](./api.md) for backend development
- Review [Best Practices](./best-practices.md) for coding standards

---

_See the [BUILD_GUIDE.md](../BUILD_GUIDE.md) in the root directory for more detailed build information._
