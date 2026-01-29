# Memo Versioning Implementation Plan

> **Goal**: Provide a safety net that builds user confidence in editing

## Executive Summary

Implement a versioning system for memos that automatically captures snapshots at strategic points, allowing users to view history and restore previous versions. This provides peace of mind that edits can be undone even after closing the browser.

---

## Current State

**What exists:**

- Memos stored with Y.js binary state in `memos` collection
- Y.js provides in-session undo/redo (lost on refresh)
- No persistent history beyond current state

**The problem:**
Users lose all history when they close the browser, reload, or clear data. This creates anxiety around making significant edits.

---

## Version Storage Strategy

### Approach: Time-Based Snapshots

Store complete Y.js state snapshots at strategic points rather than granular deltas.

### When to Capture Versions

| Trigger              | Description                        |
| -------------------- | ---------------------------------- |
| `auto-interval`      | Every 5 minutes of active editing  |
| `auto-idle`          | After 30 seconds of no edits       |
| `manual`             | User presses Cmd/Ctrl+S            |
| `ai-edit`            | Before AI bot modifies content     |
| `significant-change` | Large content changes (>500 chars) |

### Retention Policy

| Age        | Keep                   |
| ---------- | ---------------------- |
| < 24 hours | All versions (max ~50) |
| 1-7 days   | 1 per hour             |
| 7-30 days  | 1 per day              |
| 30-90 days | 1 per week             |
| > 90 days  | Delete                 |

---

## Database Schema

### New Collection: `memo_versions`

```typescript
interface MemoVersionDocument {
    _id: ObjectId;
    noteId: string; // References pages.id
    state: Binary; // Y.js state snapshot
    version: number; // Version from parent memo
    byteSize: number; // For storage management
    trigger: VersionTrigger; // What caused this snapshot
    label?: string; // User-provided label
    createdAt: Date;

    // Display metadata
    contentPreview?: string; // First 200 chars
    wordCount?: number;
    headingText?: string; // Document title/first heading
}

type VersionTrigger =
    | 'auto-interval'
    | 'auto-idle'
    | 'manual'
    | 'ai-edit'
    | 'significant-change'
    | 'import';
```

### Indexes

```javascript
// Primary query: versions for a memo, newest first
{ noteId: 1, createdAt: -1 }

// Cleanup: find old versions to prune
{ noteId: 1, version: 1 }
```

### Updates to `memos` Collection

```typescript
// Add to existing memo document
{
    lastSnapshotAt?: Date;
    lastSnapshotVersion?: number;
}
```

---

## API Endpoints

| Endpoint                                         | Method | Description                |
| ------------------------------------------------ | ------ | -------------------------- |
| `/api/memos/:noteId/versions`                    | GET    | List versions (paginated)  |
| `/api/memos/:noteId/versions/:versionId`         | GET    | Get specific version state |
| `/api/memos/:noteId/versions/:versionId/restore` | POST   | Restore version            |
| `/api/memos/:noteId/versions`                    | POST   | Create manual checkpoint   |

### List Versions Response

```typescript
{
    versions: [{
        _id: string;
        version: number;
        createdAt: string;
        trigger: VersionTrigger;
        label?: string;
        contentPreview?: string;
        wordCount?: number;
        byteSize: number;
    }];
    hasMore: boolean;
}
```

### Restore Behavior

Restoring **creates a new version** (non-destructive). The restored state becomes latest, but the previous state is preserved. Users can "undo" a restore.

---

## Backend Implementation

### New Files

| File                                             | Purpose                   |
| ------------------------------------------------ | ------------------------- |
| `apps/api/src/repositories/memo-version.repo.ts` | CRUD for versions         |
| `apps/api/src/services/memo-version.service.ts`  | Snapshot logic, retention |
| `apps/api/src/routes/memo-versions.ts`           | API endpoints             |

### Integration Point

Modify `yjs-document.service.ts` to call `maybeCreateSnapshot()` after saving:

```typescript
private async saveDocument(noteId: string): Promise<void> {
    const ydoc = this.documents.get(noteId);
    if (!ydoc) return;

    await this.persistDocument(noteId, ydoc);

    // Check if we should capture a version
    await memoVersionService.maybeCreateSnapshot(noteId, ydoc);
}
```

### Snapshot Logic

```typescript
class MemoVersionService {
    private readonly SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

    async maybeCreateSnapshot(noteId: string, ydoc: Y.Doc): Promise<void> {
        const memo = await findMemoByNoteId(noteId);
        const lastSnapshot = memo?.lastSnapshotAt;

        if (!lastSnapshot || Date.now() - lastSnapshot.getTime() > this.SNAPSHOT_INTERVAL_MS) {
            await this.createSnapshot(noteId, ydoc, 'auto-interval');
        }
    }

    async createSnapshot(
        noteId: string,
        ydoc: Y.Doc,
        trigger: VersionTrigger,
        label?: string,
    ): Promise<MemoVersion> {
        const state = Y.encodeStateAsUpdate(ydoc);

        return insertMemoVersion({
            noteId,
            state: new Binary(Buffer.from(state)),
            version: memo.version,
            byteSize: state.length,
            trigger,
            label,
            contentPreview: extractTextPreview(ydoc, 200),
            wordCount: countWords(ydoc),
            headingText: extractFirstHeading(ydoc),
            createdAt: new Date(),
        });
    }
}
```

### Deduplication

Skip versions when content hasn't changed:

```typescript
async function shouldCreateSnapshot(noteId: string, ydoc: Y.Doc): boolean {
    const lastVersion = await getLatestVersion(noteId);
    if (!lastVersion) return true;

    // Compare state vectors
    const lastVector = Y.encodeStateVectorFromUpdate(lastVersion.state);
    const newVector = Y.encodeStateVector(ydoc);

    return !arraysEqual(lastVector, newVector);
}
```

---

## Frontend Implementation

### New Service

```typescript
// apps/web/src/app/services/memo-version.service.ts
@Injectable({ providedIn: 'root' })
export class MemoVersionService {
    private readonly http = inject(HttpClient);

    getVersions(noteId: string, limit = 20): Observable<VersionsResponse> {
        return this.http.get<VersionsResponse>(`/api/memos/${noteId}/versions`, {
            params: { limit },
        });
    }

    restoreVersion(noteId: string, versionId: string): Observable<RestoreResponse> {
        return this.http.post<RestoreResponse>(
            `/api/memos/${noteId}/versions/${versionId}/restore`,
            {},
        );
    }

    createCheckpoint(noteId: string, label?: string): Observable<MemoVersion> {
        return this.http
            .post<{ version: MemoVersion }>(`/api/memos/${noteId}/versions`, { label })
            .pipe(map((r) => r.version));
    }
}
```

### UI Components

| Component                   | Purpose                          |
| --------------------------- | -------------------------------- |
| `version-history.component` | Slide-in panel with version list |
| `version-preview.component` | Read-only preview before restore |

### Version History Panel

```
+----------------------------------+
| Version History           [x]    |
+----------------------------------+
| [Now]                            |
|   Current version                |
+----------------------------------+
| [5m ago]      Auto-save         |
|   "Planning document with..."    |
|   342 words              [View]  |
+----------------------------------+
| [12m ago]     Checkpoint ★      |
|   "Before major rewrite"         |
|   289 words              [View]  |
+----------------------------------+
| [1h ago]      Auto-save         |
|   "Initial planning notes..."    |
|                          [View]  |
+----------------------------------+
```

### Keyboard Shortcuts

- **Cmd/Ctrl+S**: Create manual checkpoint with optional label
- **Cmd/Ctrl+Z**: Standard undo (Y.js in-session)

### Note Header Integration

Add "History" button to note header that opens version panel:

```html
<button class="header-action" title="Version history" (click)="toggleVersionHistory.emit()">
    <span class="material-symbols-rounded">history</span>
</button>
```

---

## Storage Optimization

### Limits

```typescript
const MAX_VERSIONS_PER_MEMO = 200;
const MAX_STORAGE_PER_MEMO = 50 * 1024 * 1024; // 50MB
```

### Compression (Optional)

Consider LZ4 compression if storage becomes an issue. Y.js state is already fairly compact.

### Pruning

Run retention policy periodically (background job or on-demand):

```typescript
async function pruneOldVersions(noteId: string): Promise<void> {
    const versions = await getAllVersionsForNote(noteId);
    const toDelete: string[] = [];

    for (const version of versions) {
        const ageDays = getAgeDays(version.createdAt);

        if (ageDays > 90) {
            toDelete.push(version._id);
        } else if (ageDays > 30 && !isFirstInWeek(version)) {
            toDelete.push(version._id);
        }
        // ... apply other retention rules
    }

    await deleteMemoVersions(toDelete);
}
```

---

## User Experience

### How This Builds Confidence

1. **Visible safety net** - History button with badge shows protection is active
2. **Non-destructive restore** - Can "undo" a restore
3. **Clear timeline** - Human-readable timestamps and trigger types
4. **Preview before restore** - See exactly what you're restoring
5. **Manual checkpoints** - Cmd+S creates explicit save points
6. **Automatic protection** - Works without user action

### Restore Flow

1. Click "History" icon in note header
2. Slide-in panel shows version list (newest first)
3. Click version to see preview
4. Click "Restore" to confirm
5. Success toast: "Restored to version from [time]"
6. Document reloads with restored content

---

## Implementation Phases

### Phase 1: Core Backend (1-2 days)

- [ ] Create `memo_versions` collection and indexes
- [ ] Implement `memo-version.repo.ts`
- [ ] Implement `memo-version.service.ts`
- [ ] Integrate with `yjs-document.service.ts`
- [ ] Add API endpoints

### Phase 2: Basic Frontend (1-2 days)

- [ ] Create `MemoVersionService`
- [ ] Create `VersionHistoryComponent`
- [ ] Add "History" button to note header
- [ ] Implement restore functionality

### Phase 3: Enhanced UX (1 day)

- [ ] Version preview component
- [ ] Cmd+S manual checkpoints
- [ ] Version count badge
- [ ] Loading states and animations

### Phase 4: Storage Management (1 day)

- [ ] Retention policy job
- [ ] Storage limits and pruning
- [ ] Deduplication logic

### Phase 5: Polish (1 day)

- [ ] Tests
- [ ] Edge cases (offline, conflicts)
- [ ] Performance optimization

---

## Key Files

| File                                                 | Purpose                     |
| ---------------------------------------------------- | --------------------------- |
| `apps/api/src/repositories/memo.repo.ts`             | Add version tracking fields |
| `apps/api/src/services/yjs-document.service.ts`      | Auto-snapshot integration   |
| `apps/api/src/routes/memo.ts`                        | Pattern for new endpoints   |
| `apps/web/src/app/services/memo-document.service.ts` | Frontend Y.js handling      |
| `apps/web/src/app/components/molecules/note-header/` | Add history button          |

---

## Potential Challenges

| Challenge             | Mitigation                                       |
| --------------------- | ------------------------------------------------ |
| Large Y.js state      | Storage limits, optional compression             |
| Multi-user edits      | Content-aware deduplication                      |
| Restore during collab | Treat as regular Y.js update, sync via WebSocket |
| Offline versions      | Store queue in IndexedDB, sync when online       |
| Preview rendering     | Lightweight Y.js-to-HTML converter               |
