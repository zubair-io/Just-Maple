# Full-Text Search Implementation Plan

**Priority**: High
**Effort**: Medium (~28 hours)
**Status**: Planning

## Executive Summary

Implement full-text search across all notes in Just Maple using **Cosmos DB text indexes** with a `search_index` collection for Y.js content extraction. Server-side snippet highlighting provides search result previews.

**Reference**: See `docs/product-features-spec.md` Section 2 for user stories and requirements.

**Production Database**: Azure Cosmos DB (MongoDB API)

---

## Requirements from Product Spec

### User Stories

- Search all content from one search bar
- Filter search by content type (memo, whiteboard, message)
- Filter search by notebook
- Filter search by date range
- See matching text snippets in results
- Keyboard navigation in search results

### Functional Requirements

| Requirement       | Description                                             |
| ----------------- | ------------------------------------------------------- |
| Global Search Bar | Cmd/Ctrl+K to open search overlay                       |
| Instant Results   | <200ms perceived latency after debounce                 |
| Content Types     | Search memos, whiteboards (text), messages, page titles |
| Filters           | Filter by type, notebook, date range                    |
| Snippets          | Show matching text with highlighted keywords            |
| Keyboard Nav      | Arrow keys to navigate, Enter to open                   |
| Recent Searches   | Show recent search queries (localStorage)               |

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Search Architecture                                  │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐                   │
│  │  Frontend   │───▶│   Search    │───▶│  search_index   │                   │
│  │  Search UI  │    │    API      │    │  (Cosmos DB)    │                   │
│  └─────────────┘    └─────────────┘    │  $text query    │                   │
│         │                              └────────┬────────┘                    │
│         │                                       ▲                             │
│         │                                       │ Y.js decode                 │
│         │                              ┌────────┴────────┐                    │
│         │                              │  memos/pages    │                    │
│         │                              │  (Cosmos DB)    │                    │
│         │                              └─────────────────┘                    │
│         │                                                                     │
│         │                              ┌─────────────────┐                    │
│         └─────────────────────────────▶│   IndexedDB     │                    │
│                (Offline Search)        │   Local Cache   │                    │
│                                        └─────────────────┘                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Write path**: User edits memo → Y.js saved to `memos` → API decodes Y.js → Upserts to `search_index`
2. **Read path**: User searches → API queries `search_index` with `$text` → Server highlights snippets → Returns results

### Access Control Model

Search must respect notebook sharing permissions:

```typescript
// Notebooks have sharing structure:
interface NotebookSharing {
    sharedWith: { userId: string; accessLevel: 'owner' | 'edit' | 'read' }[];
    isPublic: boolean;
}
```

**User can search content from:**

1. Notebooks where they are in `sharedWith` (any access level)
2. Public notebooks (`isPublic: true`)

**Implementation:**

```typescript
// Before searching, get accessible notebook IDs
const accessibleNotebookIds = await getAccessibleNotebookIds(userId);

// Then filter Azure AI Search by these notebook IDs
const filter = buildAccessFilter(userId, accessibleNotebookIds);
```

This is handled in Phase 3 (API Endpoints) below.

### Search Index Collection Schema

```typescript
// Matches product spec SearchResult type
interface SearchIndex {
    _id: string; // MongoDB ObjectId
    pageId: string; // Links to pages.id
    userId: string; // Owner for access control
    notebookId?: string;
    type: 'memo' | 'whiteboard' | 'message' | 'page'; // Content type
    title: string;
    plainText: string; // Extracted searchable text
    preview: string; // First 200 chars for display
    updatedAt: Date;
}

// Request model (from product spec)
interface SearchRequest {
    query: string;
    types?: ('memo' | 'whiteboard' | 'message')[];
    notebookIds?: string[];
    dateFrom?: Date;
    dateTo?: Date;
    limit?: number;
    offset?: number;
}
```

---

## Implementation Phases

### Phase 1: Search Index Collection and Extraction Service

#### 1.1 Create Search Schema

**File**: `packages/shared/src/schemas/search.ts`

```typescript
export const SearchIndexSchema = Type.Object({
    _id: Type.String(),
    pageId: Type.String(),
    userId: Type.String(),
    notebookId: Type.Optional(Type.String()),
    type: PageTypeSchema,
    title: Type.String(),
    plainText: Type.String(),
    preview: Type.String(),
    updatedAt: Type.String({ format: 'date-time' }),
});

export const SearchResultSchema = Type.Object({
    pageId: Type.String(),
    title: Type.String(),
    type: PageTypeSchema,
    preview: Type.String(),
    notebookId: Type.Optional(Type.String()),
    notebookLabel: Type.Optional(Type.String()),
    score: Type.Number(),
    highlights: Type.Array(
        Type.Object({
            field: Type.String(),
            snippet: Type.String(),
        }),
    ),
    updatedAt: Type.String({ format: 'date-time' }),
});
```

#### 1.2 Text Extraction Service

**File**: `apps/api/src/services/search-indexer.service.ts`

Responsibilities:

- Extract text from ProseMirror JSON using existing `extractText()` utility from `packages/shared/src/utils/content-traversal.ts`
- Decode Y.js binary state and extract text content from memos
- Extract text from whiteboard text elements
- Generate preview snippets (first 200 chars)
- Batch processing for migration

#### 1.3 Search Repository

**File**: `apps/api/src/repositories/search.repo.ts`

```typescript
export async function searchPages(
    userId: string,
    query: string,
    options?: {
        notebookId?: string;
        types?: PageType[];
        limit?: number;
        offset?: number;
    },
): Promise<SearchResult[]>;

export async function indexPage(pageId: string): Promise<void>;
export async function removeFromIndex(pageId: string): Promise<void>;
export async function reindexAllForUser(userId: string): Promise<void>;
```

---

### Phase 2: Database Indexes

#### 2.1 Create Cosmos DB Text Index

**File**: `apps/api/src/db/client.ts`

```typescript
// Add to initDatabase() - indexes for the search_index collection
await database.collection('search_index').createIndex(
    { title: 'text', plainText: 'text' },
    {
        weights: { title: 10, plainText: 1 },
        name: 'search_text_index',
    },
);
await database.collection('search_index').createIndex({ pageId: 1 }, { unique: true });
await database.collection('search_index').createIndex({ notebookId: 1 });
await database.collection('search_index').createIndex({ type: 1 });
await database.collection('search_index').createIndex({ updatedAt: -1 });
```

#### 2.2 Migration Script

**File**: `apps/api/scripts/migrations/007-create-search-index.ts`

- Iterates through all pages
- Extracts text from memos using Y.js decoding
- Upserts to `search_index` collection
- Processes in batches of 100-500 documents

---

### Phase 3: API Endpoints

#### 3.1 Search Service

**File**: `apps/api/src/services/search.service.ts`

```typescript
import { findNotebooksForUser } from '../repositories/notebook.repo';
import { getDatabase } from '../db/client';

export interface SearchOptions {
    userId: string;
    types?: string[];
    notebookIds?: string[];
    dateFrom?: Date;
    dateTo?: Date;
    limit?: number;
    offset?: number;
}

export interface SearchResult {
    pageId: string;
    title: string;
    type: string;
    notebookId?: string;
    notebookLabel?: string;
    preview: string;
    snippet: string;
    score: number;
    updatedAt: Date;
}

/**
 * Get all notebook IDs the user has access to (owned, shared, or public)
 */
async function getAccessibleNotebookIds(userId: string): Promise<string[]> {
    const notebooks = await findNotebooksForUser(userId);
    return notebooks.map((n) => n._id);
}

/**
 * Highlight search terms in text and extract snippet
 */
function highlightSnippet(text: string, query: string, contextLength = 100): string {
    const terms = query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 0);
    const lowerText = text.toLowerCase();

    // Find first matching term position
    let matchPos = -1;
    for (const term of terms) {
        const pos = lowerText.indexOf(term);
        if (pos !== -1 && (matchPos === -1 || pos < matchPos)) {
            matchPos = pos;
        }
    }

    if (matchPos === -1) return text.slice(0, contextLength * 2);

    // Extract context around match
    const start = Math.max(0, matchPos - contextLength);
    const end = Math.min(text.length, matchPos + contextLength);
    let snippet = text.slice(start, end);

    // Wrap matches in <mark> tags
    for (const term of terms) {
        const regex = new RegExp(`(${escapeRegex(term)})`, 'gi');
        snippet = snippet.replace(regex, '<mark>$1</mark>');
    }

    return (start > 0 ? '...' : '') + snippet + (end < text.length ? '...' : '');
}

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function searchNotes(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const db = getDatabase();

    // CRITICAL: Get all notebooks user has access to for access control
    const accessibleNotebookIds = await getAccessibleNotebookIds(options.userId);

    if (accessibleNotebookIds.length === 0) {
        return [];
    }

    // Build MongoDB filter
    const filter: Record<string, unknown> = {
        notebookId: { $in: accessibleNotebookIds },
        $text: { $search: query },
    };

    // Additional user-requested filters
    if (options.types?.length) {
        filter.type = { $in: options.types };
    }

    // If user specifies notebookIds, intersect with accessible notebooks
    if (options.notebookIds?.length) {
        const requestedIds = options.notebookIds.filter((id) => accessibleNotebookIds.includes(id));
        if (requestedIds.length === 0) {
            return [];
        }
        filter.notebookId = { $in: requestedIds };
    }

    if (options.dateFrom || options.dateTo) {
        filter.updatedAt = {};
        if (options.dateFrom) (filter.updatedAt as Record<string, Date>).$gte = options.dateFrom;
        if (options.dateTo) (filter.updatedAt as Record<string, Date>).$lte = options.dateTo;
    }

    const results = await db
        .collection('search_index')
        .find(filter, { projection: { score: { $meta: 'textScore' } } })
        .sort({ score: { $meta: 'textScore' } })
        .limit(options.limit || 20)
        .skip(options.offset || 0)
        .toArray();

    // Add highlighted snippets
    return results.map((r) => ({
        pageId: r.pageId,
        title: r.title,
        type: r.type,
        notebookId: r.notebookId,
        notebookLabel: r.notebookLabel,
        preview: r.preview,
        snippet: highlightSnippet(r.plainText, query),
        score: r.score || 0,
        updatedAt: r.updatedAt,
    }));
}
```

#### 3.2 Search Routes

**File**: `apps/api/src/routes/search.ts`

```typescript
import { Elysia } from 'elysia';
import { jwtPlugin } from '../middleware/jwt';
import { searchNotes } from '../services/search.service';
import { reindexAllForUser } from '../repositories/search.repo';

export const searchRoutes = new Elysia({ prefix: '/api/search' })
    .use(jwtPlugin)
    .get('/', async ({ auth, query }) => {
        // GET /api/search?q=query&notebookIds=xxx,yyy&types=memo,whiteboard&limit=20
        const results = await searchNotes(query.q, {
            userId: auth.user._id,
            notebookIds: query.notebookIds?.split(','),
            types: query.types?.split(','),
            dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
            dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
            limit: parseInt(query.limit) || 20,
            offset: parseInt(query.offset) || 0,
        });
        return { results };
    })
    .post('/reindex', async ({ auth }) => {
        // Admin endpoint to trigger re-indexing
        await reindexAllForUser(auth.user._id);
        return { message: 'Reindex started' };
    });
```

#### 3.3 Real-time Index Updates

When content changes, update the `search_index` collection immediately.

**File**: `apps/api/src/repositories/search.repo.ts`

```typescript
import * as Y from 'yjs';
import { extractText } from '@maple/shared';

export async function indexPage(pageId: string): Promise<void> {
    const page = await findPageById(pageId);
    if (!page) return;

    let plainText = page.title || '';

    // Extract text based on page type
    if (page.type === 'memo') {
        const memo = await findMemoByNoteId(pageId);
        if (memo?.state) {
            const ydoc = new Y.Doc();
            Y.applyUpdate(ydoc, new Uint8Array(memo.state.buffer));
            const content = ydoc.getXmlFragment('prosemirror');
            plainText += ' ' + extractTextFromYjs(content);
        }
    } else if (page.type === 'whiteboard') {
        // Extract text from whiteboard text elements
        const wb = await findWhiteboardById(pageId);
        if (wb) {
            plainText += ' ' + extractWhiteboardText(wb);
        }
    }

    // Upsert to search_index collection
    await db.collection('search_index').updateOne(
        { pageId },
        {
            $set: {
                pageId,
                userId: page.userId,
                notebookId: page.notebookId,
                type: page.type,
                title: page.title,
                plainText,
                preview: plainText.slice(0, 200),
                notebookLabel: page.notebookLabel,
                updatedAt: new Date(),
            },
        },
        { upsert: true },
    );
}

export async function removeFromIndex(pageId: string): Promise<void> {
    await db.collection('search_index').deleteOne({ pageId });
}
```

Add hooks to existing endpoints:

- `apps/api/src/routes/pages.ts` - After page create/update/delete
- `apps/api/src/routes/memo.ts` - After memo state update

```typescript
// After successful update:
indexPage(page.id).catch(console.error);
```

---

### Phase 4: Frontend Search UI

#### 4.1 Search Service

**File**: `apps/web/src/app/services/search.service.ts`

```typescript
@Injectable({ providedIn: 'root' })
export class SearchService {
    private readonly http = inject(HttpClient);

    readonly searchResults = signal<SearchResult[]>([]);
    readonly isSearching = signal(false);
    readonly searchQuery = signal('');

    search(query: string, options?: SearchOptions): Observable<SearchResult[]>;
    searchOffline(query: string): Promise<SearchResult[]>;
    buildLocalIndex(): Promise<void>;
}
```

#### 4.2 Search Modal Component

**Files**:

- `apps/web/src/app/components/organisms/search/search.component.ts`
- `apps/web/src/app/components/organisms/search/search.component.html`
- `apps/web/src/app/components/organisms/search/search.component.scss`

Features:

- Triggered by Cmd+K / Ctrl+K
- Debounced input (300ms) with <200ms perceived latency goal
- Keyboard navigation (up/down/enter/esc)
- Recent searches (stored in localStorage)
- Filter by type, notebook, and date range
- Results grouped by type (per product spec)
- Highlight matching text with `<mark>` tags in results

```html
<div class="search-modal" (keydown)="handleKeydown($event)">
    <div class="search-input-container">
        <span class="material-symbols-rounded">search</span>
        <input type="text" [(ngModel)]="searchQuery" placeholder="Search notes..." autofocus />
        <kbd>ESC</kbd>
    </div>

    <div class="search-filters">
        <!-- Type filters: All, Notes, Whiteboards, Messages -->
        <button [class.active]="!typeFilter()" (click)="setTypeFilter(null)">All</button>
        <button [class.active]="typeFilter() === 'memo'" (click)="setTypeFilter('memo')">
            Notes
        </button>
        <button
            [class.active]="typeFilter() === 'whiteboard'"
            (click)="setTypeFilter('whiteboard')"
        >
            Whiteboards
        </button>
        <button [class.active]="typeFilter() === 'message'" (click)="setTypeFilter('message')">
            Messages
        </button>
    </div>

    <!-- Recent searches when query is empty -->
    @if (!searchQuery() && recentSearches().length) {
    <div class="recent-searches">
        <span class="section-label">Recent</span>
        @for (recent of recentSearches(); track recent) {
        <button (click)="searchQuery.set(recent)">{{ recent }}</button>
        }
    </div>
    }

    <!-- Results grouped by type (per product spec) -->
    <div class="search-results">
        @for (group of groupedResults(); track group.type) {
        <div class="result-group">
            <span class="group-label">{{ group.label }}</span>
            @for (result of group.results; track result.pageId; let i = $index) {
            <a
                [routerLink]="getResultLink(result)"
                class="search-result-item"
                [class.selected]="selectedIndex() === getGlobalIndex(group, i)"
                (click)="close()"
            >
                <span class="result-icon material-symbols-rounded"
                    >{{ getTypeIcon(result.type) }}</span
                >
                <div class="result-content">
                    <span class="result-title">{{ result.title }}</span>
                    <span class="result-preview" [innerHTML]="result.snippet"></span>
                    <span class="result-meta"
                        >{{ result.notebookLabel }} · {{ result.updatedAt | date }}</span
                    >
                </div>
            </a>
            }
        </div>
        } @if (isSearching()) {
        <div class="loading">Searching...</div>
        } @if (!isSearching() && searchQuery() && !groupedResults().length) {
        <div class="no-results">No results found</div>
        }
    </div>
</div>
```

**Component Logic for Grouping**:

```typescript
readonly groupedResults = computed(() => {
    const results = this.searchResults();
    const groups = [
        { type: 'memo', label: 'Notes', results: [] as SearchResult[] },
        { type: 'whiteboard', label: 'Whiteboards', results: [] as SearchResult[] },
        { type: 'message', label: 'Messages', results: [] as SearchResult[] },
    ];

    for (const result of results) {
        const group = groups.find(g => g.type === result.type);
        if (group) group.results.push(result);
    }

    return groups.filter(g => g.results.length > 0);
});
```

#### 4.3 Keyboard Shortcut Integration

Add to `apps/web/src/app/components/templates/main-layout/main-layout.component.ts`:

```typescript
@HostListener('document:keydown', ['$event'])
handleKeyboardShortcut(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        this.openSearch();
    }
}
```

---

### Phase 5: Offline Search Capability

#### 5.1 Local Search Index Store

**File**: `apps/web/src/app/services/db-stores.ts`

```typescript
export const DB_STORES = {
    // ... existing stores
    SEARCH_INDEX: 'search_index',
};
```

#### 5.2 Search Index Sync Service

**File**: `apps/web/src/app/services/search-index.service.ts`

- Syncs server search index to IndexedDB
- Implements simple fuzzy matching locally
- Uses Web Worker for non-blocking search

---

## Files Summary

### New Files

| File                                                     | Purpose                                 |
| -------------------------------------------------------- | --------------------------------------- |
| `packages/shared/src/schemas/search.ts`                  | Search index and result TypeBox schemas |
| `apps/api/src/services/search.service.ts`                | Search service with Cosmos DB $text     |
| `apps/api/src/repositories/search.repo.ts`               | search_index collection + Y.js decoding |
| `apps/api/src/routes/search.ts`                          | Search API endpoints                    |
| `apps/api/scripts/migrations/007-create-search-index.ts` | Initial index migration                 |
| `apps/web/src/app/services/search.service.ts`            | Frontend search service                 |
| `apps/web/src/app/components/organisms/search/*`         | Search modal component                  |

### Modified Files

| File                                                  | Changes                             |
| ----------------------------------------------------- | ----------------------------------- |
| `apps/api/src/db/client.ts`                           | Add search_index collection indexes |
| `apps/api/src/index.ts`                               | Register search routes              |
| `apps/api/src/routes/pages.ts`                        | Add index update hooks              |
| `apps/api/src/routes/memo.ts`                         | Add index update hooks              |
| `packages/shared/src/schemas/index.ts`                | Export search schemas               |
| `apps/web/src/app/services/db-stores.ts`              | Add search index store              |
| `apps/web/src/app/components/organisms/sidebar/*`     | Add search button                   |
| `apps/web/src/app/components/templates/main-layout/*` | Add Cmd+K shortcut                  |

---

## Performance Considerations

### Indexing

- **Debounce updates**: 1-2 second delay to avoid excessive writes during editing
- **Background processing**: Async index updates don't block API responses
- **Incremental updates**: Only update changed content, not full re-index
- **Batch migration**: Process 100-500 documents at a time

### Search

- **Text index weights**: Title weighted 10x higher than content
- **Server-side highlighting**: Generate snippets with `<mark>` tags server-side
- **Access control**: Filter by accessible notebookIds (not userId) at query time
- **Pagination**: limit/skip parameters for efficient pagination
- **Notebook lookup caching**: Consider caching accessible notebook IDs for 1-5 min to reduce DB calls

### Frontend

- **Input debounce**: 300ms delay before API call
- **Virtual scrolling**: For large result sets
- **Lazy loading**: Load full result details on hover/focus

---

## Security Considerations

### Access Control (Critical)

Search results MUST respect notebook sharing permissions:

1. **Pre-query access check**: Before searching, fetch all notebook IDs the user has access to via `findNotebooksForUser(userId)`
2. **Filter by accessible notebooks**: MongoDB filter includes `notebookId: { $in: accessibleIds }`
3. **No userId-only filtering**: Never filter only by `userId` - this misses shared notebooks and exposes private content
4. **Intersection validation**: If user requests specific `notebookIds`, validate they have access before including in filter

```typescript
// WRONG - exposes only user's own content, misses shared notebooks
const filter = { userId };

// CORRECT - includes all accessible notebooks (owned + shared + public)
const accessibleIds = await getAccessibleNotebookIds(userId);
const filter = { notebookId: { $in: accessibleIds } };
```

### Other Security Measures

1. **Query sanitization**: Escape special characters in search queries to prevent injection
2. **Rate limiting**: 30 requests/minute per user
3. **Result limiting**: Maximum 100 results per query

---

## Implementation Sequence

| Step | Task                                           | Effort |
| ---- | ---------------------------------------------- | ------ |
| 1    | Create search schema in shared package         | 1h     |
| 2    | Create Cosmos DB text indexes for search_index | 0.5h   |
| 3    | Implement search.service.ts (Cosmos DB $text)  | 2h     |
| 4    | Implement search.repo.ts (Y.js decoding)       | 3h     |
| 5    | Implement search API routes                    | 1h     |
| 6    | Write migration script for existing content    | 2h     |
| 7    | Add index update hooks to existing routes      | 2h     |
| 8    | Implement frontend search service              | 3h     |
| 9    | Build search modal component                   | 4h     |
| 10   | Add keyboard shortcuts and sidebar integration | 1h     |
| 11   | Implement offline search capability            | 4h     |
| 12   | Testing and refinement                         | 4h     |

**Total**: ~27.5 hours

---

## Testing Strategy

- **Unit tests**: Y.js text extraction, filter building, snippet highlighting
- **Integration tests**: Cosmos DB text search queries, access control
- **E2E tests**: Search modal interaction, keyboard navigation
- **Performance tests**: Latency with 10K+ documents

---

## Future Enhancements

- **Azure AI Search upgrade**: For fuzzy matching, synonyms, better relevance
- **Search within notebook**: Scoped search from sidebar
- **Autocomplete**: Type-ahead suggestions from titles
- **Search analytics**: Track popular queries, zero-result queries
