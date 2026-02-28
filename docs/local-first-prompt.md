# Claude Code Prompt: Implement Local-First Architecture

You are implementing the local-first architecture for Just Maple, a note-taking app. Work through the phases below **in order**. Each phase must be complete — with passing tests and no regressions — before moving to the next.

Read `docs/local-first-spec.md` for the full product spec. Read `CLAUDE.md` for project conventions. Follow both precisely.

---

## Ground Rules

### Testing First

- **Write tests before or alongside every module.** No implementation PR should be merged without tests.
- Run `bun run test:shared` / `bun run test:web` / `bun run test:api` after every phase to confirm zero regressions.
- Target ≥90% line coverage on all new code in `packages/shared`. Run `bun run test:coverage` to verify.
- Use the existing Vitest setup. Shared package tests go in `packages/shared/src/**/*.test.ts`. Web tests go in `apps/web/src/**/*.spec.ts`. API tests go in `apps/api/src/**/*.test.ts`.

### Code Quality

- Run `bun run format` before every commit. Prettier is the source of truth.
- Run `bun run typecheck` — zero TypeScript errors at all times.
- Follow `CLAUDE.md` conventions: signals (not BehaviorSubject), HttpClient (not fetch), separate component files, atomic design structure, kebab-case filenames.
- Use `import type` for type-only imports.
- No `any`. Use `unknown` and narrow.

### Commit Discipline

- One commit per logical unit of work. Use conventional commit format: `feat:`, `test:`, `refactor:`, etc.
- Every commit must pass `bun run typecheck && bun run test`.

---

## Phase 1: File Format & Parser (`packages/shared`)

Build the `.maple.md` file format parser and serializer in `packages/shared/src/local/`.

### 1.1 Frontmatter Parser

**File:** `packages/shared/src/local/frontmatter.ts`

Parse and serialize YAML frontmatter from `.maple.md` files. Handle all fields from the spec:

- `id` (UUID v4, required)
- `type` (`memo | whiteboard | kanban | json`, required)
- `created`, `modified` (ISO 8601, required)
- `sidecar` (string, optional — for whiteboard/kanban/json types)
- `tags` (string[], optional)
- `isFavorite`, `isArchived` (boolean, optional)
- `todoMeta` (object, optional)

**Tests** (`packages/shared/src/local/__tests__/frontmatter.test.ts`):

- Parse valid frontmatter with all fields
- Parse minimal frontmatter (only required fields)
- Round-trip: serialize → parse → compare (must be identical)
- Reject missing required fields (throw descriptive error)
- Handle edge cases: empty tags array, null optional fields, extra unknown fields (preserve them)
- Handle malformed YAML gracefully (don't crash, return error)

### 1.2 Enhanced Task Item Syntax

**File:** `packages/shared/src/local/task-attributes.ts`

Parse and serialize the inline `{priority: high, color: "#dc2626", due: 2026-03-15, id: abc123}` syntax on task list items.

**Tests:**

- Parse task with all attributes
- Parse task with only some attributes
- Parse task with no attributes (plain `- [ ] text`)
- Round-trip fidelity
- Handle edge cases: special characters in text before braces, nested braces in code, missing closing brace
- Preserve task text exactly (no trimming, no reordering)

### 1.3 Page Link Syntax

**File:** `packages/shared/src/local/page-links.ts`

Parse `[[shortId|Display Title]]` syntax. Extract short ID and display title.

**Tests:**

- Parse `[[a1b2c3|My Page]]` → `{ shortId: 'a1b2c3', title: 'My Page' }`
- Parse `[[a1b2c3]]` (no title) → `{ shortId: 'a1b2c3', title: undefined }`
- Multiple links in one line
- Links inside other Markdown (bold, italic, lists)
- Escaped brackets `\[\[` should not be parsed as links

### 1.4 Typed Fenced Blocks

**File:** `packages/shared/src/local/typed-blocks.ts`

Parse and serialize ` ```maple:type ` code fences. Types: `embed`, `page-link`, `image`.

**Tests:**

- Parse each block type with valid JSON
- Reject invalid JSON inside a typed block (return error with line number)
- Round-trip for each type
- Ignore regular code blocks (` ```python `, ` ```js `, etc.)
- Handle nested backticks correctly

### 1.5 Markdown ↔ ProseMirror Conversion

**File:** `packages/shared/src/local/markdown-to-document.ts`
**File:** `packages/shared/src/local/document-to-markdown.ts`

Convert between `.maple.md` content and ProseMirror JSON. Use the existing `proseMirrorToMarkdown()` in `content-export.ts` as a starting point — extend it, don't duplicate.

**Tests (critical — this is the highest-risk module):**

- Round-trip every block type:
    - Paragraphs, headings (h1-h6)
    - Bold, italic, code, strikethrough, underline, links
    - Bullet lists, ordered lists (including nested)
    - Task lists with enhanced attributes
    - Code blocks with language
    - Blockquotes
    - Tables (with header row)
    - Horizontal rules
    - Images (maple:image blocks)
    - Embeds (maple:embed blocks)
    - Page links (both inline `[[id|title]]` and block `maple:page-link`)
- Round-trip complex documents: a realistic memo with mixed content (heading, paragraph, list, code, image, task list with attributes, table, page links)
- Verify frontmatter is stripped from body and returned separately
- Verify `modified` timestamp is updated on serialize
- Snapshot tests: store golden `.maple.md` files in `__fixtures__/` and assert parse→serialize produces identical output

### 1.6 Filename Utilities

**File:** `packages/shared/src/local/filename.ts`

Generate and parse `.maple.md` filenames: `{kebab-title}-{shortId}.maple.md`.

**Tests:**

- `toFilename('Meeting Notes', 'a1b2c3d4-...')` → `meeting-notes-a1b2c3.maple.md`
- `parseFilename('meeting-notes-a1b2c3.maple.md')` → `{ title: 'meeting-notes', shortId: 'a1b2c3' }`
- Handle special characters in titles (strip or transliterate)
- Handle very long titles (truncate at reasonable length)
- Sidecar filenames: `toSidecarFilename('architecture-g7h8i9', 'whiteboard')` → `architecture-g7h8i9.whiteboard.json`
- Reject files without `.maple.md` extension

### 1.7 Asset Hashing

**File:** `packages/shared/src/local/asset-hash.ts`

Content-hash filenames for deduplication: `{sha256-prefix}.{ext}`.

**Tests:**

- Same file content → same hash
- Different content → different hash
- Hash prefix length is consistent (use first 6 hex chars)
- Preserves file extension correctly

### 1.8 Index Cache

**File:** `packages/shared/src/local/index-cache.ts`

Read/write the `.maple/index.json` cache file. Validate against actual files on disk.

**Tests:**

- Build index from a set of PageMeta objects
- Detect stale entries (file deleted, file modified since last index)
- Merge: add new pages, update changed pages, remove deleted pages
- Handle missing `.maple/` directory (create it)
- Handle corrupt `index.json` (rebuild from scratch)

### Phase 1 Completion Checklist

- [ ] All tests pass: `bun run test:shared`
- [ ] Coverage ≥90%: `bun run test:shared -- --coverage`
- [ ] Type check clean: `bun run typecheck`
- [ ] Formatted: `bun run format`
- [ ] Create golden fixture files in `packages/shared/src/local/__fixtures__/` for snapshot testing

---

## Phase 2: Storage Provider Interface & Implementations

### 2.1 Interface Definition

**File:** `packages/shared/src/local/storage-provider.ts`

Define the `StorageProvider` interface exactly as specified in the product spec (section 6.1), including `getHistory()` and `restoreSnapshot()`.

Define supporting types: `PageMeta`, `PageSnapshot`, `FileChange`, `SearchResult`.

**Tests:**

- Type-level tests: verify the interface compiles with a mock implementation
- Create a `MockStorageProvider` for use in later phases

### 2.2 `LocalStorageProvider` (Web — File System Access API)

**File:** `apps/web/src/app/services/local-storage-provider.ts`

Implement `StorageProvider` using the File System Access API. This is the provider for "pick a folder" on web.

**Key behaviors:**

- `listPages()` scans for `*.maple.md` files, reads frontmatter only (not full body)
- `getPage()` reads full file + sidecar if applicable
- `savePage()` writes `.maple.md` + sidecar, updates `modified` timestamp, updates `.maple/index.json`
- `savePage()` creates a history snapshot on significant saves (not auto-save). Accept a `{ significant: boolean }` option.
- `deletePage()` moves to a `.maple/trash/` folder (soft delete), removes from index
- `saveAsset()` hashes content, writes to `assets/`, returns relative path
- `getHistory()` reads from `.maple/history/{shortId}/`, returns sorted snapshots
- `restoreSnapshot()` copies snapshot back to live file, creates a new snapshot of the current state first
- `search()` does substring match on index cache titles + reads file content for full-text (can be slow, that's ok for v1)
- `watch()` uses `FileSystemObserver` where available, falls back to polling on `document.visibilitychange`

**Tests:**

- Use a mock `FileSystemDirectoryHandle` (create a test helper that simulates the File System Access API in memory)
- CRUD lifecycle: create page → list → get → update → get (verify update) → delete → list (verify removed)
- Sidecar lifecycle: create whiteboard → verify `.whiteboard.json` written → update → verify sidecar updated
- History: save with `{ significant: true }` → verify snapshot created → save with `{ significant: false }` → verify no new snapshot
- Asset dedup: save same image twice → verify one file in assets
- Index cache: verify `.maple/index.json` stays in sync after create/update/delete
- Corrupt file handling: malformed frontmatter → graceful error, not crash
- Empty notebook: `listPages()` on empty folder → returns `[]`, `.maple/` directory created

### 2.3 `CloudStorageProvider` (Wrapper around existing API)

**File:** `apps/web/src/app/services/cloud-storage-provider.ts`

Wrap the existing Angular services (`PageService`, `MemoService`, `NotebookService`, etc.) behind the `StorageProvider` interface. This is an adapter — minimal new logic.

**Tests:**

- Verify each method delegates to the correct existing service
- Verify `getHistory()` calls the existing version history API
- Verify cloud-only page types (message, recording, gmail, collectable) are included in `listPages()`

### 2.4 Folder Handle Persistence

**File:** `apps/web/src/app/services/folder-handle-store.ts`

Store and retrieve `FileSystemDirectoryHandle` from IndexedDB.

**Tests:**

- Store handle → retrieve → verify it's the same handle
- Retrieve when nothing stored → returns `null`
- Handle IndexedDB errors gracefully (quota exceeded, etc.)

### Phase 2 Completion Checklist

- [ ] All tests pass: `bun run test:shared && bun run test:web`
- [ ] Type check clean
- [ ] Formatted
- [ ] `MockStorageProvider` available for Phase 3+

---

## Phase 3: Default Screen & Auth Changes

### 3.1 Remove Global Auth Guard

**File:** `apps/web/src/app/guards/auth.guard.ts` (modify)
**File:** `apps/web/src/app/app.routes.ts` (modify)

- Remove `AuthGuard` from the root/home route
- Keep `AuthGuard` on cloud notebook routes (`/:notebookId`, `/:notebookId/:pageId`)
- Add `/local/:notebookPath` and `/local/:notebookPath/:pageId` routes (no auth guard)

**Tests:**

- Unauthenticated user can access `/` → does NOT redirect to `/login`
- Unauthenticated user can access `/local/...` → does NOT redirect
- Unauthenticated user accessing `/:cloudNotebookId` → redirects to `/login`
- Authenticated user can access all routes

### 3.2 Auth Interceptor Update

**File:** `apps/web/src/app/interceptors/auth.interceptor.ts` (modify)

- Skip JWT attachment for requests that don't go to the API
- Don't redirect on 401 when the user is in a local notebook context

**Tests:**

- Interceptor attaches token for API calls when authenticated
- Interceptor skips token when not authenticated (no error thrown)
- 401 response while on local route → no redirect
- 401 response while on cloud route → redirect to login

### 3.3 Default Screen Component

**File:** `apps/web/src/app/pages/welcome/welcome.component.ts`
**File:** `apps/web/src/app/pages/welcome/welcome.component.html`
**File:** `apps/web/src/app/pages/welcome/welcome.component.scss`

Build the adaptive welcome screen per spec section 3:

- Detect File System Access API support (`'showDirectoryPicker' in window`)
- If supported: show "Pick a Folder" + "Sign In"
- If not supported: show "Sign In" only with note about browser support
- Platform detection for native app (show iCloud notebooks directly)

**Tests:**

- Component renders "Pick a Folder" when File System Access API is available
- Component hides "Pick a Folder" when API is not available
- "Sign In" button navigates to `/login`
- "Pick a Folder" triggers directory picker and navigates to `/local/...` on success
- Handles user cancellation of directory picker (no error, stays on welcome)

### 3.4 Notebook Guard Update

**File:** `apps/web/src/app/guards/notebook.guard.ts` (modify)

- Pass through for routes with `/local/` prefix (no auth check)
- Existing behavior for cloud notebooks unchanged

**Tests:**

- Local route → guard returns `true` regardless of auth state
- Cloud private route + unauthenticated → redirect to login
- Cloud private route + authenticated → returns `true`
- Cloud public route → existing behavior unchanged

### Phase 3 Completion Checklist

- [ ] All tests pass: `bun run test:web`
- [ ] Existing tests still pass (zero regressions)
- [ ] Type check clean
- [ ] Formatted
- [ ] Manual smoke test: app boots unauthenticated, shows welcome screen

---

## Phase 4: Editor Integration

### 4.1 Storage Context Service

**File:** `apps/web/src/app/services/storage-context.service.ts`

A central service that holds the active `StorageProvider` instance. Components inject this instead of directly depending on a specific provider.

```typescript
// Signals-based
readonly activeProvider = signal<StorageProvider | null>(null);
readonly providerType = computed(() => this.activeProvider()?.type ?? null);
readonly isLocal = computed(() => this.providerType() === 'local' || this.providerType() === 'icloud');
readonly isCloud = computed(() => this.providerType() === 'cloud');
```

**Tests:**

- Set provider → `activeProvider()` returns it
- `isLocal` / `isCloud` signals react to provider changes
- Switching providers (local → cloud → local) works cleanly

### 4.2 Sidebar Updates

**File:** `apps/web/src/app/components/organisms/sidebar/` (modify existing)

- When `isLocal`, show local notebook pages from `StorageProvider.listPages()`
- Hide cloud-only sections (messages, recordings, etc.) when `isLocal`
- Show "Sign In for more features" link when not authenticated
- Show "Add Notebook" option (create subfolder or pick new folder)

**Tests:**

- Sidebar renders local pages when local provider is active
- Sidebar hides cloud-only items when local provider is active
- Sidebar shows all items when cloud provider is active
- "Add Notebook" button triggers appropriate action per provider type

### 4.3 Editor Auto-Save to `.maple.md`

**File:** Modify `apps/web/src/app/components/organisms/notebook-editor/` (existing editor)

- When `isLocal`, save to file system via `StorageProvider.savePage()` instead of API
- Auto-save on debounce (e.g., 1 second after last keystroke), with `{ significant: false }`
- Manual save (Cmd+S) with `{ significant: true }`
- On navigate away or page close, save with `{ significant: true }`

**Tests:**

- Auto-save triggers after debounce period
- Manual save (Cmd+S) triggers immediate save with significant flag
- Verify ProseMirror → Markdown conversion is called on save
- Verify Markdown → ProseMirror conversion is called on load
- Switching between pages saves the current one first

### 4.4 File Watcher Integration

**File:** `apps/web/src/app/services/file-watcher.service.ts`

- Subscribe to `StorageProvider.watch()` for the active notebook
- On external change: re-parse file, update editor state
- Show toast: "This file was updated externally. [Reload]"
- If user has unsaved local changes + external change: trigger conflict flow

**Tests:**

- External file change triggers reload notification
- No notification when the app itself saved the file
- Conflict detection: local dirty state + external change → conflict toast
- Clean state + external change → silent reload

### 4.5 Local History Panel

**File:** Extend existing history component to work with `StorageProvider.getHistory()`

- When `isLocal`, fetch history from `.maple/history/` via provider
- Same timeline/diff/restore UI as cloud history
- Restore creates a snapshot of current state before overwriting

**Tests:**

- History panel shows local snapshots sorted by date (newest first)
- Restore replaces current content with snapshot content
- Restore creates a new snapshot of the pre-restore state (safety net)
- Empty history → shows "No history yet" message

### Phase 4 Completion Checklist

- [ ] All tests pass: `bun run test:web && bun run test:shared`
- [ ] Zero regressions on existing cloud notebook tests
- [ ] Type check clean
- [ ] Formatted
- [ ] Manual test: create a local notebook, create a memo, edit, save, close, reopen — content persists

---

## Phase 5: Import / Export

### 5.1 Cloud → Local Export

**File:** `apps/web/src/app/services/export.service.ts`

Export a cloud notebook to a local folder:

1. Fetch all pages + Y.js state
2. Convert each to `.maple.md` (+ sidecar where applicable)
3. Download and hash assets
4. Write `.maple/notebook.json` and `.maple/index.json`

**Tests:**

- Export a notebook with one memo → verify file written with correct content
- Export a notebook with whiteboard → verify `.maple.md` + `.whiteboard.json` sidecar pair
- Export a notebook with images → verify `assets/` with hashed filenames
- Export skips cloud-only page types (messages, recordings, etc.)
- Round-trip: export → reimport → compare content (should be identical for supported types)

### 5.2 Local → Cloud Import (Copy to Cloud)

**File:** `apps/web/src/app/services/import.service.ts`

Copy local pages into a cloud notebook:

1. Parse `.maple.md` files
2. Create cloud pages via API
3. Upload assets
4. Prepend provenance blockquote to local file

**Tests:**

- Import a memo → verify cloud page created with correct content
- Import a whiteboard → verify cloud page + Y.js state initialized from sidecar
- Provenance blockquote is prepended to local file after import
- Provenance blockquote contains correct cloud notebook name and link
- Import with assets → verify assets uploaded to cloud storage
- Import page that already has provenance blockquote → update link (don't duplicate blockquote)

### Phase 5 Completion Checklist

- [ ] All tests pass across all packages
- [ ] Round-trip export→import preserves content
- [ ] Type check clean
- [ ] Formatted

---

## Testing Cheat Sheet

```bash
# Run all tests
bun run test

# Run by package
bun run test:shared
bun run test:web
bun run test:api

# Watch mode (for development)
bun run test:watch

# Coverage
bun run test:shared -- --coverage
bun run test:web -- --coverage

# Type check
bun run typecheck

# Format
bun run format

# Everything before committing
bun run format && bun run typecheck && bun run test
```

### Test File Locations

| Package           | Pattern            | Example                                                     |
| ----------------- | ------------------ | ----------------------------------------------------------- |
| `packages/shared` | `src/**/*.test.ts` | `src/local/__tests__/frontmatter.test.ts`                   |
| `apps/web`        | `src/**/*.spec.ts` | `src/app/services/__tests__/local-storage-provider.spec.ts` |
| `apps/api`        | `src/**/*.test.ts` | `src/repositories/__tests__/page.repo.test.ts`              |

### Test Conventions

- Use `describe` blocks grouped by function/method
- Use `it('should ...')` for test names — describe the expected behavior
- Use `beforeEach` for shared setup, not in each test
- Prefer `toEqual` for deep comparison, `toBe` for primitives
- Use snapshot tests (`toMatchSnapshot()`) for golden file comparisons in the parser
- Mock external dependencies (file system, HTTP, IndexedDB) — never hit real I/O in unit tests
- For Angular components: use `TestBed` with mocked services, `ZonelessChangeDetection` (see `test-init.ts`)
- For API tests: use `createTestApp()` helper and `fixtures.ts` for test data

### Golden Fixture Files

Create these in `packages/shared/src/local/__fixtures__/`:

- `simple-memo.maple.md` — paragraph, heading, list
- `complex-memo.maple.md` — all block types, enhanced tasks, page links, images
- `whiteboard.maple.md` + `whiteboard.whiteboard.json` — whiteboard with elements
- `kanban.maple.md` + `kanban.kanban.json` — kanban with lanes and cards
- `json-doc.maple.md` + `json-doc.data.json` — JSON document with schema
- `edge-cases.maple.md` — empty body, unicode, very long lines, special characters in frontmatter
