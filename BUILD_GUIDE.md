# Just Maple Build Guide

## Overview

Just Maple uses a monorepo structure with **Bun workspaces**. The shared TypeBox schemas (`@maple/shared`) must be built before the API or web app can use them.

All scripts now **automatically build `@maple/shared`** when needed - no manual steps required! 🎉

---

## Project Structure

```
just-maple/
├── packages/
│   └── shared/          # @maple/shared - TypeBox schemas
├── apps/
│   ├── api/             # Elysia backend (Bun)
│   └── web/             # Angular frontend
└── package.json         # Root workspace config
```

---

## Development Scripts

### Start Development (Recommended)

**From root directory:**

```bash
bun run dev
```

This will:

1. ✅ Build `@maple/shared` once
2. ✅ Start API server (with watch mode)
3. ✅ Start web dev server (with HMR)

**From individual apps:**

```bash
# API only
cd apps/api
bun run dev          # Builds shared first automatically

# Web only
cd apps/web
bun run start        # Builds shared first automatically
```

### What Happens Behind the Scenes

All dev scripts use **pre-hooks** to automatically build dependencies:

| Script           | Pre-hook   | What it does                            |
| ---------------- | ---------- | --------------------------------------- |
| `apps/api dev`   | `predev`   | Builds `@maple/shared`                  |
| `apps/web start` | `prestart` | Builds `@maple/shared`                  |
| Root `dev`       | Inline     | Builds `@maple/shared` then starts both |

---

## Production Build Scripts

### Build Everything

**From root:**

```bash
bun run build
```

Build order:

1. `packages/shared` → Compile TypeBox schemas
2. `apps/api` → Bundle Elysia backend
3. `apps/web` → Build Angular app

### Build Individual Apps

**API:**

```bash
cd apps/api
bun run build        # Builds shared first automatically
```

**Web (different configs):**

```bash
cd apps/web
bun run build                # Development build
bun run build:paperbark      # Self-hosted config
bun run build:production     # Production (Azure) config
```

All automatically build `@maple/shared` first!

### Build for Native App

**From root:**

```bash
bun run build:web:paperbark
```

This builds the web app with paperbark configuration for self-hosted deployment.

The native app loads the web app from the server (production, localhost, or custom). A minimal `offline.html` fallback is bundled for first-launch scenarios.

**Service worker handles offline support** - no need to bundle the full app! 🚀

---

## Quick Reference

### Common Tasks

| Task                  | Command                         |
| --------------------- | ------------------------------- |
| **Start dev servers** | `bun run dev` (from root)       |
| **Start API only**    | `cd apps/api && bun run dev`    |
| **Start web only**    | `cd apps/web && bun run start`  |
| **Build everything**  | `bun run build` (from root)     |
| **Type check**        | `bun run typecheck` (from root) |
| **Format code**       | `bun run format` (from root)    |
| **Run tests**         | `bun run test` (from root)      |

### Build Configurations (Web)

| Config             | Environment | Use Case              |
| ------------------ | ----------- | --------------------- |
| `build`            | Development | Local testing         |
| `build:paperbark`  | Self-hosted | Self-hosted servers   |
| `build:production` | Azure       | Production deployment |

---

## Package Scripts Breakdown

### Root (`package.json`)

```json
{
    "dev": "build:shared && (dev:api & dev:web)",
    "build": "build:shared && build:api && build:web",
    "build:native": "build:web:paperbark && copy:native"
}
```

### API (`apps/api/package.json`)

```json
{
    "predev": "bun run --cwd ../../packages/shared build",
    "dev": "bun run --watch src/index.ts",
    "build": "bun run --cwd ../../packages/shared build && bun build ..."
}
```

### Web (`apps/web/package.json`)

```json
{
    "prestart": "bun run --cwd ../../packages/shared build",
    "start": "ng serve --host 0.0.0.0 --port 4200",
    "build": "bun run --cwd ../../packages/shared build && ng build"
}
```

---

## How It Works

### Pre-hooks (Development)

Bun/npm automatically runs `pre<script>` before `<script>`:

```bash
bun run dev       # Automatically runs predev first
bun run start     # Automatically runs prestart first
```

So when you run `bun run dev` in `apps/api`, it:

1. Runs `predev` → Builds `@maple/shared`
2. Runs `dev` → Starts the API server with watch mode

### Build Chain (Production)

Production builds use explicit chaining with `&&`:

```bash
bun run build:shared && bun run build:api && bun run build:web
```

This ensures:

1. Schemas are compiled first
2. API can import types from `@maple/shared`
3. Web can import types from `@maple/shared`

---

## Watch Mode (Development)

During development, you don't need to rebuild `@maple/shared` on every change:

- **API**: Bun's `--watch` mode reads TypeScript directly
- **Web**: Angular's dev server reads TypeScript directly via project references

`@maple/shared` is built **once** when you start the dev server, then:

- Both apps read the `.ts` source files directly
- Changes to shared types are picked up automatically
- No rebuild needed during development! ⚡

---

## Troubleshooting

### "Cannot find module '@maple/shared'"

**Solution**: Build the shared package:

```bash
cd packages/shared
bun run build
```

Or just run any dev/build script - it will build it automatically!

### Stale Types

If you're seeing old types from `@maple/shared`:

```bash
# Clean and rebuild
rm -rf packages/shared/dist
bun run build:shared
```

### Build Fails

Check the build order:

```bash
# Always build shared first
bun run build:shared

# Then build apps
bun run build:api
bun run build:web
```

Or just use the root build script:

```bash
bun run build  # Builds in correct order
```

---

## Tips

✅ **Always use the provided scripts** - They handle dependencies automatically
✅ **Run from root** - `bun run dev` is the easiest way to start
✅ **Use `build:native`** - Don't manually copy web builds to native app
✅ **Pre-hooks are automatic** - Bun runs them automatically, no manual steps

❌ **Don't manually build shared** - Scripts handle it automatically
❌ **Don't run `ng serve` directly** - Use `bun run start` instead (builds shared first)
❌ **Don't forget to rebuild** - After pulling changes, run `bun run build:shared`

---

## Summary

**Development:**

```bash
bun run dev              # Builds shared, starts everything
```

**Production:**

```bash
bun run build            # Builds shared, api, web in order
bun run build:native     # Builds for iOS/macOS app
```

**Individual apps:**

- All scripts automatically build `@maple/shared` first
- No manual dependency management needed
- Just run `bun run dev` or `bun run build`! 🚀

## Angular 22 messaging UI

The web app uses Angular 22.1.5 and TypeScript 6.0. Use Node 24.15.0
(`.node-version`) with Bun; the supported Node range is also in `package.json`.
CI and the container builder provision this runtime. Run `bun install`, then
`bun run build` from the repository root.

Bot settings provide a default model and automatic UI or text-only replies.
Choose the reply model in the bot registration or edit dialog. Claude and OpenAI
model options are fetched from the provider using the API key entered in the dialog
or the bot’s saved key. Saved keys remain on the server.
Interactive replies appear in the bot's thread; buttons and forms send explicit
follow-up messages using that bot's saved model setting.

OpenUI's Angular renderer (`@openuidev/angular-lang` 0.4.2) currently uses
`@openuidev/lang-core` 0.4.1 rather than Lang 1.0. The server validates model
output into versioned blocks. The client reconstructs static renderer input from
those blocks, preserving previously saved replies and preventing execution of
raw model-generated expressions. Components use Maple theme tokens.
See [the upstream Angular renderer](https://github.com/thesysdev/openui/tree/main/packages/angular-lang).

Focused checks:

```sh
bun run --cwd apps/api test src/services/__tests__/bot-ui.service.test.ts src/services/__tests__/bot-executor-ui.test.ts src/repositories/__tests__/message-bot-ui.repo.test.ts
cd apps/web
bunx vitest run src/app/components/atoms/bot-ui/bot-ui.component.spec.ts src/app/components/organisms/chat/thread-panel/thread-panel.component.spec.ts
```

Provider tests mock network responses. Live generation requires the user's
provider API key in bot settings.
