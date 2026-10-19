# Just-Maple

## Overview

A self-hosted platform where documents and conversations live together, organized by tags that control both structure and permissions. Features passwordless authentication (passkeys), multi-server support for native apps, privacy-first push notifications, and embedded reactive widgets with AI workflows.

**Product Name**: Just Maple

**Component Codenames**:
| Component | Codename | Technology |
|-----------|----------|------------|
| Backend API | **PaperbarkMaple** | Bun + Elysia |
| Web App | **SugarMaple** | Angular |
| Apple Apps (macOS + iOS) | **RedSunsetMaple** | Swift + WKWebView |
| Android App | TBD | Kotlin + WebView (future) |
| Shared Types | `@maple/shared` | TypeBox |

---

## Current Status

**Overall Progress: ~92% MVP Complete**

| Phase                                | Status       | Completion |
| ------------------------------------ | ------------ | ---------- |
| Authentication                       | ✅ Complete  | 100%       |
| Documents Route & Empty State        | ✅ Complete  | 100%       |
| Tags/Folders System                  | ✅ Complete  | 100%       |
| Document Backend Sync                | ✅ Complete  | 100%       |
| UI Polish & Sync Status              | ✅ Complete  | 85%        |
| Error Handling & Conflict Resolution | ✅ Complete  | 80%        |
| Testing & QA                         | ✅ Basic     | MVP        |
| Documentation                        | ✅ Core Docs | MVP        |

**Recent Updates:**

- ✅ **AutumnBlaze Migration Complete (Jan 2026)** - Migrated lego service and removed Azure SignalR dependency. See [migration docs](docs/autumnblaze-migration.md) for details.

---

## Goals

- **Passwordless authentication**: Passkeys (WebAuthn) only
- **Tags as organizing primitive**: Folders + permissions + chat container
- **Living documents**: Reactive widgets that respond to events and context
- **Multi-tenant architecture**: Same codebase, separate deployments per tenant
- **Multi-server clients**: Native apps connect to user's chosen servers
- **Privacy-first**: Push notification payloads contain only IDs, never content
- **Portable deployment**: Azure Container Apps and self-hosted Proxmox LXC
- **Offline-first**: Full functionality without network, sync when connected
- **Type safety**: End-to-end TypeScript with shared types

## Non-Goals (MVP)

- Real-time document collaboration (CRDT) - v1
- End-to-end encryption - v2
- File attachments - v1
- Bot support - v1
- Full-text search - v1
- Whiteboard widget - v2

---

## Core Concepts

### Tags (Folders with Permissions)

Tags are the organizing primitive. They act as:

- **Folders**: Group related notes
- **Permission boundaries**: Control who can see/edit what
- **Chat container**: Each tag has one chat and many notes

```
Tag: "Project Alpha"
├── 💬 Chat (one per tag)
│   └── Conversation thread
└── 📄 Notes (many)
    ├── Requirements
    ├── Technical Spec
    └── Meeting Notes
```

### Document Context Intelligence

Documents infer their purpose from:

- **Title patterns**: "Interview: [Name]" → activates interview widgets
- **Parent tags**: Child of "Interviews" tag → inherits interview template
- **Explicit templates**: User-defined document types with preset widgets
- **Content analysis**: AI-assisted detection of document purpose

### Living Documents & Reactive Widgets

Documents contain embedded widgets that:

- **Capture data**: Audio recording, form inputs, selections
- **Display state**: Live metrics, API data, computed values
- **Trigger actions**: Button clicks, threshold crossings, events
- **Transform content**: AI summarization, aggregation, formatting

### Navigation Model

```
┌─────────────────────────────────────────────────────────────┐
│  Sidebar              │  Main View                          │
├───────────────────────┼─────────────────────────────────────┤
│                       │                                     │
│  📁 Project Alpha  ●  │  💬 Project Alpha Chat              │
│    ├── Requirements   │  ┌─────────────────────────────────┐│
│    ├── Tech Spec      │  │ Alice: Hey, check the spec      ││
│    └── Meeting Notes  │  │ Bob: Updated section 3          ││
│                       │  │ Alice: Looks good 👍             ││
│  📁 Personal          │  │                                 ││
│    └── Journal        │  │ [Type a message...]             ││
│                       │  └─────────────────────────────────┘│
│  📁 Team Standup      │                                     │
│                       │                                     │
└───────────────────────┴─────────────────────────────────────┘

Click "Project Alpha" (tag) → Opens chat in main view
Click "Requirements" (note) → Opens note editor
● = Unread indicator
```

---

## Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Same Codebase                            │
│                   (Bun + Elysia + Angular + Swift)              │
└─────────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┴─────────────────┐
            ▼                                   ▼
┌─────────────────────────┐       ┌─────────────────────────┐
│    Azure (Tenant A)     │       │  Self-Hosted (Tenant B) │
│                         │       │                         │
│  ┌───────────────────┐  │       │  ┌───────────────────┐  │
│  │  Container App    │  │       │  │   LXC: api        │  │
│  │  (PaperbarkMaple)    │  │       │  │   (PaperbarkMaple)   │  │
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
│  │    (Swift - macOS + iOS)     │       │  (Kotlin)   │         │
│  │                              │       │   Future    │         │
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

### Tech Stack

| Layer              | Technology                    | Rationale                                           |
| ------------------ | ----------------------------- | --------------------------------------------------- |
| **Runtime**        | Bun                           | Fast startup, native TypeScript, Node.js compatible |
| **API Framework**  | Elysia                        | TypeScript-first, built-in validation (TypeBox)     |
| **Frontend**       | Angular                       | TypeScript-native, signals, SSR support             |
| **Editor**         | TipTap (ProseMirror)          | Flexible, extensible, widget support                |
| **Database**       | MongoDB (native driver)       | Flexible schema, TypeBox validation                 |
| **Validation**     | TypeBox (via Elysia)          | Single source of truth for types + validation       |
| **Auth**           | DIY (SimpleWebAuthn + Resend) | No external dependency                              |
| **State (Web)**    | Angular Signals + Elf         | Reactive, offline-first                             |
| **Storage (Web)**  | IndexedDB                     | Offline-first persistence                           |
| **Native (Apple)** | Swift + WKWebView             | Native performance, shared web UI                   |
| **Speech-to-Text** | WhisperKit                    | On-device, privacy-preserving                       |

---

## Project Structure

```
just-maple/
├── package.json                    # Workspace root
├── bun.lockb
├── tsconfig.base.json
│
├── packages/
│   └── shared/                     # @maple/shared
│       ├── package.json
│       └── src/
│           ├── index.ts
│           ├── schemas/
│           │   ├── note.ts
│           │   ├── tag.ts
│           │   ├── message.ts
│           │   ├── user.ts
│           │   ├── auth.ts
│           │   └── widget.ts
│           └── types/
│               ├── api.ts
│               ├── bridge.ts
│               └── websocket.ts
│
├── apps/
│   ├── api/                        # PaperbarkMaple (Bun + Elysia)
│   │   ├── package.json
│   │   └── src/
│   │       ├── server.ts
│   │       ├── config.ts
│   │       ├── db/
│   │       │   ├── client.ts
│   │       │   └── indexes.ts
│   │       ├── repositories/
│   │       │   ├── user.repo.ts
│   │       │   ├── tag.repo.ts
│   │       │   ├── note.repo.ts
│   │       │   ├── message.repo.ts
│   │       │   ├── passkey.repo.ts
│   │       │   └── passkey-challenge.repo.ts
│   │       ├── routes/
│   │       │   ├── auth.ts
│   │       │   ├── tags.ts
│   │       │   ├── notes.ts
│   │       │   ├── messages.ts
│   │       │   └── push.ts
│   │       ├── middleware/
│   │       │   └── auth.ts
│   │       ├── services/
│   │       │   ├── email.ts
│   │       │   └── push.ts
│   │       └── ws/
│   │           └── handler.ts
│   │
│   ├── web/                        # SugarMaple (Angular)
│   │   ├── package.json
│   │   ├── angular.json
│   │   └── src/
│   │       ├── main.ts
│   │       └── app/
│   │           ├── components/
│   │           │   ├── sidebar/
│   │           │   ├── chat/
│   │           │   ├── editor/
│   │           │   ├── document-list/
│   │           │   ├── document-viewer/
│   │           │   ├── auth/
│   │           │   ├── toast/
│   │           │   ├── offline-indicator/
│   │           │   ├── conflict-resolver/
│   │           │   └── widgets/
│   │           │       ├── recording-widget/
│   │           │       ├── dropdown-widget/
│   │           │       └── ai-summary-widget/
│   │           ├── services/
│   │           │   ├── auth.service.ts
│   │           │   ├── tag.service.ts
│   │           │   ├── note.service.ts
│   │           │   ├── message.service.ts
│   │           │   ├── document-sync.service.ts
│   │           │   ├── websocket.service.ts
│   │           │   ├── toast.service.ts
│   │           │   ├── theme.service.ts
│   │           │   ├── keyboard.service.ts
│   │           │   └── network-monitor.service.ts
│   │           ├── bridge/
│   │           │   ├── native-bridge.ts
│   │           │   ├── mock-bridge.ts
│   │           │   └── types.ts
│   │           └── guards/
│   │               └── auth.guard.ts
│   │
│   ├── apple/                      # RedSunsetMaple (Swift - macOS + iOS)
│   │   ├── RedSunsetMaple.xcodeproj
│   │   ├── RedSunsetMaple/         # Shared Swift code
│   │   │   ├── App/
│   │   │   │   ├── RedSunsetMapleApp.swift
│   │   │   │   └── AppDelegate.swift
│   │   │   ├── Bridge/
│   │   │   │   ├── NativeBridge.swift
│   │   │   │   ├── BridgeProtocol.swift
│   │   │   │   └── BridgeRouter.swift
│   │   │   ├── Services/
│   │   │   │   ├── AudioRecorderService.swift
│   │   │   │   ├── TranscriptionService.swift
│   │   │   │   ├── KeychainService.swift
│   │   │   │   ├── PushService.swift
│   │   │   │   └── ServerStore.swift
│   │   │   ├── Views/
│   │   │   │   ├── WebViewController.swift
│   │   │   │   └── ServerListView.swift
│   │   │   └── Resources/
│   │   │       ├── WebApp/         # Bundled SugarMaple
│   │   │       └── Whisper/        # WhisperKit models
│   │   ├── macOS/                  # macOS-specific
│   │   │   └── MainWindow.swift
│   │   ├── iOS/                    # iOS-specific
│   │   │   └── NotificationService/
│   │   └── Shared/                 # Shared resources
│   │       └── Assets.xcassets
│   │
│   └── android/                    # Future
│       └── ...
│
└── docs/
    ├── autumnblaze-migration.md  # AutumnBlaze → PaperbarkMaple migration docs
    ├── bot-system-integration-plan.md
    ├── user-guide/
    ├── developer-guide/
    └── api/
```

---

## Data Model

### Collections

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   users     │     │    tags     │     │   notes     │
├─────────────┤     ├─────────────┤     ├─────────────┤
│ _id         │◄────│ createdBy   │     │ _id         │
│ email       │     │ _id         │◄────│ tagId       │
│ displayName │     │ name        │     │ userId      │────►
│ createdAt   │     │ slug        │     │ title       │
│ updatedAt   │     │ members[]   │     │ doc (PM)    │
│ pushTokens[]│     │ createdAt   │     │ widgetStates│
└─────────────┘     └─────────────┘     │ syncStatus  │
                          │             │ createdAt   │
                          │             │ updatedAt   │
                    ┌─────▼───────┐     └─────────────┘
                    │  messages   │
                    ├─────────────┤
                    │ _id         │
                    │ tagId       │────►
                    │ senderId    │────►
                    │ content     │
                    │ createdAt   │
                    └─────────────┘

┌─────────────┐     ┌─────────────┐
│  passkeys   │     │ passkey_challenges │
├─────────────┤     ├─────────────┤
│ _id         │     │ _id         │
│ userId      │────►│ userId      │────►
│ credentialId│     │ kind        │
│ publicKey   │     │ expiresAt   │ ← TTL
│ counter     │     └─────────────┘
│ createdAt   │
└─────────────┘
```

### Schemas (TypeBox)

```typescript
// packages/shared/src/schemas/tag.ts
export const TagMemberSchema = t.Object({
    userId: t.String(),
    role: t.Union([
        t.Literal('owner'),
        t.Literal('admin'),
        t.Literal('member'),
        t.Literal('viewer'),
    ]),
    addedAt: t.String(),
    addedBy: t.String(),
});

export const TagSchema = t.Object({
    _id: t.String(),
    name: t.String(),
    slug: t.String(),
    description: t.Optional(t.String()),
    color: t.Optional(t.String()),
    icon: t.Optional(t.String()),
    createdBy: t.String(),
    members: t.Array(TagMemberSchema),
    settings: t.Object({
        allowMemberInvite: t.Boolean(),
        defaultNotePermission: t.Union([t.Literal('edit'), t.Literal('view')]),
    }),
    createdAt: t.String(),
    updatedAt: t.String(),
});

// packages/shared/src/schemas/note.ts
export const ProseMirrorNode = t.Recursive((Node) =>
    t.Object({
        type: t.String(),
        attrs: t.Optional(t.Record(t.String(), t.Any())),
        content: t.Optional(t.Array(Node)),
        marks: t.Optional(
            t.Array(
                t.Object({
                    type: t.String(),
                    attrs: t.Optional(t.Record(t.String(), t.Any())),
                }),
            ),
        ),
        text: t.Optional(t.String()),
    }),
);

export const SyncStatusSchema = t.Union([
    t.Literal('pending'),
    t.Literal('syncing'),
    t.Literal('synced'),
    t.Literal('failed'),
    t.Literal('conflict'),
]);

export const NoteSchema = t.Object({
    _id: t.String(),
    tagId: t.String(),
    userId: t.String(),
    title: t.String(),
    doc: ProseMirrorNode,
    widgetStates: t.Optional(t.Record(t.String(), t.Any())),
    syncStatus: SyncStatusSchema,
    lastSyncedAt: t.Optional(t.String()),
    serverVersion: t.Optional(t.Number()),
    createdAt: t.String(),
    updatedAt: t.String(),
});

// packages/shared/src/schemas/message.ts
export const MessageSchema = t.Object({
    _id: t.String(),
    tagId: t.String(),
    senderId: t.String(),
    type: t.Union([t.Literal('text'), t.Literal('system')]),
    content: t.String(),
    createdAt: t.String(),
});

// packages/shared/src/schemas/user.ts
export const PushTokenSchema = t.Object({
    token: t.String(),
    platform: t.Union([
        t.Literal('ios'),
        t.Literal('macos'),
        t.Literal('android'),
        t.Literal('web'),
    ]),
    createdAt: t.String(),
});

export const UserSchema = t.Object({
    _id: t.String(),
    email: t.String({ format: 'email' }),
    displayName: t.Optional(t.String()),
    avatarUrl: t.Optional(t.String()),
    pushTokens: t.Array(PushTokenSchema),
    createdAt: t.String(),
    updatedAt: t.String(),
});
```

### Indexes

```typescript
// users
{ email: 1 }  // unique

// tags
{ slug: 1 }  // unique
{ "members.userId": 1 }
{ createdBy: 1 }

// notes
{ tagId: 1, updatedAt: -1 }
{ userId: 1 }
{ syncStatus: 1 }

// messages
{ tagId: 1, createdAt: -1 }

// passkeys
{ userId: 1 }
{ credentialId: 1 }  // unique

// passkey_challenges
{ _id: 1 } // challenge, unique
{ expiresAt: 1 }  // TTL, expireAfterSeconds: 0
```

---

## Widget System

### Widget Architecture

```typescript
// packages/shared/src/schemas/widget.ts
export const WidgetConfigSchema = t.Object({
    id: t.String(),
    type: t.String(),
    props: t.Record(t.String(), t.Any()),
});

export interface DocumentContext {
    documentId: string;
    title: string;
    inferredType: string; // "interview", "meeting", "note", etc.
    sections: Section[];
    getContent: (sectionId?: string) => string;
    parentTag?: Tag;
}

export abstract class BaseWidget {
    protected id: string;
    protected config: WidgetConfig;
    protected context: DocumentContext;
    protected subscriptions: (() => void)[] = [];

    constructor(config: WidgetConfig, context: DocumentContext);

    // Lifecycle
    abstract render(): any;
    onMount(): void;
    onUnmount(): void;
    onContextChange(newContext: DocumentContext): void;

    // Actions
    protected emitEvent(eventType: string, payload: any): void;
    protected writeToDocument(location: string, content: string): void;

    // Output for other widgets
    abstract getOutput(): Record<string, any>;
}
```

### Built-in Widget Types

#### Data Capture Widgets

| Widget              | Description                            | Outputs                               |
| ------------------- | -------------------------------------- | ------------------------------------- |
| **Audio Recorder**  | Records and transcribes via WhisperKit | `transcript`, `duration`, `audioPath` |
| **Dropdown/Select** | Single or multi-select                 | `selected: string[]`                  |
| **Rating**          | Star rating, scales                    | `rating: number`                      |
| **Form Input**      | Text, number, date inputs              | `value: any`                          |

#### Display Widgets

| Widget               | Description                 | Inputs                  |
| -------------------- | --------------------------- | ----------------------- |
| **AI Summary**       | Generated text from context | `context: string[]`     |
| **Live Data**        | Show real-time API data     | `source: DataSource`    |
| **Status Indicator** | Show computed status        | `condition: Expression` |

#### Action Widgets

| Widget        | Description          | Triggers            |
| ------------- | -------------------- | ------------------- |
| **Button**    | Trigger actions      | `onClick: Action[]` |
| **Threshold** | Value-based triggers | `onCross: Action[]` |

### Widget-Document Communication

```typescript
// Widget emits event
this.emitEvent('transcriptionComplete', { transcript: text });

// Document listens
window.addEventListener('widget:event', (e) => {
    const { widgetId, eventType, payload } = e.detail;
    // Handle event, potentially trigger other widgets
});

// Widget writes to document
this.writeToDocument('Transcript', transcribedText);
```

---

## Native Bridge

### Protocol

```swift
// BridgeProtocol.swift

// Web → Native Messages
enum WebToNativeMessage: Codable {
  // Server management
  case getServers
  case saveServer(ServerConfig)
  case deleteServer(id: String)
  case setActiveServer(id: String)

  // Secure storage
  case getToken(serverId: String)
  case saveToken(serverId: String, token: String)
  case deleteToken(serverId: String)

  // Audio
  case startRecording(widgetId: String, options: RecordingOptions?)
  case stopRecording(widgetId: String)
  case pauseRecording(widgetId: String)
  case resumeRecording(widgetId: String)

  // Transcription
  case transcribeAudio(audioPath: String, language: String?, widgetId: String)

  // Push
  case getPushToken
  case requestPushPermission

  // System
  case copyToClipboard(text: String)
  case openExternal(url: String)
  case getAppVersion
  case getPlatform
}

// Native → Web Messages
enum NativeToWebMessage: Codable {
  // Server management
  case servers([ServerConfig])
  case activeServer(ServerConfig?)

  // Token
  case token(String?)

  // Audio
  case recordingStarted(widgetId: String)
  case recordingStopped(widgetId: String, audioPath: String, duration: Double)
  case recordingError(widgetId: String, error: String)
  case audioLevel(widgetId: String, level: Float)

  // Transcription
  case transcriptionProgress(widgetId: String, text: String, isFinal: Bool)
  case transcriptionComplete(widgetId: String, text: String)
  case transcriptionError(widgetId: String, error: String)

  // Push
  case pushToken(String?)
  case pushPermission(granted: Bool)

  // System
  case platform(String)  // "ios", "macos"
  case appVersion(String)
  case error(code: String, message: String)
}
```

### TypeScript Interface

```typescript
// packages/shared/src/types/bridge.ts
export interface NativeBridge {
    // Server management
    getServers(): Promise<ServerConfig[]>;
    saveServer(config: ServerConfig): Promise<void>;
    deleteServer(id: string): Promise<void>;
    getActiveServer(): Promise<ServerConfig | null>;
    setActiveServer(id: string): Promise<void>;

    // Secure storage
    getToken(serverId: string): Promise<string | null>;
    saveToken(serverId: string, token: string): Promise<void>;
    deleteToken(serverId: string): Promise<void>;

    // Audio
    startRecording(widgetId: string, options?: RecordingOptions): Promise<void>;
    stopRecording(widgetId: string): Promise<RecordingResult>;

    // Transcription
    transcribeAudio(audioPath: string, widgetId: string, language?: string): Promise<string>;

    // Push notifications
    getPushToken(): Promise<string | null>;
    requestPushPermission(): Promise<boolean>;

    // System
    copyToClipboard(text: string): Promise<void>;
    openExternal(url: string): Promise<void>;
    getAppVersion(): Promise<string>;
    getPlatform(): Promise<'ios' | 'macos' | 'android' | 'web'>;
}

export interface ServerConfig {
    id: string;
    name: string;
    url: string;
    iconUrl?: string;
}

export interface RecordingOptions {
    transcribeRealtime?: boolean;
    language?: string;
}

export interface RecordingResult {
    audioPath: string;
    duration: number;
}
```

### WhisperKit Integration

```swift
// Services/TranscriptionService.swift
import WhisperKit

class TranscriptionService {
  static let shared = TranscriptionService()
  private var whisperKit: WhisperKit?

  func loadModel(model: String = "base.en") async throws {
    whisperKit = try await WhisperKit(model: model)
  }

  func transcribe(
    audioPath: String,
    language: String? = "en",
    onProgress: @escaping (String) -> Void
  ) async throws -> String {
    guard let whisperKit = whisperKit else {
      throw TranscriptionError.modelNotLoaded
    }

    let results = try await whisperKit.transcribe(
      audioPath: audioPath,
      decodeOptions: DecodingOptions(
        language: language,
        task: .transcribe
      )
    )

    return results.map { $0.text }.joined(separator: " ")
  }
}
```

**WhisperKit Model Options:**
| Model | Size | Speed | Quality |
|-------|------|-------|---------|
| `tiny.en` | ~75MB | Fastest | Decent |
| `base.en` | ~140MB | Fast | Good (recommended) |
| `small.en` | ~460MB | Medium | Better |
| `medium.en` | ~1.5GB | Slow | Very good |
| `large-v3` | ~3GB | Slowest | Best, multilingual |

---

## Authentication

### Flow Overview

```
Passkey Signup:
  1. User enters a display name
  2. POST /api/auth/passkey/signup/start → Returns WebAuthn creation options
  3. Browser creates a discoverable passkey
  4. POST /api/auth/passkey/signup/finish → Verifies, creates account, issues JWT

Passkey Registration (authenticated users):
  1. POST /auth/passkey/register/start → Returns WebAuthn options
  2. Browser/Native calls navigator.credentials.create()
  3. POST /auth/passkey/register/finish → Stores credential

Passkey Login:
  1. POST /auth/passkey/login/start → Returns WebAuthn options
  2. Browser/Native calls navigator.credentials.get()
  3. POST /auth/passkey/login/finish → Validates, issues JWT
```

### API Endpoints

| Method | Endpoint                        | Auth     | Description                       |
| ------ | ------------------------------- | -------- | --------------------------------- |
| POST   | `/auth/passkey/signup/start`    | Public   | Start passkey account creation    |
| POST   | `/auth/passkey/signup/finish`   | Public   | Verify passkey and create account |
| POST   | `/auth/passkey/register/start`  | Required | Start passkey registration        |
| POST   | `/auth/passkey/register/finish` | Required | Complete passkey registration     |
| POST   | `/auth/passkey/login/start`     | Public   | Start passkey login               |
| POST   | `/auth/passkey/login/finish`    | Public   | Complete passkey login            |
| POST   | `/auth/logout`                  | Required | Clear session                     |
| GET    | `/auth/me`                      | Required | Get current user                  |

---

## API Design

### Server Info (for multi-server)

| Method | Endpoint       | Auth   | Description                               |
| ------ | -------------- | ------ | ----------------------------------------- |
| GET    | `/server/info` | Public | Server name, version, registration status |

### Tags

| Method | Endpoint                    | Auth     | Description             |
| ------ | --------------------------- | -------- | ----------------------- |
| GET    | `/tags`                     | Required | List user's tags        |
| POST   | `/tags`                     | Required | Create tag              |
| GET    | `/tags/:id`                 | Required | Get tag details         |
| PATCH  | `/tags/:id`                 | Required | Update tag              |
| DELETE | `/tags/:id`                 | Required | Delete tag (owner only) |
| POST   | `/tags/:id/members`         | Required | Add member              |
| DELETE | `/tags/:id/members/:userId` | Required | Remove member           |

### Notes

| Method | Endpoint             | Auth     | Description       |
| ------ | -------------------- | -------- | ----------------- |
| GET    | `/tags/:tagId/notes` | Required | List notes in tag |
| POST   | `/tags/:tagId/notes` | Required | Create note       |
| GET    | `/notes/:id`         | Required | Get note          |
| PATCH  | `/notes/:id`         | Required | Update note       |
| DELETE | `/notes/:id`         | Required | Delete note       |

### Messages (Chat)

| Method | Endpoint                | Auth     | Description               |
| ------ | ----------------------- | -------- | ------------------------- |
| GET    | `/tags/:tagId/messages` | Required | List messages (paginated) |
| POST   | `/tags/:tagId/messages` | Required | Send message              |

### Push Notifications

| Method | Endpoint           | Auth     | Description           |
| ------ | ------------------ | -------- | --------------------- |
| POST   | `/push/register`   | Required | Register push token   |
| DELETE | `/push/unregister` | Required | Unregister push token |

---

## Sync & Offline

### Offline-First Architecture

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
              │   PaperbarkMaple   │
              │   (Backend)     │
              └─────────────────┘
```

### Sync Status

```typescript
type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict';

interface SyncableDocument {
    syncStatus: SyncStatus;
    lastSyncedAt?: number;
    serverVersion?: number;
    syncError?: string;
}
```

### Conflict Resolution

1. **Detection**: Compare `serverVersion` on save
2. **UI**: Show `ConflictResolverComponent` with diff viewer
3. **Resolution Options**:
    - Keep local version
    - Keep server version
    - Manual merge

---

## Push Notifications

### Privacy-First Design

Push payloads contain **only IDs**, never content:

```typescript
// Push payload
{
  aps: {
    "content-available": 1,
    "mutable-content": 1,
  },
  data: {
    type: "message",
    tagId: "abc123",
    messageId: "def456",
  }
}
```

### iOS Notification Service Extension

```swift
// iOS/NotificationService/NotificationService.swift
class NotificationService: UNNotificationServiceExtension {
  override func didReceive(_ request: UNNotificationRequest,
                          withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
    guard let data = request.content.userInfo["data"] as? [String: Any] else {
      contentHandler(request.content)
      return
    }

    // Fetch actual content from server
    Task {
      let content = await fetchContent(data: data)

      let mutableContent = request.content.mutableCopy() as! UNMutableNotificationContent
      mutableContent.title = content.title
      mutableContent.body = content.body

      contentHandler(mutableContent)
    }
  }
}
```

---

## Deployment

### Azure Container Apps

```yaml
# Environment variables
PORT=7071
MONGODB_URI=<from-key-vault>
JWT_SECRET=<from-key-vault>
RESEND_API_KEY=<from-key-vault>
RP_NAME=Just Maple
RP_ID=maple.example.com
ORIGIN=https://maple.example.com

# Lego Service (see docs/autumnblaze-migration.md)
REBRICKABLE_API_KEY=<from-key-vault>
BRIGHT_DATA_API_KEY=<from-key-vault>
CLAUDE_API_KEY=<from-key-vault>
HORNBEAM_BLOB_URL=https://hornbeam.justmaple.app/data  # Optional, has default
```

**Scaling:**

- Min replicas: 0 (scale to zero)
- Max replicas: 10
- Scale trigger: HTTP concurrent requests (100)

### Self-Hosted (Proxmox LXC)

```
┌─────────────────────────────────────────────────────────────────┐
│                      Proxmox Host                               │
│                                                                 │
│  ┌─────────────────────┐    ┌─────────────────────┐            │
│  │  LXC: api           │    │  LXC: mongodb       │            │
│  │  192.168.50.20      │    │  192.168.50.10      │            │
│  │                     │    │                     │            │
│  │  - Bun runtime      │───▶│  - MongoDB 7        │            │
│  │  - PaperbarkMaple      │    │  - Auth enabled     │            │
│  │  - systemd managed  │    │                     │            │
│  │  Port: 7071         │    │  Port: 27017        │            │
│  └─────────────────────┘    └─────────────────────┘            │
│                                                                 │
│  ┌─────────────────────┐                                       │
│  │  Reverse Proxy      │                                       │
│  │  (Caddy)            │                                       │
│  │  - SSL termination  │                                       │
│  │  - WebSocket proxy  │                                       │
│  └─────────────────────┘                                       │
└─────────────────────────────────────────────────────────────────┘
```

**Systemd Service:**

```ini
# /etc/systemd/system/PaperbarkMaple.service
[Unit]
Description=PaperbarkMaple API
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/just-maple/apps/api
ExecStart=/root/.bun/bin/bun run src/server.ts
Restart=always
RestartSec=5

Environment=NODE_ENV=production
Environment=PORT=7071
Environment=MONGODB_URI=mongodb://api:password@192.168.50.10:27017/maple
Environment=JWT_SECRET=<secret>
Environment=RESEND_API_KEY=<key>
Environment=RP_NAME=Just Maple
Environment=RP_ID=maple.local
Environment=ORIGIN=https://maple.local
# Lego Service
Environment=REBRICKABLE_API_KEY=<key>
Environment=BRIGHT_DATA_API_KEY=<key>
Environment=CLAUDE_API_KEY=<key>

[Install]
WantedBy=multi-user.target
```

---

## Development

### Local Setup

```bash
# Clone repo
git clone <repo>
cd just-maple

# Install dependencies
bun install

# Start MongoDB (Docker for local dev)
docker run -d -p 27017:27017 --name mongodb mongo:7

# Environment
cp apps/api/.env.example apps/api/.env

# Run API (PaperbarkMaple)
bun run dev:api

# Run Web (SugarMaple) - separate terminal
bun run dev:web

# For native development (RedSunsetMaple)
# 1. Open apps/apple/RedSunsetMaple.xcodeproj in Xcode
# 2. Web dev server will be used for hot reload
# 3. Cmd+R to run
```

### Scripts

```json
{
    "scripts": {
        "dev": "bun run dev:api & bun run dev:web",
        "dev:api": "bun run --cwd apps/api dev",
        "dev:web": "bun run --cwd apps/web start",
        "build": "bun run build:shared && bun run build:api && bun run build:web",
        "build:web:native": "bun run --cwd apps/web build && ./scripts/bundle-native.sh",
        "typecheck": "tsc --noEmit",
        "test": "bun test"
    }
}
```

### Keyboard Shortcuts (SugarMaple)

| Shortcut               | Action           |
| ---------------------- | ---------------- |
| `Cmd/Ctrl + N`         | New document     |
| `Cmd/Ctrl + Shift + D` | Toggle dark mode |
| `Cmd/Ctrl + /`         | Toggle sidebar   |

---

## Roadmap

### MVP (v0) Complete

| Feature | Status |
| ------- | ------ |

| Auth  
| Tags/Folders
| Notes CRUD
| Document sync
| Offline-first
| Dark mode
| Conflict resolution
| macOS app

### v1

| Feature                    | Description                 |
| -------------------------- | --------------------------- |
| **DIY Auth Migration**     | Passkeys                    |
| **PaperbarkMaple Backend** | Bun + Elysia migration      |
| **iOS App**                | RedSunsetMaple iOS target   |
| **Chat**                   | Messages per tag, WebSocket |
| **Speech-to-Text Widget**  | WhisperKit integration      |
| **Dropdown Widget**        | For scoring, forms          |
| **AI Summary Widget**      | Context-aware summaries     |
| **Template System**        | YAML-based templates        |
| **Push Notifications**     | Privacy-first               |

### v2

| Feature                      | Description                  |
| ---------------------------- | ---------------------------- |
| **tldraw Whiteboard Widget** | Embedded whiteboard/diagrams |
| **Home Assistant Widget**    | IoT integration              |
| **Real-time Collaboration**  | CRDT-based (Yjs)             |
| **Android App**              | Kotlin + WebView             |
| **Bot Support**              | Webhook triggers, bot API    |
| **Full-text Search**         | Across notes and messages    |

### v3

| Feature                | Description                    |
| ---------------------- | ------------------------------ |
| **Widget SDK**         | Third-party widget development |
| **Plugin Marketplace** | Community widgets              |
| **Advanced AI**        | Multi-model support            |
| **Team Features**      | Organizations, SSO             |

---

## Dependencies

### API (apps/api) - PaperbarkMaple

```json
{
    "dependencies": {
        "elysia": "^1.0.0",
        "@elysiajs/jwt": "^1.0.0",
        "mongodb": "^6.0.0",
        "@simplewebauthn/server": "^10.0.0",
        "resend": "^3.0.0",
        "apn": "^2.2.0",
        "firebase-admin": "^12.0.0",
        "@maple/shared": "workspace:*"
    }
}
```

### Web (apps/web) - SugarMaple

```json
{
    "dependencies": {
        "@angular/core": "^18.0.0",
        "@simplewebauthn/browser": "^10.0.0",
        "@tiptap/core": "^2.0.0",
        "@tiptap/pm": "^2.0.0",
        "@tiptap/starter-kit": "^2.0.0",
        "@ngneat/elf": "^2.0.0",
        "idb": "^8.0.0",
        "@maple/shared": "workspace:*"
    }
}
```

### Apple (apps/apple) - RedSunsetMaple

- Swift 5.9+
- iOS 17.0+ / macOS 14.0+
- WhisperKit 1.x
- WebKit (WKWebView)

---

_Last updated: December 2024_
