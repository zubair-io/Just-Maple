# Features Overview

A comprehensive reference of Just Maple features, terminology, and how components relate to each other. Use this document for planning and understanding the product landscape.

---

## Core Concepts & Terminology

### Hierarchy

```
User
 └── Notebook (container/folder)
      └── Page (metadata layer)
           └── Content (memo, whiteboard, messages, recording, collectibles)
```

| Term            | What it is                                    | Database Collection |
| --------------- | --------------------------------------------- | ------------------- |
| **Notebook**    | Top-level container, like a folder or project | `notebooks`         |
| **Page**        | Metadata wrapper for any content type         | `pages`             |
| **Memo**        | Rich text document (TipTap/CRDT)              | `memos`             |
| **Whiteboard**  | Drawing canvas with elements                  | `whiteboards`       |
| **Messages**    | Chat page (one per notebook)                  | `messages`          |
| **Recording**   | Voice recording with transcription            | `recordings`        |
| **Collectible** | Tracked item (LEGO, Funko, custom)            | `collectibles`      |

### Page Types

Every Page has a `type` field determining its content and editor:

| Type          | Content Source | Editor View        | Notes                               |
| ------------- | -------------- | ------------------ | ----------------------------------- |
| `memo`        | `memos` table  | TipTap rich editor | Most common page type               |
| `whiteboard`  | `whiteboards`  | Canvas drawing     | Infinite canvas with shapes/strokes |
| `messages`    | `messages`     | Chat interface     | One per notebook, auto-created      |
| `recording`   | `recordings`   | Audio player       | With transcription timeline         |
| `collectible` | `collectibles` | Item detail view   | LEGO, Funko, custom items           |
| `kanban`      | (planned)      | Board layout       | Future feature                      |

---

## Feature Inventory

### Document Editing

| Feature                | Description                                           | Status  |
| ---------------------- | ----------------------------------------------------- | ------- |
| **Memo Editor**        | TipTap-based rich text with formatting, lists, tables | Shipped |
| **Slash Commands**     | `/heading`, `/todo`, `/code`, etc.                    | Shipped |
| **Markdown Shortcuts** | `**bold**`, `- list`, `[]` for todos                  | Shipped |
| **Callouts**           | Colored info/warning/tip blocks                       | Shipped |
| **Tables**             | Insertable tables with basic editing                  | Shipped |
| **Code Blocks**        | Syntax-highlighted code with language selection       | Shipped |
| **Embeds**             | YouTube, Twitter, GitHub preview embeds               | Shipped |
| **Image Upload**       | Drag/paste images, cloud storage                      | Shipped |
| **Version History**    | View and restore previous versions                    | Shipped |

### Todos & Tasks

| Feature              | Description                           | Status  |
| -------------------- | ------------------------------------- | ------- |
| **Enhanced Todos**   | Tasks with priority, due date, color  | Shipped |
| **Todo Toolbar**     | Inline controls when cursor in task   | Shipped |
| **Todo Aggregation** | `todoMeta` on pages for stats         | Shipped |
| **Todo View**        | Cross-notebook todo list with filters | Shipped |
| **Overdue Tracking** | Counts overdue items                  | Shipped |

**Todo Attributes:**

- `id` - Unique identifier
- `checked` - Completion status
- `priority` - `high` | `medium` | `low` | null
- `color` - Color tag
- `dueDate` - ISO date string

### Whiteboard & Drawing

| Feature                 | Description                     | Status  |
| ----------------------- | ------------------------------- | ------- |
| **Infinite Canvas**     | Pan/zoom 2D workspace           | Shipped |
| **Freehand Drawing**    | Pen tool with pressure support  | Shipped |
| **Shapes**              | Rectangle, ellipse, line, arrow | Shipped |
| **Text Elements**       | Text boxes on canvas            | Shipped |
| **Selection/Transform** | Move, resize, rotate elements   | Shipped |
| **Layers**              | Element grouping and visibility | Shipped |
| **Eraser**              | Stroke removal                  | Shipped |
| **Grid/Snap**           | Optional grid alignment         | Shipped |

### Chat & Messaging

| Feature               | Description                      | Status  |
| --------------------- | -------------------------------- | ------- |
| **Notebook Chat**     | One message page per notebook    | Shipped |
| **Threads**           | Reply to messages in threads     | Shipped |
| **Mentions**          | `@user` and `@bot` mentions      | Shipped |
| **Rich Content**      | Markdown in messages             | Shipped |
| **Reactions**         | Emoji reactions on messages      | Shipped |
| **Attachments**       | Image/file attachments           | Shipped |
| **Typing Indicators** | Show who's typing                | Shipped |
| **Unread Tracking**   | Per-user, per-page unread counts | Shipped |

### Linking & Knowledge Graph

| Feature               | Description                                      | Status  |
| --------------------- | ------------------------------------------------ | ------- |
| **Wiki Links**        | `[[Page Name]]` inline linking                   | Shipped |
| **Display Text**      | `[[Page Name\|Custom Text]]`                     | Shipped |
| **Backlinks Panel**   | See pages linking to current page                | Shipped |
| **Forward Links**     | See pages current page links to                  | Shipped |
| **Connection Graph**  | Force-directed visualization of page links       | Shipped |
| **Hashtags**          | `#tag` for categorization                        | Shipped |
| **Unlinked Mentions** | Text matching page titles without explicit links | Planned |
| **Link Preview**      | Hover preview of linked pages                    | Planned |

### Search

| Feature               | Description                                   | Status  |
| --------------------- | --------------------------------------------- | ------- |
| **Full-Text Search**  | Search across all content types               | Shipped |
| **Real-time Results** | As-you-type search                            | Shipped |
| **Filters**           | By type, notebook, hashtag, date range        | Shipped |
| **Search Operators**  | `"exact"`, `#tag`, `type:memo`, `in:Notebook` | Shipped |
| **Search Index**      | Separate collection for fast queries          | Shipped |

### Voice & Audio

| Feature             | Description                       | Status  |
| ------------------- | --------------------------------- | ------- |
| **Voice Recording** | Record audio in notes             | Shipped |
| **Transcription**   | WhisperKit on-device or cloud     | Shipped |
| **Word Timestamps** | Segment-level timing for playback | Shipped |
| **Searchable**      | Transcripts indexed in search     | Shipped |

### Templates

| Feature              | Description                                        | Status  |
| -------------------- | -------------------------------------------------- | ------- |
| **System Templates** | Meeting Notes, Daily Journal, Project Brief, etc.  | Shipped |
| **Custom Templates** | Save any page as template                          | Shipped |
| **Variables**        | `{{date}}`, `{{time}}`, `{{notebook}}`, `{{user}}` | Shipped |
| **Template Gallery** | Browse and select templates                        | Shipped |
| **Categories**       | work, personal, planning, custom                   | Shipped |

### AI & Bots

| Feature              | Description                                    | Status  |
| -------------------- | ---------------------------------------------- | ------- |
| **AI Writing**       | Continue, improve, simplify, expand, summarize | Shipped |
| **Slash Command AI** | `/ai` in editor                                | Shipped |
| **Bot Templates**    | System-defined bot types                       | Shipped |
| **User Bots**        | User-configured bot instances                  | Shipped |
| **Chat Bots**        | Mention `@bot` in chat to invoke               | Shipped |
| **Bot Actions**      | LLM, HTTP, transform, reply                    | Shipped |
| **Bot Output**       | Rich UI components in responses                | Shipped |
| **Invocation Logs**  | Execution history                              | Shipped |

### Collaboration

| Feature              | Description                      | Status  |
| -------------------- | -------------------------------- | ------- |
| **Real-time Sync**   | CRDT-based conflict-free editing | Shipped |
| **Cursor Awareness** | See collaborator cursors         | Shipped |
| **Notebook Sharing** | Invite members with roles        | Shipped |
| **Access Levels**    | Owner, editor, viewer            | Shipped |
| **Shared Bots**      | Invite bots to notebooks         | Shipped |
| **Public Links**     | Optional public notebook access  | Shipped |

### Notifications

| Feature                 | Description                                           | Status  |
| ----------------------- | ----------------------------------------------------- | ------- |
| **Notification Store**  | Centralized Elf store                                 | Shipped |
| **Types**               | message_received, transcription_complete, share, etc. | Shipped |
| **Badge Counts**        | Combined notifications + unread messages              | Shipped |
| **Push Notifications**  | iOS/macOS native push                                 | Shipped |
| **Mark as Read**        | Individual and bulk                                   | Shipped |
| **Offline Persistence** | IndexedDB cache                                       | Shipped |

### Offline & Sync

| Feature             | Description                                      | Status  |
| ------------------- | ------------------------------------------------ | ------- |
| **Offline-First**   | Full functionality without network               | Shipped |
| **IndexedDB Cache** | Local storage for pages, messages, notifications | Shipped |
| **Offline Queue**   | Changes queued and synced when online            | Shipped |
| **Sync Status**     | pending, syncing, synced, failed, conflict       | Shipped |
| **CRDT Merge**      | Automatic conflict resolution                    | Shipped |

### Collectibles

| Feature              | Description                     | Status  |
| -------------------- | ------------------------------- | ------- |
| **LEGO Tracking**    | Set number, pieces, theme, year | Shipped |
| **Status**           | owned, wishlist, building, sold | Shipped |
| **Value Tracking**   | Purchase price, current value   | Shipped |
| **Barcode Scanning** | Camera-based lookup (iOS/macOS) | Shipped |
| **Rebrickable**      | External database integration   | Shipped |
| **Collection Stats** | Aggregated statistics           | Shipped |

### Authentication

| Feature             | Description                | Status  |
| ------------------- | -------------------------- | ------- |
| **Passkeys**        | WebAuthn passwordless auth | Shipped |
| **Passkey signup**  | Display name + passkey     | Shipped |
| **JWT Tokens**      | Access + refresh tokens    | Shipped |
| **Device Tracking** | User agent, IP in tokens   | Shipped |
| **Multi-Device**    | Multiple passkeys per user | Shipped |

---

## Platform Matrix

| Feature            | Web | macOS      | iOS        | reMarkable |
| ------------------ | --- | ---------- | ---------- | ---------- |
| Memo Editor        | Yes | Yes        | Yes        | Yes        |
| Whiteboard         | Yes | Yes        | Yes        | Yes        |
| Chat               | Yes | Yes        | Yes        | No         |
| Voice Recording    | Yes | Yes        | Yes        | No         |
| Transcription      | API | WhisperKit | WhisperKit | No         |
| Offline Mode       | Yes | Yes        | Yes        | Yes        |
| Push Notifications | No  | Yes        | Yes        | No         |
| Barcode Scanning   | No  | Yes        | Yes        | No         |

---

## Component Naming (Web App)

### Angular Components

| Layer     | Pattern                   | Examples                                             |
| --------- | ------------------------- | ---------------------------------------------------- |
| Atoms     | Single-purpose UI element | `button`, `input`, `icon`, `toast`                   |
| Molecules | Composed UI elements      | `editor-toolbar`, `todo-popover`, `connection-graph` |
| Organisms | Complex UI regions        | `sidebar`, `notebook-editor`, `chat`, `whiteboard`   |
| Templates | Page layouts              | `main-layout`                                        |

### Services

| Service                | Purpose                                 |
| ---------------------- | --------------------------------------- |
| `NotificationService`  | Centralized notification store (Elf)    |
| `MessageService`       | Chat messages and unread tracking       |
| `CollaborationService` | Real-time cursor/awareness              |
| `SyncService`          | Offline queue and sync status           |
| `SearchService`        | Full-text search                        |
| `PageService`          | Page CRUD and metadata                  |
| `MemoService`          | Memo content and CRDT state             |
| `WhiteboardService`    | Whiteboard elements and canvas state    |
| `RecordingService`     | Audio recording and transcription       |
| `TemplateService`      | Template CRUD and variable substitution |
| `BotService`           | Bot configuration and invocation        |
| `AuthService`          | Authentication and tokens               |

---

## API Route Structure

| Route                  | Purpose                               |
| ---------------------- | ------------------------------------- |
| `/api/auth/*`          | Login, passkeys, tokens               |
| `/api/notebooks/*`     | Notebook CRUD, members, sharing       |
| `/api/pages/*`         | Page metadata                         |
| `/api/memo/*`          | Memo content, Y.js sync               |
| `/api/whiteboard/*`    | Whiteboard canvas state               |
| `/api/messages/*`      | Chat messages, threads, unread        |
| `/api/collab/*`        | Real-time events                      |
| `/api/search/*`        | Full-text search                      |
| `/api/links/*`         | Page links, backlinks, graph          |
| `/api/templates/*`     | Template CRUD, gallery                |
| `/api/recordings/*`    | Audio files, transcription            |
| `/api/bots/*`          | Bot templates, user bots, invocations |
| `/api/notifications/*` | Notifications, device registration    |
| `/api/collectables/*`  | Collectibles CRUD                     |
| `/api/ai/*`            | AI writing assistance                 |
| `/api/storage/*`       | File upload/download                  |

---

## Relationship Diagrams

### Page Content Model

```
pages (metadata)
 ├── type: "memo"      → memos.noteId
 ├── type: "whiteboard"→ whiteboards.id
 ├── type: "messages"  → messages.pageId
 └── type: "recording" → recordings.pageId
```

### User Ownership

```
users
 ├── notebooks (ownerId)
 │    └── pages (notebookId)
 │         ├── memos
 │         ├── whiteboards
 │         └── messages
 ├── user_bots (userId)
 ├── collectibles (userId)
 └── passkeys (userId)
```

### Notification Flow

```
NotificationService (Elf store)
 ├── notifications[] ──┐
 │                     ├── totalUnreadCount → Badge
 └── messageUnreadCount┘
         ↑
MessageService
 └── unreadCounts[] → totalMessageUnreadCount
```

---

## Potential Future Features

Based on patterns in the codebase and common note-taking features:

| Feature              | Category      | Notes                                    |
| -------------------- | ------------- | ---------------------------------------- |
| Kanban View          | Page Types    | Board layout for task management         |
| Calendar View        | Todos         | View todos by due date on calendar       |
| Recurring Todos      | Todos         | Daily/weekly/monthly task recurrence     |
| Reminders            | Todos         | Push notifications for due dates         |
| Folder Hierarchy     | Organization  | Nested notebooks/folders                 |
| Page Icons           | Organization  | Custom icons per page                    |
| Favorites            | Organization  | Quick-access starred pages               |
| Export               | Data          | PDF, Markdown, HTML export               |
| Import               | Data          | Import from other apps                   |
| Comments             | Collaboration | Inline comments on content               |
| Permissions          | Collaboration | Page-level access control                |
| Activity Feed        | Collaboration | Recent changes across notebooks          |
| Link Preview         | Links         | Hover preview of linked pages            |
| Unlinked Mentions    | Links         | Suggest linking text that matches titles |
| Graph Filters        | Links         | Filter connection graph by type/tag      |
| Mobile App (Android) | Platform      | Android native app                       |
| Browser Extension    | Platform      | Web clipper                              |
| API Webhooks         | Integration   | External event notifications             |
| Zapier/Make          | Integration   | Automation platform connectors           |

---

## Related Documentation

- [Overview](./overview.md) - General product overview
- [Data Model](./data-model.md) - Database schema details
- [Architecture](./architecture.md) - System design
- [API Reference](./api-reference.md) - Endpoint documentation

### Feature Deep Dives

- [Memo Editor](./feature-memo-editor.md)
- [Whiteboard](./feature-whiteboard.md)
- [Todos](./feature-todos.md)
- [Chat & Messaging](./feature-chat.md)
- [Bi-directional Links](./feature-links.md)
- [Connection Graph](./feature-connection-graph.md)
- [Search](./feature-search.md)
- [Templates](./feature-templates.md)
- [Voice Recording](./feature-recording.md)
- [Transcription](./feature-transcription.md)
- [AI Writing](./feature-ai-writing.md)
- [Bots](./feature-bots.md)
- [Offline Mode](./feature-offline.md)
- [Sharing](./feature-sharing.md)
- [Collectibles](./feature-collectibles.md)
- [Notebooks](./feature-notebooks.md)
- [Keyboard Shortcuts](./feature-keyboard-shortcuts.md)
