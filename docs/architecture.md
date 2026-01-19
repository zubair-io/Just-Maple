# Architecture Overview

This document describes the high-level architecture of Just Maple, including system design, data flow, and key technical decisions.

## System Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Same Codebase                             │
│                   (Bun + Elysia + Angular + Swift)               │
└─────────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┴─────────────────┐
            ▼                                   ▼
┌─────────────────────────┐       ┌─────────────────────────┐
│    Azure (Production)   │       │  Self-Hosted (Paperbark)│
│                         │       │                         │
│  ┌───────────────────┐  │       │  ┌───────────────────┐  │
│  │  Container App    │  │       │  │   LXC: api        │  │
│  │  (PaperbarkMaple) │  │       │  │   (PaperbarkMaple)│  │
│  └─────────┬─────────┘  │       │  └─────────┬─────────┘  │
│            │            │       │            │            │
│  ┌─────────▼─────────┐  │       │  ┌─────────▼─────────┐  │
│  │   Cosmos DB       │  │       │  │  LXC: mongodb     │  │
│  │   (MongoDB API)   │  │       │  │                   │  │
│  └───────────────────┘  │       │  └───────────────────┘  │
└─────────────────────────┘       └─────────────────────────┘
```

### Client Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Native Shells                               │
│                                                                  │
│  ┌──────────────────────────────┐       ┌─────────────┐         │
│  │      RedSunsetMaple          │       │  Android    │         │
│  │    (Swift - macOS + iOS)     │       │  (Future)   │         │
│  │                              │       │             │         │
│  │ ┌──────────┐  ┌──────────┐  │       │             │         │
│  │ │  macOS   │  │   iOS    │  │       │             │         │
│  │ │ WKWebView│  │ WKWebView│  │       │             │         │
│  │ └────┬─────┘  └────┬─────┘  │       │             │         │
│  │      └──────┬──────┘        │       │             │         │
│  └─────────────┼───────────────┘       └─────────────┘         │
│                │                                                 │
│                ▼                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   Shared Web App                          │  │
│  │                 SugarMaple (Angular)                      │  │
│  │                                                           │  │
│  │  ┌─────────────────────────────────────────────────────┐ │  │
│  │  │              Native Bridge Interface                 │ │  │
│  │  │  • Server management (multi-server)                  │ │  │
│  │  │  • Secure storage (Keychain/Keystore)               │ │  │
│  │  │  • Push notifications                                │ │  │
│  │  │  • Audio recording + WhisperKit transcription        │ │  │
│  │  │  • Clipboard, external URLs                          │ │  │
│  │  └─────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Overview

### Backend (PaperbarkMaple)

**Technology:** Bun + Elysia + MongoDB

The backend provides:

- RESTful API endpoints
- WebSocket connections for real-time features
- Authentication (passkeys + magic links)
- Push notification delivery (APNs)
- Document storage and sync

```
apps/api/src/
├── index.ts                 # Server entry point
├── config.ts               # Environment configuration
├── db/
│   └── client.ts           # MongoDB connection & indexes
├── routes/                 # API endpoints
│   ├── auth.ts            # Authentication routes
│   ├── notebooks.ts       # Notebook CRUD
│   ├── pages.ts           # Page/document CRUD
│   ├── messages.ts        # Chat messages
│   └── collab.ts          # Real-time collaboration
├── repositories/          # Data access layer
│   ├── user.repo.ts
│   ├── notebook.repo.ts
│   └── page.repo.ts
├── services/              # Business logic
│   ├── notification.service.ts
│   ├── realtime.service.ts
│   └── yjs-document.service.ts
└── ws/                    # WebSocket handlers
    └── realtime.ws.ts
```

### Frontend (SugarMaple)

**Technology:** Angular 21 + Tailwind CSS + TipTap

The web application provides:

- Single-page application (SPA)
- Offline-first with IndexedDB
- Real-time collaboration with Yjs
- Rich text editing with TipTap
- PWA support

```
apps/web/src/app/
├── components/
│   ├── atoms/              # Button, Input, Icon
│   ├── molecules/          # FormField, SearchBar
│   └── organisms/          # Sidebar, NotebookEditor, Chat
├── pages/                  # Route components
│   ├── login/
│   ├── chat-view/
│   ├── note-view/
│   └── settings/
├── services/               # Business logic
│   ├── auth.service.ts
│   ├── notebook.service.ts
│   ├── realtime-ws.service.ts
│   └── offline-queue.service.ts
├── guards/                 # Route guards
└── app.routes.ts           # Routing configuration
```

### Native App (RedSunsetMaple)

**Technology:** Swift + WKWebView

The iOS/macOS app provides:

- Native shell for the web app
- Secure token storage (Keychain)
- Push notification handling
- Audio recording with WhisperKit transcription
- Multi-server support

```
apps/apple/JapaneseMaple/
├── JapaneseMapleApp.swift      # App entry point
├── WebViewController.swift      # WKWebView host
├── NativeBridge.swift          # Bridge to web app
├── ServerConfigService.swift   # Server management
├── PushNotificationService.swift
├── TranscriptionService.swift
└── AudioRecorderService.swift
```

### Shared Types (@maple/shared)

**Technology:** TypeBox

Provides type-safe schemas used across all platforms:

```
packages/shared/src/schemas/
├── user.ts           # User schema
├── notebook.ts       # Notebook schema
├── page.ts           # Page schema
├── message.ts        # Message schema
└── auth.ts           # Auth types
```

---

## Data Model

### Entity Relationships

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   users     │     │  notebooks  │     │   pages     │
├─────────────┤     ├─────────────┤     ├─────────────┤
│ _id         │◄────│ createdBy   │     │ _id         │
│ email       │     │ _id         │◄────│ notebookId  │
│ displayName │     │ name        │     │ userId      │────►
│ createdAt   │     │ slug        │     │ title       │
│ updatedAt   │     │ members[]   │     │ doc (PM)    │
│ pushTokens[]│     │ createdAt   │     │ syncStatus  │
└─────────────┘     └─────────────┘     │ createdAt   │
                          │             └─────────────┘
                          │
                    ┌─────▼───────┐
                    │  messages   │
                    ├─────────────┤
                    │ _id         │
                    │ notebookId  │────►
                    │ senderId    │────►
                    │ content     │
                    │ createdAt   │
                    └─────────────┘
```

### MongoDB Collections

| Collection      | Purpose              | Key Indexes                          |
| --------------- | -------------------- | ------------------------------------ |
| `users`         | User accounts        | `email` (unique)                     |
| `notebooks`     | Tags/folders         | `slug` (unique), `members.userId`    |
| `pages`         | Documents            | `notebookId`, `userId`, `syncStatus` |
| `memos`         | Yjs document storage | `pageId`                             |
| `messages`      | Chat messages        | `notebookId`, `createdAt`            |
| `threads`       | Message threads      | `parentId`                           |
| `passkeys`      | WebAuthn credentials | `userId`, `credentialId`             |
| `magic_links`   | Auth tokens (TTL)    | `token`, `expiresAt`                 |
| `notifications` | Push notifications   | `userId`, `read`                     |

---

## Authentication Flow

### Passwordless Authentication

Just Maple uses passwordless authentication with two methods:

#### Magic Link Flow

```
1. User enters email
2. POST /api/auth/magic-link
   └─► Server creates/finds user
   └─► Creates magic link token (15 min TTL)
   └─► Sends email via Azure Communication Services
3. User clicks link in email
4. GET /api/auth/verify?token=xxx
   └─► Server validates token
   └─► Issues JWT (14-day sliding window)
   └─► Deletes magic link
5. JWT stored:
   └─► Web: httpOnly cookie
   └─► Native: Keychain
```

#### Passkey Flow (WebAuthn)

```
Registration (authenticated):
1. POST /api/auth/passkey-register-options
   └─► Returns WebAuthn challenge
2. navigator.credentials.create()
   └─► User authenticates with biometrics
3. POST /api/auth/passkey-register
   └─► Server stores credential

Login:
1. POST /api/auth/passkey-login-options
   └─► Returns WebAuthn challenge
2. navigator.credentials.get()
   └─► User authenticates with biometrics
3. POST /api/auth/passkey-login
   └─► Server validates, issues JWT
```

---

## Real-Time Architecture

### WebSocket Connection

```
Client                          Server
  │                               │
  │──────── WS Connect ──────────►│
  │                               │
  │◄─────── Auth Challenge ───────│
  │                               │
  │──────── JWT Token ───────────►│
  │                               │
  │◄─────── Connected ────────────│
  │                               │
  │──── Subscribe: room-123 ─────►│
  │                               │
  │◄───── Chat Events ────────────│
  │◄───── Doc Updates ────────────│
  │◄───── Awareness ──────────────│
```

### Document Collaboration (Yjs)

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Client A   │     │    Server    │     │   Client B   │
├──────────────┤     ├──────────────┤     ├──────────────┤
│  Yjs.Doc     │────►│  Yjs.Doc     │◄────│  Yjs.Doc     │
│  (local)     │     │  (authority) │     │  (local)     │
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │                    │
       └────────────────────┼────────────────────┘
                            │
                    ┌───────▼───────┐
                    │    MongoDB    │
                    │   (memos)     │
                    └───────────────┘
```

---

## Offline-First Architecture

### Sync Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        SugarMaple                                │
│                                                                  │
│  ┌─────────────────┐    ┌─────────────────┐                    │
│  │  Angular        │    │  IndexedDB      │                    │
│  │  Components     │───▶│  (Local Store)  │                    │
│  └────────┬────────┘    └────────┬────────┘                    │
│           │                      │                              │
│           ▼                      ▼                              │
│  ┌─────────────────────────────────────────┐                   │
│  │           DocumentSyncService            │                   │
│  │                                          │                   │
│  │  • Queue-based sync                      │                   │
│  │  • Debounced manual triggers             │                   │
│  │  • Conflict detection                    │                   │
│  │  • Automatic retry with backoff          │                   │
│  └────────────────────┬────────────────────┘                   │
│                       │                                         │
└───────────────────────┼─────────────────────────────────────────┘
                        │
                        ▼
              ┌─────────────────┐
              │   PaperbarkMaple │
              │   (Backend)     │
              └─────────────────┘
```

### Sync Status

| Status     | Description              |
| ---------- | ------------------------ |
| `pending`  | Changes queued for sync  |
| `syncing`  | Currently syncing        |
| `synced`   | Successfully synced      |
| `failed`   | Sync failed (will retry) |
| `conflict` | Conflict detected        |

---

## Push Notification Architecture

### Privacy-First Design

Push payloads contain **only IDs**, never content:

```json
{
    "aps": {
        "content-available": 1,
        "mutable-content": 1
    },
    "data": {
        "type": "message",
        "notebookId": "abc123",
        "messageId": "def456",
        "serverKey": "xyz789"
    }
}
```

### Notification Service Extension

```
┌─────────────────────────────────────────────────────────────────┐
│                         iOS Device                               │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              Notification Service Extension                 │ │
│  │  • Intercepts notification (mutable-content: 1)            │ │
│  │  • Fetches enriched data from server                       │ │
│  │  • Downloads media attachments                             │ │
│  │  • Modifies notification content                           │ │
│  │  • ~30 second time limit                                   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Shared Storage:                                                 │
│  • App Groups (UserDefaults)                                    │
│  • Keychain Sharing (auth tokens)                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Technology Decisions

### Why Bun?

- **Performance:** Fast startup, native TypeScript
- **Compatibility:** Node.js compatible
- **Bundling:** Built-in bundler
- **Package manager:** Fast dependency installation

### Why Elysia?

- **TypeScript-first:** End-to-end type safety
- **TypeBox integration:** Runtime validation
- **Performance:** Fast HTTP handling
- **Developer experience:** Clean API design

### Why Angular?

- **TypeScript-native:** First-class TypeScript support
- **Signals:** Modern reactive state management
- **Enterprise-ready:** Robust framework
- **SSR support:** Server-side rendering when needed

### Why MongoDB?

- **Flexible schema:** Document model fits our data
- **TypeBox validation:** Runtime type checking
- **Scalability:** Horizontal scaling
- **Azure integration:** Cosmos DB compatibility

### Why WKWebView?

- **Single codebase:** Web app runs everywhere
- **Native features:** Bridge to native APIs
- **Performance:** Optimized WebKit engine
- **Maintenance:** Update web app without App Store

---

## Security Considerations

### Authentication

- JWT tokens with 14-day sliding window
- Passkeys stored in platform authenticator
- Magic links expire in 15 minutes
- No passwords stored

### Data Protection

- HTTPS everywhere
- HttpOnly cookies for web JWT
- Keychain for native token storage
- No sensitive data in push payloads

### API Security

- Rate limiting on auth endpoints
- CORS restrictions
- Input validation with TypeBox
- Authorization checks on all routes

---

## Scalability

### Horizontal Scaling

```
┌─────────────────────────────────────────────────────────────────┐
│                      Load Balancer                               │
└───────────────────────────┬─────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│   API Pod 1   │   │   API Pod 2   │   │   API Pod N   │
└───────┬───────┘   └───────┬───────┘   └───────┬───────┘
        │                   │                   │
        └───────────────────┼───────────────────┘
                            │
                    ┌───────▼───────┐
                    │    Redis      │
                    │  (Pub/Sub)    │
                    └───────┬───────┘
                            │
                    ┌───────▼───────┐
                    │   MongoDB     │
                    │  (Replica)    │
                    └───────────────┘
```

### Azure Container Apps

- Scale to zero when idle
- Auto-scale on HTTP requests
- Max 10 replicas
- Redis for cross-replica messaging

---

## Next Steps

- [Web App Documentation](./web-app.md) - Deep dive into Angular frontend
- [API Documentation](./api.md) - Backend development guide
- [iOS App Documentation](./ios-app.md) - Native app development
- [Deployment Guide](./deployment.md) - Production deployment
