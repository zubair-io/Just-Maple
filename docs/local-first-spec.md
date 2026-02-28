# Just Maple: Local-First Product Spec

**Author:** Zubair
**Date:** February 2026
**Status:** Draft

---

## 1. Vision

Just Maple becomes a local-first note-taking app. Users can open the app and start writing immediately — no account required. Notes are stored as Markdown files on disk (iCloud, a local folder, or any directory the user chooses). Cloud sync remains available as an opt-in upgrade for collaboration, sharing, and cross-device access beyond iCloud.

---

## 2. Notebook Types

There are three notebook types, distinguished by where their data lives:

| Type       | Storage                                      | Requires Login | Shareable        | Sync Mechanism          |
| ---------- | -------------------------------------------- | -------------- | ---------------- | ----------------------- |
| **iCloud** | `~/Library/Mobile Documents/.../Just Maple/` | No             | No (iCloud-only) | iCloud Drive (OS-level) |
| **Local**  | User-picked folder                           | No             | No               | None (manual backup)    |
| **Cloud**  | Azure Cosmos DB                              | Yes            | Yes              | WebSocket + REST API    |

### 2.1 iCloud Notebooks (Mac / iOS default)

On first launch (no login), the app reads the **Just Maple** iCloud Documents folder. Each subfolder is a notebook. If no subfolders exist, create a `General` folder automatically.

```
~/Library/Mobile Documents/com~apple~CloudDocs/Just Maple/
├── General/            ← auto-created default notebook
├── Work/               ← user-created notebook
│   ├── meeting-notes-a1b2c3.maple.md
│   └── project-plan-d4e5f6.maple.md
└── Personal/
    ├── journal-g7h8i9.maple.md
    └── recipes-j0k1l2.maple.md
```

### 2.2 Local Notebooks (any platform)

User picks any folder via a system directory picker. The folder itself is the notebook, and subfolders within it can be treated as nested notebooks or ignored (flat by default). Behaves identically to iCloud notebooks in terms of file format — just no cloud sync.

### 2.3 Cloud Notebooks (existing behavior)

The current MongoDB-backed notebooks. Require login. Support real-time collaboration, sharing, permissions, and all existing features (messages, collections, recordings, etc.). No file-system representation.

---

## 3. Default Screen (No Auth Guard)

Remove the global auth route guard. The app should boot to a **welcome/home screen** that adapts to the platform and context.

### 3.1 Mac / iOS App (Native Shell)

The app opens directly into the notebook sidebar. If the iCloud folder exists and has notebooks, load them immediately. The sidebar shows:

- iCloud notebooks (auto-detected)
- A "Add Notebook" option (create subfolder in iCloud, or pick a local folder)
- A "Sign In" link in the sidebar footer (for cloud notebook access)

If the iCloud folder is empty, show a brief onboarding card:

> **Welcome to Just Maple**
> Your notes are stored in iCloud — no account needed.
> [Create your first notebook] · [Sign in for cloud sync]

### 3.2 Web — With Folder Access (File System Access API supported)

Show a split default screen:

> **Get Started**
> [Pick a Folder] — Open a local folder as your notebook
> [Sign In] — Access your cloud notebooks

Once a folder is picked, it loads as a local notebook and the full editor UI appears.

### 3.3 Web — No Folder Access (Safari, Firefox, etc.)

Show a simpler default screen:

> **Welcome to Just Maple**
> [Sign In] — to access your notebooks
> _Local notebooks require a supported browser (Chrome, Edge)._

### 3.4 Auth Guard Changes

| Current                                             | New                                                              |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| Global `AuthGuard` on all routes                    | No auth guard on the shell/home route                            |
| Unauthenticated → redirect to `/login`              | Unauthenticated → show default screen with local + login options |
| `NotebookGuard` requires auth for private notebooks | `NotebookGuard` passes through for local/iCloud notebooks        |
| All API calls require JWT                           | **API calls still require JWT** — no change to API auth          |

The auth interceptor on `HttpClient` should gracefully handle the unauthenticated state (skip token attachment, don't redirect on 401 for local-only operations).

---

## 4. File Format

All local/iCloud notebook content is stored as Markdown files with a `.maple.md` extension. This keeps files human-readable in any text editor while allowing Maple-specific metadata via frontmatter and fenced blocks.

### 4.1 Naming Convention

```
{page-title}-{shortId}.maple.md
```

Filename is kebab-cased from the page title with a short ID suffix (first 6 chars of the UUID) to prevent collisions when two pages share the same title. For example: `meeting-notes-a1b2c3.maple.md`. The `.maple.md` extension tells the app this is a Maple document (not a random markdown file in the folder). Files without `.maple.md` in the folder are ignored by the app.

### 4.2 Memo Format

Standard Markdown with YAML frontmatter for metadata:

````markdown
---
id: a1b2c3d4-5678-90ab-cdef-1234567890ab
type: memo
created: 2026-02-25T10:30:00Z
modified: 2026-02-25T14:22:00Z
tags: [project, planning]
---

# Meeting Notes

Some paragraph text with **bold** and _italic_.

## Action Items

- [x] Review the proposal {priority: high, color: "#dc2626", due: 2026-03-01}
- [ ] Send follow-up email {priority: medium}
- [ ] Schedule next meeting

> A blockquote for emphasis.

```python
def hello():
    print("Hello from Maple")
```
````

[[d4e5f6|Project Plan]] — a link to another page (resolved by short ID, display title after `|`).

````

### 4.3 Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID v4 | Yes | Stable page identifier (survives renames) |
| `type` | string | Yes | Page type: `memo`, `whiteboard`, `kanban`, `json` |
| `created` | ISO 8601 | Yes | Creation timestamp |
| `modified` | ISO 8601 | Yes | Last modification timestamp |
| `tags` | string[] | No | User tags |
| `isFavorite` | boolean | No | Pinned/favorite flag |
| `isArchived` | boolean | No | Archived flag |
| `todoMeta` | object | No | Aggregated todo stats (auto-computed) |

### 4.4 Enhanced Task Items

Todo attributes are stored inline using a compact brace syntax after the task text:

```markdown
- [ ] Task description {priority: high, color: "#dc2626", due: 2026-03-15, id: abc123}
- [x] Completed task {priority: low}
````

The parser extracts these into the `EnhancedTaskItem` attributes when loading. On save, they're serialized back.

### 4.5 Rich Block Types (Code Fences with Type Annotations)

For content that can't be expressed in pure Markdown (whiteboards, kanban boards, JSON data, embeds), use typed fenced code blocks:

````markdown
```maple:embed
{
  "url": "https://www.youtube.com/watch?v=...",
  "title": "Video Title"
}
```
````

````markdown
```maple:page-link
{
  "shortId": "d4e5f6",
  "title": "Linked Page Title"
}
```
````

````markdown
```maple:image
{
  "src": "./assets/3a7f2b.png",
  "alt": "Description",
  "width": 600
}
```
````

Images are stored in the `assets/` subfolder using content-hash filenames (`{sha256-prefix}.{ext}`). This deduplicates identical images across pages — multiple pages referencing the same image point to one file.

### 4.6 Whiteboard Format

Whiteboards use a **sidecar file** pattern. The `.maple.md` file contains frontmatter and a human-readable title/description, while the actual whiteboard state lives in a companion `.whiteboard.json` file:

**Main file:** `architecture-a1b2c3.maple.md`

```markdown
---
id: w1b2c3d4-5678-90ab-cdef-1234567890ab
type: whiteboard
created: 2026-02-25T10:30:00Z
modified: 2026-02-25T14:22:00Z
sidecar: architecture-a1b2c3.whiteboard.json
---

# My Whiteboard

A visual architecture diagram for the new system.
```

**Sidecar file:** `architecture-a1b2c3.whiteboard.json`

```json
{
    "version": 1,
    "viewport": { "x": 0, "y": 0, "zoom": 1 },
    "elements": [
        {
            "id": "el-001",
            "type": "rectangle",
            "x": 100,
            "y": 200,
            "width": 300,
            "height": 150,
            "fill": "#FFE4B5",
            "stroke": "#D94E3B",
            "text": "Idea A"
        },
        {
            "id": "el-002",
            "type": "arrow",
            "startId": "el-001",
            "endId": "el-003",
            "stroke": "#333"
        },
        {
            "id": "el-003",
            "type": "text",
            "x": 500,
            "y": 250,
            "content": "Connected thought",
            "fontSize": 16
        },
        {
            "id": "el-004",
            "type": "freehand",
            "points": [
                [10, 20],
                [15, 25],
                [20, 22]
            ],
            "stroke": "#000",
            "strokeWidth": 2
        }
    ],
    "layers": [
        {
            "id": "layer-1",
            "name": "Default",
            "visible": true,
            "elementIds": ["el-001", "el-002", "el-003", "el-004"]
        }
    ]
}
```

The sidecar pattern keeps whiteboard JSON (which can grow large) out of the Markdown file. The `.maple.md` file still serves as the index entry and holds metadata. The `sidecar` frontmatter field links the two.

### 4.7 Kanban Format

Kanban boards also use the **sidecar file** pattern (same as whiteboards), since boards with many cards can grow large.

**Main file:** `sprint-board-j0k1l2.maple.md`

```markdown
---
id: k1b2c3d4-5678-90ab-cdef-1234567890ab
type: kanban
created: 2026-02-25T10:30:00Z
modified: 2026-02-25T14:22:00Z
sidecar: sprint-board-j0k1l2.kanban.json
---

# Sprint Board

A kanban board tracking the current sprint.
```

**Sidecar file:** `sprint-board-j0k1l2.kanban.json`

```json
{
    "version": 1,
    "lanes": [
        {
            "id": "lane-1",
            "title": "To Do",
            "color": "#E2E8F0",
            "cardIds": ["card-1", "card-2"]
        },
        {
            "id": "lane-2",
            "title": "In Progress",
            "color": "#FEF3C7",
            "cardIds": ["card-3"]
        },
        {
            "id": "lane-3",
            "title": "Done",
            "color": "#D1FAE5",
            "cardIds": []
        }
    ],
    "cards": {
        "card-1": {
            "id": "card-1",
            "title": "Design the landing page",
            "description": "Create mockups for the new landing page",
            "priority": "high",
            "color": "#dc2626",
            "dueDate": "2026-03-01",
            "tags": ["design"]
        },
        "card-2": {
            "id": "card-2",
            "title": "Set up CI/CD",
            "description": "",
            "priority": "medium"
        },
        "card-3": {
            "id": "card-3",
            "title": "Write API docs",
            "description": "Document all REST endpoints",
            "priority": "low",
            "tags": ["docs"]
        }
    },
    "settings": {
        "showCardCount": true,
        "defaultLaneId": "lane-1"
    }
}
```

### 4.8 JSON Document Format

JSON documents also use the **sidecar file** pattern for consistency with whiteboards and kanban.

**Main file:** `api-config-m3n4o5.maple.md`

```markdown
---
id: j1b2c3d4-...
type: json
created: 2026-02-25T10:30:00Z
modified: 2026-02-25T14:22:00Z
sidecar: api-config-m3n4o5.data.json
---

# API Config

Structured data for the project API configuration.
```

**Sidecar file:** `api-config-m3n4o5.data.json`

```json
{
  "schema": { ... },
  "data": { ... }
}
```

### 4.9 Page Type ↔ File Format Summary

| Page Type   | Frontmatter `type` | Body Format                | Files                                    |
| ----------- | ------------------ | -------------------------- | ---------------------------------------- |
| Memo        | `memo`             | Standard Markdown          | `.maple.md`                              |
| Whiteboard  | `whiteboard`       | Title/description in `.md` | `.maple.md` + `.whiteboard.json` sidecar |
| Kanban      | `kanban`           | Title/description in `.md` | `.maple.md` + `.kanban.json` sidecar     |
| JSON        | `json`             | Title/description in `.md` | `.maple.md` + `.data.json` sidecar       |
| Message     | —                  | **Cloud only**             | —                                        |
| Recording   | —                  | **Cloud only**             | —                                        |
| Gmail       | —                  | **Cloud only**             | —                                        |
| Collectable | —                  | **Cloud only**             | —                                        |

### 4.10 Folder Structure

```
My Notebook/                                    ← notebook root
├── meeting-notes-a1b2c3.maple.md               ← memo
├── project-plan-d4e5f6.maple.md                ← memo
├── architecture-g7h8i9.maple.md                ← whiteboard (metadata)
├── architecture-g7h8i9.whiteboard.json         ← whiteboard (sidecar data)
├── sprint-board-j0k1l2.maple.md                ← kanban (metadata)
├── sprint-board-j0k1l2.kanban.json             ← kanban (sidecar data)
├── api-config-m3n4o5.maple.md                  ← json document (metadata)
├── api-config-m3n4o5.data.json                 ← json document (sidecar data)
├── assets/                                     ← images and attachments (content-hashed)
│   ├── 3a7f2b.png
│   └── e9c1d4.svg
└── .maple/                                     ← app metadata (hidden)
    ├── notebook.json                           ← notebook-level config
    ├── index.json                              ← page index cache (for fast load)
    └── history/                                ← version history snapshots
        ├── a1b2c3/                             ← per-page history by ID prefix
        │   ├── 2026-02-25T10-30-00Z.maple.md
        │   └── 2026-02-25T14-22-00Z.maple.md
        └── g7h8i9/
            ├── 2026-02-25T10-30-00Z.maple.md
            └── 2026-02-25T10-30-00Z.whiteboard.json
```

#### `.maple/notebook.json`

```json
{
    "label": "My Notebook",
    "createdAt": "2026-02-25T10:30:00Z",
    "sortOrder": "modified",
    "defaultPageType": "memo"
}
```

#### `.maple/index.json`

A cache of page metadata for fast sidebar rendering without parsing every file:

```json
{
    "pages": [
        {
            "id": "a1b2c3d4-...",
            "title": "Meeting Notes",
            "type": "memo",
            "filename": "meeting-notes-a1b2c3.maple.md",
            "modified": "2026-02-25T14:22:00Z",
            "isFavorite": true,
            "todoMeta": { "todoCount": 3, "completedCount": 1, "overdueCount": 0 }
        }
    ],
    "lastIndexed": "2026-02-25T14:30:00Z"
}
```

This cache is rebuilt from the actual files whenever there's a mismatch or on explicit refresh.

---

## 5. Cloud-Only Features

The following features require a cloud (logged-in) notebook and are **not available** in local/iCloud mode:

| Feature                                | Why Cloud-Only                                         |
| -------------------------------------- | ------------------------------------------------------ |
| **Messages / Chat**                    | Real-time multi-user messaging needs a server          |
| **Recordings**                         | Audio stored in S3; transcription via cloud API        |
| **Gmail Integration**                  | OAuth tokens + email caching needs server              |
| **Collectables**                       | Provider API integrations (LEGO, etc.) run server-side |
| **Real-time Collaboration**            | Y.js WebSocket sync requires server infrastructure     |
| **Sharing / Permissions**              | Access control is inherently server-side               |
| **Publishing**                         | Public URLs (`/!/slug/...`) served from cloud          |
| **Notifications**                      | Push notifications routed through server               |
| **Cross-device Sync** (beyond iCloud)  | Conflict resolution needs a central authority          |
| **Search** (full-text, cross-notebook) | Server-side index; local search uses file system       |

When a user opens a local notebook, any UI for these features should be hidden or show a gentle prompt: "Sign in to unlock collaboration, messaging, and more."

---

## 6. Data Layer Architecture

### 6.1 Storage Abstraction

Introduce a `StorageProvider` interface so the editor doesn't care where data lives:

```typescript
interface StorageProvider {
    type: 'icloud' | 'local' | 'cloud';

    // Notebook operations
    listNotebooks(): Promise<Notebook[]>;
    createNotebook(label: string): Promise<Notebook>;

    // Page operations
    listPages(notebookId: string): Promise<PageMeta[]>;
    getPage(pageId: string): Promise<Page>;
    savePage(page: Page): Promise<void>;
    deletePage(pageId: string): Promise<void>;

    // Assets
    saveAsset(notebookId: string, file: File): Promise<string>; // returns relative path
    getAssetUrl(notebookId: string, path: string): string;

    // History
    getHistory(pageId: string): Promise<PageSnapshot[]>;
    restoreSnapshot(pageId: string, snapshotId: string): Promise<void>;

    // Search
    search(query: string, notebookId?: string): Promise<SearchResult[]>;

    // Watch for external changes (iCloud sync, other apps editing files)
    watch(notebookId: string, callback: (changes: FileChange[]) => void): void;
}
```

### 6.2 Implementations

| Provider                | Notebook ID                         | Page ID               | Persistence                            |
| ----------------------- | ----------------------------------- | --------------------- | -------------------------------------- |
| `ICloudStorageProvider` | Folder path relative to iCloud root | UUID from frontmatter | File System Access API / native bridge |
| `LocalStorageProvider`  | Folder absolute path                | UUID from frontmatter | File System Access API                 |
| `CloudStorageProvider`  | MongoDB `_id`                       | `page.id` (UUID)      | REST API (existing)                    |

### 6.3 Markdown ↔ ProseMirror Conversion

Two new utility modules in `@maple/shared`:

- **`markdownToDocument(md: string): ProseMirrorJSON`** — Parses `.maple.md` files into ProseMirror document format, handling frontmatter extraction, enhanced task item syntax, and typed `maple:*` fences.
- **`documentToMarkdown(doc: ProseMirrorJSON, meta: PageMeta): string`** — Serializes a ProseMirror document back to `.maple.md` format. The existing `proseMirrorToMarkdown()` in `content-export.ts` can be extended for this.

### 6.4 File Watching

For iCloud and local notebooks, the app needs to detect external file changes (e.g., iCloud syncing a change from another device, or the user editing the `.md` file in another editor):

- **Native app (Mac/iOS):** Use `FSEvents` / `FileManager` observers via the native bridge.
- **Web:** Use the File System Access API's `FileSystemObserver` (where supported) or poll on focus/interval.

On detecting a change, re-parse the affected `.maple.md` file and merge into the editor state.

#### Conflict Handling & Version History

Local notebooks maintain a hidden `.maple/history/` folder with timestamped snapshots of each page. When the app detects an external change (e.g., iCloud synced a version from another device while the user was also editing locally):

1. **Snapshot before overwrite** — Before applying the external change, save the current local state to `.maple/history/{shortId}/{timestamp}.maple.md`.
2. **Snapshot the incoming version** — Also save the incoming external version to history.
3. **Three-way merge** — Treat it as two offline edits diverging from the last known common snapshot. Attempt an automatic merge (line-level for Markdown, key-level for JSON sidecars).
4. **Conflict toast** — If auto-merge fails, show: "This file was edited on another device. [View both versions] [Keep mine] [Keep theirs]".

**Snapshot granularity:** History snapshots are taken only on "significant" saves — not on every auto-save. Significant saves include: manual save (Cmd+S), closing the page/app, navigating away, and external file changes (iCloud sync). Auto-save writes to the live file but does not create a history entry, keeping the history folder clean and meaningful.

History snapshots are pruned on a rolling basis (keep last 50 per page, or last 30 days, whichever is more).

#### History UX

The existing version history UI for cloud notebooks should be extended to work with local notebooks. When a user opens the history panel for a local page, the app reads from `.maple/history/{shortId}/` and presents the same timeline view — diffing snapshots, previewing old versions, and restoring with one click. For cloud notebooks, history comes from the server; for local notebooks, it comes from the `.maple/history/` folder. The `StorageProvider` interface should expose a `getHistory(pageId)` method that abstracts over both sources.

For iCloud-specific `(conflict)` duplicate files that macOS creates, the app should detect files matching `{name} (conflict).maple.md`, surface them as merge candidates, and offer to reconcile.

#### Folder Handle Persistence

On the web, store the `FileSystemDirectoryHandle` in IndexedDB so the browser can restore folder access on return visits without re-picking. On the native app, store the folder bookmark (security-scoped URL on macOS) in app preferences. If the stored handle becomes invalid (user cleared site data, revoked access), fall back to the folder picker.

---

## 7. Conversion: Y.js ↔ Markdown

For migrating existing cloud notebooks to local (export) or local to cloud (import):

### 7.1 Cloud → Local Export

1. Fetch Y.js state for each page.
2. Convert Y.js → ProseMirror JSON (existing Y.js `toJSON()`).
3. Convert ProseMirror JSON → `.maple.md` using `documentToMarkdown()`.
4. Write files to chosen folder.
5. Download assets (images) to `assets/` subfolder.

### 7.2 Local → Cloud Import (Copy to Cloud)

Local pages can be **copied** into a cloud notebook. This is a one-way copy, not a sync — the local file remains unchanged.

1. Parse each `.maple.md` file → frontmatter + ProseMirror JSON.
2. Create page in MongoDB with a new cloud ID.
3. Initialize Y.js document from ProseMirror JSON.
4. Upload assets to cloud storage.
5. **Prepend a provenance blockquote** to the top of the local `.maple.md` file:

```markdown
> **Copied to cloud notebook "Work"** on 2026-02-25.
> [Open in cloud](https://justmaple.app/notebook-id/page-id)
> _You can delete this note to remove the link._
```

This blockquote is standard Markdown — the user can delete it anytime. It serves as a breadcrumb so they know the page exists in the cloud.

---

## 8. Routing Changes

### 8.1 New Route Structure

```
/                               → Default screen (no auth required)
/local/:notebookPath            → Local/iCloud notebook view
/local/:notebookPath/:pageId    → Local/iCloud page editor
/:notebookId                    → Cloud notebook (requires auth)
/:notebookId/:pageId            → Cloud page editor (requires auth)
/login                          → Login page
/!/slug/page-slug               → Public published page (no change)
```

### 8.2 Guard Updates

| Guard            | Current Behavior                  | New Behavior                                                        |
| ---------------- | --------------------------------- | ------------------------------------------------------------------- |
| `AuthGuard`      | Blocks all unauthenticated access | Only blocks cloud notebook routes                                   |
| `NotebookGuard`  | Redirects to login if private     | Passes through for local routes; redirects for private cloud routes |
| `PageTypeGuards` | No change                         | No change (still match by page type)                                |

---

## 9. Migration & Rollout Plan

### Phase 1: File Format & Parser

- Define the `.maple.md` format spec (this document).
- Build `markdownToDocument()` and `documentToMarkdown()` in `@maple/shared`.
- Unit tests for round-trip fidelity (ProseMirror → Markdown → ProseMirror).
- Handle all current block types: headings, lists, tasks (with enhanced attributes), code blocks, images, embeds, page links, hashtags, tables.

### Phase 2: Storage Abstraction

- Define `StorageProvider` interface.
- Implement `LocalStorageProvider` using File System Access API.
- Implement `ICloudStorageProvider` with native bridge hooks.
- Refactor existing API calls behind `CloudStorageProvider`.

### Phase 3: Default Screen & Auth Changes

- Remove global `AuthGuard`.
- Build the new default screen with platform-adaptive options.
- Wire up folder picker (web) and iCloud detection (native).
- Add "Sign In" as a sidebar option, not a gate.

### Phase 4: Editor Integration

- Swap the data layer in editor components to use `StorageProvider`.
- Auto-save to `.maple.md` on edits (debounced).
- File watching for external changes.
- Local search (file-system based grep/index).

### Phase 5: Import / Export

- Cloud → Local export flow.
- Local → Cloud import flow.
- Notebook type switching UI.

---

## 10. Decisions Log

Resolved questions and their outcomes:

| #   | Question                         | Decision                                                                                                                                                                                                                         |
| --- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Nested folders**               | Flat for v1. Tree view in a later release.                                                                                                                                                                                       |
| 2   | **Filename collisions**          | Always append a 6-char ID suffix: `{title}-{shortId}.maple.md`. No option to omit it — keeps things predictable.                                                                                                                 |
| 3   | **Large whiteboards**            | Sidecar file pattern. Whiteboards always get a `.whiteboard.json` companion file. The `.maple.md` holds metadata + title only.                                                                                                   |
| 4   | **Local → Cloud promotion**      | Pages are **copied** into a cloud notebook (not promoted/moved). A provenance blockquote is prepended to the local file with a link to the cloud copy. User can delete the blockquote.                                           |
| 5   | **iCloud conflicts**             | Treat iCloud `(conflict)` files as two offline edits. Use `.maple/history/` to store snapshots, attempt three-way merge, and surface unresolvable conflicts to the user.                                                         |
| 6   | **Folder handle persistence**    | Store `FileSystemDirectoryHandle` in IndexedDB (web) and security-scoped bookmarks (native). Fall back to folder picker if handle is invalid.                                                                                    |
| 7   | **Mobile web**                   | Mobile web = cloud notebooks only (sign-in required). No local notebook support on mobile browsers.                                                                                                                              |
| 8   | **Kanban sidecar**               | Yes — kanban boards use `.kanban.json` sidecar, same pattern as whiteboards. Keeps it consistent.                                                                                                                                |
| 9   | **History UX**                   | User-facing. Extend the existing cloud history panel to read from `.maple/history/` for local notebooks. Same timeline/diff/restore UI.                                                                                          |
| 10  | **Shared local file locking**    | No locking for now. Rely on history snapshots and merge. Revisit if users report issues.                                                                                                                                         |
| 11  | **JSON document sidecar**        | Yes — JSON documents use `.data.json` sidecar, matching whiteboard and kanban patterns. All structured types are now consistent.                                                                                                 |
| 12  | **History snapshot granularity** | Significant saves only: manual save (Cmd+S), close/navigate away, external file changes. Auto-save writes to the live file but skips history.                                                                                    |
| 13  | **Page link resolution**         | Resolve by file short ID at render time. `[[page-title]]` is display text, but the underlying link targets the short ID (e.g., `[[a1b2c3]]`). Index cache maps IDs to current titles. No need to update linking files on rename. |
| 14  | **Asset deduplication**          | One copy per unique asset. Use content-hash filenames: `assets/{sha256-prefix}.{ext}`. Multiple pages referencing the same image point to the same file.                                                                         |
| 15  | **Max sidecar size**             | Soft warning when a sidecar exceeds 5MB. Toast: "This whiteboard is getting large (X MB) — it may sync slowly on iCloud." No hard limit.                                                                                         |

---

## 11. Open Questions

All major architectural decisions have been resolved. No blocking open questions remain.
