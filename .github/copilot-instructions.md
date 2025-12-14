# Copilot Instructions for Just-Maple

## Project Overview

**Just Maple** is a self-hosted platform combining documents and conversations, organized by tags that serve as folders, permission boundaries, and chat containers. The system uses passwordless authentication (passkeys + magic links), supports multi-server native apps, privacy-first push notifications, and embedded reactive widgets with AI workflows.

**Current Stage**: Architecture defined, implementation in progress (~92% MVP complete per docs)

## Architecture & Component Boundaries

### Multi-Tenant, Shared Codebase Model

- **Single codebase** deployed per tenant (not multi-tenant database)
- Azure Container Apps OR self-hosted Proxmox LXC deployments
- Native apps connect to user-specified servers (multi-server support)

### Component Codenames & Tech Stack

| Component    | Codename           | Stack                   | Path               |
| ------------ | ------------------ | ----------------------- | ------------------ |
| Backend API  | **PaperbarkMaple** | Bun + Elysia + MongoDB  | `apps/api/`        |
| Web App      | **SugarMaple**     | Angular (v18) + Signals | `apps/web/`        |
| Apple Apps   | **RedSunsetMaple** | Swift + WKWebView       | `apps/apple/`      |
| Shared Types | `@maple/shared`    | TypeBox schemas         | `packages/shared/` |

### Data Flow Pattern

```
Native Shell (Swift/Kotlin) → WKWebView (SugarMaple)
                              ↓ Native Bridge
                              ↓ WebSocket/HTTP
                              ↓
                         PaperbarkMaple API
                              ↓
                         MongoDB
```

## Critical Implementation Patterns

### 1. TypeBox as Single Source of Truth

- **All schemas** in `packages/shared/src/schemas/` using TypeBox
- TypeBox provides BOTH TypeScript types AND runtime validation
- Elysia uses TypeBox for automatic validation
- Pattern: Define schema → use `t.Static<typeof Schema>` for types

```typescript
// Example: packages/shared/src/schemas/tag.ts
export const TagSchema = t.Object({
    _id: t.String(),
    name: t.String(),
    slug: t.String(),
    members: t.Array(TagMemberSchema),
    // ...
});
export type Tag = Static<typeof TagSchema>;
```

### 2. Offline-First Sync Architecture

- **IndexedDB** as local store (via `idb` library)
- Documents have `syncStatus`: `'pending' | 'syncing' | 'synced' | 'failed' | 'conflict'`
- `DocumentSyncService` manages queue-based sync with debouncing
- Conflict detection via `serverVersion` field comparison
- UI shows `ConflictResolverComponent` on conflicts with diff viewer

### 3. Native Bridge Communication

- **Type-safe message passing** between WebView and native Swift/Kotlin
- Schemas in `packages/shared/src/types/bridge.ts`
- Pattern: Web posts message → Native handles → Native posts response
- Key integrations: Audio recording, WhisperKit transcription, Keychain, Push tokens

```typescript
// Web side (apps/web/src/app/bridge/native-bridge.ts)
window.webkit?.messageHandlers.bridge.postMessage({
    type: 'startRecording',
    widgetId: 'xyz',
});
```

### 4. Widget System Architecture

- Widgets are embedded in ProseMirror documents
- Each widget extends `BaseWidget` (see README Widget System section)
- Widget state stored in `note.widgetStates[widgetId]`
- Widgets can emit events and write to document sections
- Built-in widgets: Audio Recorder, Dropdown, AI Summary, etc.

### 5. Tags as Multi-Purpose Primitive

- Tags are NOT just labels—they are **folders + permissions + chat container**
- Each tag has **exactly one chat** (messages collection)
- Each tag has **many notes**
- Member permissions: `owner | admin | member | viewer`
- Tag slugs must be unique per user workspace

## Development Workflows

### Local Development Setup

```bash
bun install                    # Install all workspaces
docker run -d -p 27017:27017 --name mongodb mongo:7  # Local MongoDB
bun run dev:api               # Start PaperbarkMaple (port 7071)
bun run dev:web               # Start SugarMaple (Angular dev server)
```

For native (RedSunsetMaple): Open `apps/apple/RedSunsetMaple.xcodeproj` in Xcode, web dev server auto-reloads

### Building for Native

```bash
bun run build:web:native      # Builds Angular + bundles for iOS/macOS Resources/
```

### Database Indexes (Critical for Performance)

See README "Indexes" section—indexes on:

- `users.email` (unique)
- `tags.slug` (unique), `tags.members.userId`
- `notes.tagId + updatedAt`, `notes.syncStatus`
- `messages.tagId + createdAt`
- `passkeys.credentialId` (unique)
- `magic_links.expiresAt` (TTL index)

## Project-Specific Conventions

### 1. Repository Layer Pattern (PaperbarkMaple)

- All database operations go through repository classes in `apps/api/src/repositories/`
- Pattern: `user.repo.ts`, `tag.repo.ts`, `note.repo.ts`, etc.
- Repositories return TypeBox-validated types
- Use native MongoDB driver (NOT Mongoose)

### 2. Elysia Route Organization

- Routes in `apps/api/src/routes/` by domain: `auth.ts`, `tags.ts`, `notes.ts`, `messages.ts`
- Use Elysia groups for prefixes: `app.group('/tags', (app) => ...)`
- Auth middleware applied via `.use(authMiddleware)`

### 3. Angular Service + Signals Pattern

- Services in `apps/web/src/app/services/`
- Use Angular Signals for reactive state (NOT RxJS BehaviorSubject)
- Elf store for complex state management (see `@ngneat/elf`)
- Pattern: Service exposes signals, components use `computed()` and `effect()`

### 4. Authentication Flow

- **Magic link**: POST `/auth/magic-link` → email sent → GET `/auth/verify?token=xxx` → JWT cookie
- **Passkey**: WebAuthn flow using `@simplewebauthn/browser` + `@simplewebauthn/server`
- JWT stored in httpOnly cookie (web) or Keychain (native)
- No user/password authentication—passkeys and magic links ONLY

### 5. Push Notification Privacy

- Push payloads contain **ONLY IDs**, never content
- iOS Notification Service Extension fetches actual content
- Pattern: `{ type: 'message', tagId: '...', messageId: '...' }`

## Key Integration Points

### WhisperKit (On-Device Transcription)

- Swift-only, runs on-device (privacy-first)
- Service: `apps/apple/RedSunsetMaple/Services/TranscriptionService.swift`
- Recommended model: `base.en` (~140MB, good quality/speed balance)
- Real-time streaming transcription via bridge progress callbacks

### WebSocket for Real-Time Chat

- WebSocket handler: `apps/api/src/ws/handler.ts`
- Messages broadcast to tag members on send
- Reconnection logic in `apps/web/src/app/services/websocket.service.ts`

### TipTap/ProseMirror Editor

- Document content stored as ProseMirror JSON (`note.doc`)
- Schema in `packages/shared/src/schemas/note.ts` (recursive `ProseMirrorNode`)
- Custom extensions for widgets in `apps/web/src/app/components/widgets/`

## Common Pitfalls to Avoid

1. **Don't use Mongoose**: Use native MongoDB driver with TypeBox validation
2. **Don't store tokens in localStorage**: Use httpOnly cookies (web) or Keychain (native)
3. **Don't send content in push notifications**: IDs only, fetch in notification service
4. **Don't ignore sync conflicts**: Always show ConflictResolverComponent to user
5. **Don't use RxJS for new state**: Prefer Angular Signals (existing RxJS OK)
6. **Don't hardcode server URLs**: Native apps must support multi-server configuration

## Environment Variables (PaperbarkMaple)

```bash
PORT=7071                      # API server port
MONGODB_URI=mongodb://...      # MongoDB connection string
JWT_SECRET=<secret>            # JWT signing secret
RESEND_API_KEY=<key>           # For magic link emails
RP_NAME="Just Maple"           # WebAuthn relying party name
RP_ID=maple.example.com        # WebAuthn relying party ID
ORIGIN=https://maple.example.com  # CORS origin
```

## Testing Approach

- Unit tests: `bun test` (Bun built-in test runner)
- API tests: Test repositories + routes with test MongoDB instance
- Web tests: Angular Testing Library (component tests)
- E2E: Playwright (future—not in MVP)

## References

- See README.md for full architecture, data models, and API endpoints
- TypeBox docs: https://github.com/sinclairzx81/typebox
- Elysia docs: https://elysiajs.com
- SimpleWebAuthn docs: https://simplewebauthn.dev
- WhisperKit: https://github.com/argmaxinc/WhisperKit
