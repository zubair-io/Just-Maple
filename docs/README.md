# Just Maple Documentation

Welcome to the Just Maple documentation. This guide covers everything you need to know about developing, testing, and deploying the Just Maple platform.

## What is Just Maple?

Just Maple is a self-hosted note-taking and collaboration platform featuring:

- **Passwordless Authentication** - Passkeys (WebAuthn) and magic links
- **Tag-Based Organization** - Folders with permissions and chat containers
- **Living Documents** - Reactive widgets with AI workflows
- **Multi-Server Support** - Native apps connect to user's chosen servers
- **Privacy-First** - Push notifications contain only IDs, never content
- **Offline-First** - Full functionality without network, sync when connected

## Component Codenames

| Component                | Codename           | Technology        |
| ------------------------ | ------------------ | ----------------- |
| Backend API              | **PaperbarkMaple** | Bun + Elysia      |
| Web App                  | **SugarMaple**     | Angular 21        |
| Apple Apps (macOS + iOS) | **RedSunsetMaple** | Swift + WKWebView |
| Shared Types             | `@maple/shared`    | TypeBox           |

---

## Documentation Index

### Getting Started

- [**Getting Started Guide**](./getting-started.md) - Quick setup and first steps
- [**Architecture Overview**](./architecture.md) - System design and data flow

### Platform Documentation

- [**Web App (SugarMaple)**](./web-app.md) - Angular frontend development
- [**API (PaperbarkMaple)**](./api.md) - Elysia backend development
- [**iOS/macOS App (RedSunsetMaple)**](./ios-app.md) - Native Apple app development

### Development Guides

- [**Build & Deployment**](./deployment.md) - Building, deploying, and CI/CD
- [**Testing Guide**](./testing.md) - Unit, integration, and E2E testing
- [**Best Practices**](./best-practices.md) - Code style, patterns, and conventions

### Feature Documentation

- [**v0.9 Features**](./v0.9-features.md) - AI Writing Assistant, Templates, Bi-directional Linking, Memo Versioning, Full-text Search

### Additional Resources

- [**Bot System Integration**](./bot-system-integration-plan.md) - AI bot integration
- [**AutumnBlaze Migration**](./autumnblaze-migration.md) - SignalR migration docs

---

## Quick Links

### Common Tasks

| Task                 | Command             |
| -------------------- | ------------------- |
| Start development    | `bun run dev`       |
| Run tests            | `bun run test`      |
| Build for production | `bun run build`     |
| Format code          | `bun run format`    |
| Type check           | `bun run typecheck` |

### Project Structure

```
just-maple/
├── apps/
│   ├── api/          # Elysia backend (PaperbarkMaple)
│   ├── web/          # Angular frontend (SugarMaple)
│   └── apple/        # iOS/macOS app (RedSunsetMaple)
├── packages/
│   └── shared/       # Shared TypeBox schemas (@maple/shared)
├── docs/             # Documentation (you are here)
├── e2e/              # Playwright E2E tests
└── designs/          # Figma exports
```

---

## Tech Stack Overview

| Layer         | Technology          | Purpose                        |
| ------------- | ------------------- | ------------------------------ |
| **Runtime**   | Bun                 | Fast TypeScript execution      |
| **API**       | Elysia              | TypeScript-first web framework |
| **Database**  | MongoDB             | Document storage               |
| **Frontend**  | Angular 21          | SPA with signals               |
| **Styling**   | Tailwind CSS        | Utility-first CSS              |
| **Editor**    | TipTap              | Rich text editing              |
| **Auth**      | WebAuthn + JWT      | Passwordless authentication    |
| **Real-time** | WebSocket + Yjs     | Live collaboration             |
| **Native**    | Swift + WKWebView   | iOS/macOS apps                 |
| **Testing**   | Vitest + Playwright | Unit, integration, E2E         |

---

## Contributing

1. Read the [Best Practices](./best-practices.md) guide
2. Follow the [Getting Started](./getting-started.md) setup
3. Run tests before submitting PRs
4. Use conventional commit messages

### Commit Message Format

```
type: short description

Longer description if needed.
```

**Types:** `feat`, `fix`, `refactor`, `docs`, `test`, `chore`

---

## Support

- **Issues:** [GitHub Issues](https://github.com/your-org/just-maple/issues)
- **Discussions:** [GitHub Discussions](https://github.com/your-org/just-maple/discussions)

---

_Last updated: January 2026_
