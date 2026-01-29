# Full-Text Search Implementation Plan

**Priority**: High
**Effort**: Medium (~28 hours)
**Status**: Planning

## Executive Summary

Implement full-text search across all notes in Just Maple using **Azure AI Search** with a `search_index` collection in Cosmos DB for Y.js content extraction. This provides enterprise-grade search with fuzzy matching, relevance tuning, and native snippet highlighting.

**Reference**: See `docs/product-features-spec.md` Section 2 for user stories and requirements.

**Production Database**: Azure Cosmos DB (MongoDB API)
**Search Service**: Azure AI Search (formerly Azure Cognitive Search)

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
│  │  Frontend   │───▶│   Search    │───▶│  Azure AI Search │                  │
│  │  Search UI  │    │    API      │    │  (fuzzy, snippets)│                  │
│  └─────────────┘    └─────────────┘    └─────────────────┘                   │
│         │                                       ▲                             │
│         │                                       │ Indexer                     │
│         │                              ┌────────┴────────┐                    │
│         │                              │  search_index   │                    │
│         │                              │  (Cosmos DB)    │                    │
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

### Why Azure AI Search

| Feature              | Cosmos DB Text Index | Azure AI Search |
| -------------------- | -------------------- | --------------- |
| Fuzzy matching       | ❌                   | ✅              |
| Snippet highlighting | ❌ Manual            | ✅ Native       |
| Relevance tuning     | Basic                | Advanced (BM25) |
| Synonyms             | ❌                   | ✅              |
| Autocomplete         | ❌                   | ✅              |
| Filters + Facets     | Limited              | ✅ Full support |

### Data Flow

1. **Write path**: User edits memo → Y.js saved to `memos` → API decodes Y.js → Upserts to `search_index` → Azure AI Search indexer syncs
2. **Read path**: User searches → API queries Azure AI Search → Returns results with snippets

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

### Phase 2: Azure AI Search Setup

#### 2.1 Create Azure AI Search Resource

1. Create Azure AI Search service in Azure Portal (Basic tier ~$75/mo for production)
2. Note the service endpoint and admin API key

**Environment Variables** (add to `.env`):

```bash
AZURE_SEARCH_ENDPOINT=https://justmaple-search.search.windows.net
AZURE_SEARCH_ADMIN_KEY=your-admin-key
AZURE_SEARCH_INDEX_NAME=justmaple-notes
```

#### 2.2 Create Search Index Schema

**File**: `apps/api/src/services/azure-search.service.ts`

```typescript
import { SearchClient, SearchIndexClient, AzureKeyCredential } from '@azure/search-documents';

const indexDefinition = {
    name: 'justmaple-notes',
    fields: [
        { name: 'id', type: 'Edm.String', key: true, filterable: true },
        { name: 'pageId', type: 'Edm.String', filterable: true },
        { name: 'userId', type: 'Edm.String', filterable: true },
        { name: 'notebookId', type: 'Edm.String', filterable: true, facetable: true },
        { name: 'type', type: 'Edm.String', filterable: true, facetable: true },
        { name: 'title', type: 'Edm.String', searchable: true, analyzer: 'en.microsoft' },
        { name: 'plainText', type: 'Edm.String', searchable: true, analyzer: 'en.microsoft' },
        { name: 'preview', type: 'Edm.String' },
        { name: 'notebookLabel', type: 'Edm.String' },
        { name: 'updatedAt', type: 'Edm.DateTimeOffset', filterable: true, sortable: true },
    ],
    suggesters: [{ name: 'sg', searchMode: 'analyzingInfixMatching', sourceFields: ['title'] }],
    scoringProfiles: [
        {
            name: 'titleBoost',
            text: { weights: { title: 5, plainText: 1 } },
        },
    ],
    defaultScoringProfile: 'titleBoost',
};
```

#### 2.3 Cosmos DB Indexer (Auto-sync)

Create an indexer in Azure AI Search that automatically syncs from `search_index` collection:

```json
{
    "name": "cosmosdb-indexer",
    "dataSourceName": "cosmos-search-index",
    "targetIndexName": "justmaple-notes",
    "schedule": { "interval": "PT5M" },
    "fieldMappings": [
        { "sourceFieldName": "_id", "targetFieldName": "id" },
        { "sourceFieldName": "pageId", "targetFieldName": "pageId" },
        { "sourceFieldName": "userId", "targetFieldName": "userId" },
        { "sourceFieldName": "notebookId", "targetFieldName": "notebookId" },
        { "sourceFieldName": "type", "targetFieldName": "type" },
        { "sourceFieldName": "title", "targetFieldName": "title" },
        { "sourceFieldName": "plainText", "targetFieldName": "plainText" },
        { "sourceFieldName": "preview", "targetFieldName": "preview" },
        { "sourceFieldName": "updatedAt", "targetFieldName": "updatedAt" }
    ]
}
```

**Data Source** for Cosmos DB:

```json
{
    "name": "cosmos-search-index",
    "type": "cosmosdb",
    "credentials": { "connectionString": "AccountEndpoint=..." },
    "container": { "name": "search_index", "query": null }
}
```

#### 2.4 Cosmos DB Collection Indexes

**File**: `apps/api/src/db/client.ts`

```typescript
// Add to initDatabase() - indexes for the search_index collection
await database.collection('search_index').createIndex({ pageId: 1 }, { unique: true });
await database.collection('search_index').createIndex({ userId: 1 });
await database.collection('search_index').createIndex({ _ts: 1 }); // For change tracking
```

#### 2.5 Migration Script

**File**: `apps/api/scripts/migrations/007-create-search-index.ts`

- Iterates through all pages
- Extracts text from memos using Y.js decoding
- Upserts to `search_index` collection
- Processes in batches of 100-500 documents
- Azure AI Search indexer will auto-sync within 5 minutes

---

### Phase 3: API Endpoints

#### 3.1 Azure Search Service

**File**: `apps/api/src/services/azure-search.service.ts`

```typescript
import { SearchClient, AzureKeyCredential } from '@azure/search-documents';
import { findNotebooksForUser } from '../repositories/notebook.repo';

const searchClient = new SearchClient(
    process.env.AZURE_SEARCH_ENDPOINT!,
    process.env.AZURE_SEARCH_INDEX_NAME!,
    new AzureKeyCredential(process.env.AZURE_SEARCH_ADMIN_KEY!),
);

export interface SearchOptions {
    userId: string;
    types?: string[];
    notebookIds?: string[]; // User-requested filter (optional)
    dateFrom?: Date;
    dateTo?: Date;
    limit?: number;
    offset?: number;
}

/**
 * Get all notebook IDs the user has access to (owned, shared, or public)
 */
async function getAccessibleNotebookIds(userId: string): Promise<string[]> {
    const notebooks = await findNotebooksForUser(userId);
    return notebooks.map((n) => n._id);
}

export async function searchNotes(query: string, options: SearchOptions) {
    // CRITICAL: Get all notebooks user has access to for access control
    const accessibleNotebookIds = await getAccessibleNotebookIds(options.userId);

    if (accessibleNotebookIds.length === 0) {
        return []; // User has no accessible notebooks
    }

    // Build access control filter - user can only see content from accessible notebooks
    const accessFilter = accessibleNotebookIds.map((id) => `notebookId eq '${id}'`).join(' or ');

    const filters: string[] = [`(${accessFilter})`];

    // Additional user-requested filters
    if (options.types?.length) {
        const typeFilter = options.types.map((t) => `type eq '${t}'`).join(' or ');
        filters.push(`(${typeFilter})`);
    }

    // If user specifies notebookIds, intersect with accessible notebooks
    if (options.notebookIds?.length) {
        const requestedIds = options.notebookIds.filter((id) => accessibleNotebookIds.includes(id));
        if (requestedIds.length === 0) {
            return []; // User requested notebooks they don't have access to
        }
        const nbFilter = requestedIds.map((id) => `notebookId eq '${id}'`).join(' or ');
        filters.push(`(${nbFilter})`);
    }

    if (options.dateFrom) {
        filters.push(`updatedAt ge ${options.dateFrom.toISOString()}`);
    }
    if (options.dateTo) {
        filters.push(`updatedAt le ${options.dateTo.toISOString()}`);
    }

    const results = await searchClient.search(query, {
        filter: filters.join(' and '),
        top: options.limit || 20,
        skip: options.offset || 0,
        highlightFields: 'title,plainText',
        highlightPreTag: '<mark>',
        highlightPostTag: '</mark>',
        queryType: 'simple', // Use 'full' for Lucene syntax
        searchMode: 'any',
    });

    const items: SearchResult[] = [];
    for await (const result of results.results) {
        items.push({
            pageId: result.document.pageId,
            title: result.document.title,
            type: result.document.type,
            notebookId: result.document.notebookId,
            notebookLabel: result.document.notebookLabel,
            preview: result.document.preview,
            score: result.score || 0,
            highlights: [
                ...(result.highlights?.title?.map((h) => ({ field: 'title', snippet: h })) || []),
                ...(result.highlights?.plainText?.map((h) => ({ field: 'content', snippet: h })) ||
                    []),
            ],
            updatedAt: result.document.updatedAt,
        });
    }

    return items;
}

export async function suggestNotes(query: string, userId: string) {
    const results = await searchClient.suggest(query, 'sg', {
        filter: `userId eq '${userId}'`,
        top: 5,
        highlightPreTag: '<mark>',
        highlightPostTag: '</mark>',
    });

    return results.results.map((r) => ({
        text: r.text,
        pageId: r.document.pageId,
    }));
}
```

#### 3.2 Search Routes

**File**: `apps/api/src/routes/search.ts`

```typescript
export const searchRoutes = new Elysia({ prefix: '/api/search' })
    .use(jwtPlugin)
    .get('/', async ({ auth, query }) => {
        // GET /api/search?q=query&notebookIds=xxx,yyy&types=memo,whiteboard&dateFrom=2024-01-01&dateTo=2024-12-31&limit=20
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
    .get('/suggest', async ({ auth, query }) => {
        // GET /api/search/suggest?q=partial
        const suggestions = await suggestNotes(query.q, auth.user._id);
        return { suggestions };
    })
    .post('/reindex', async ({ auth }) => {
        // Admin endpoint to trigger re-indexing
        await reindexAllForUser(auth.user._id);
        return { message: 'Reindex started' };
    });
```

#### 3.3 Install Azure SDK

```bash
bun add @azure/search-documents
```

#### 3.4 Real-time Index Updates

When content changes, update the `search_index` collection. The Azure AI Search indexer will sync automatically every 5 minutes. For faster updates, you can also push directly to Azure AI Search.

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
| `apps/api/src/services/azure-search.service.ts`          | Azure AI Search SDK integration         |
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
| `apps/api/package.json`                               | Add @azure/search-documents         |
| `packages/shared/src/schemas/index.ts`                | Export search schemas               |
| `apps/web/src/app/services/db-stores.ts`              | Add search index store              |
| `apps/web/src/app/components/organisms/sidebar/*`     | Add search button                   |
| `apps/web/src/app/components/templates/main-layout/*` | Add Cmd+K shortcut                  |

### Azure Resources to Create

| Resource                   | Purpose                               |
| -------------------------- | ------------------------------------- |
| Azure AI Search service    | Full-text search with fuzzy matching  |
| Data Source (Cosmos DB)    | Points to search_index collection     |
| Index (justmaple-notes)    | Search index schema                   |
| Indexer (cosmosdb-indexer) | Auto-syncs from Cosmos DB every 5 min |

---

## Performance Considerations

### Indexing

- **Debounce updates**: 1-2 second delay to avoid excessive writes during editing
- **Background processing**: Async index updates don't block API responses
- **Incremental updates**: Only update changed content, not full re-index
- **Batch migration**: Process 100-500 documents at a time
- **Indexer sync**: Azure AI Search indexer runs every 5 minutes (configurable)

### Search

- **Scoring profile**: Title weighted 5x higher than content via Azure AI Search
- **Native highlighting**: Azure AI Search provides snippet highlighting automatically
- **Filters**: userId filter ensures access control at query time
- **Pagination**: top/skip parameters for efficient pagination
- **Latency**: Azure AI Search typically responds in 20-50ms

### Frontend

- **Input debounce**: 300ms delay before API call
- **Virtual scrolling**: For large result sets
- **Lazy loading**: Load full result details on hover/focus

---

## Security Considerations

### Access Control (Critical)

Search results MUST respect notebook sharing permissions:

1. **Pre-query access check**: Before searching, fetch all notebook IDs the user has access to via `findNotebooksForUser(userId)`
2. **Filter by accessible notebooks**: Azure AI Search filter includes `notebookId in (accessible IDs)`
3. **No userId-only filtering**: Never filter only by `userId` - this misses shared notebooks and exposes private content
4. **Intersection validation**: If user requests specific `notebookIds`, validate they have access before including in filter

```typescript
// WRONG - exposes only user's own content, misses shared notebooks
const filter = `userId eq '${userId}'`;

// CORRECT - includes all accessible notebooks (owned + shared + public)
const accessibleIds = await getAccessibleNotebookIds(userId);
const filter = accessibleIds.map((id) => `notebookId eq '${id}'`).join(' or ');
```

### Other Security Measures

1. **Query sanitization**: Escape special characters in search queries to prevent injection
2. **Rate limiting**: 30 requests/minute per user
3. **Result limiting**: Maximum 100 results per query
4. **API key security**: Azure Search admin key stored in environment variables, never exposed to client

---

## Implementation Sequence

| Step | Task                                            | Effort |
| ---- | ----------------------------------------------- | ------ |
| 1    | Create Azure AI Search resource in Azure Portal | 0.5h   |
| 2    | Create search schema in shared package          | 1h     |
| 3    | Implement azure-search.service.ts               | 2h     |
| 4    | Implement search.repo.ts (Y.js decoding)        | 3h     |
| 5    | Create Cosmos DB indexes for search_index       | 0.5h   |
| 6    | Configure Azure indexer + data source           | 1h     |
| 7    | Implement search API routes                     | 2h     |
| 8    | Write migration script for existing content     | 2h     |
| 9    | Add index update hooks to existing routes       | 2h     |
| 10   | Implement frontend search service               | 3h     |
| 11   | Build search modal component                    | 4h     |
| 12   | Add keyboard shortcuts and sidebar integration  | 1h     |
| 13   | Implement offline search capability             | 4h     |
| 14   | Testing and refinement                          | 4h     |

**Total**: ~30 hours

---

## Testing Strategy

- **Unit tests**: Y.js text extraction, filter building
- **Integration tests**: Azure AI Search queries, access control
- **E2E tests**: Search modal interaction, keyboard navigation
- **Performance tests**: Latency with 10K+ documents
- **Index tests**: Verify indexer syncs correctly from Cosmos DB

---

## Future Enhancements

- **Semantic search**: Add Azure AI Search semantic ranking for better relevance
- **Vector search**: Add embedding-based search for conceptual matching
- **Search within notebook**: Scoped search from sidebar
- **Autocomplete**: Use Azure AI Search suggester for type-ahead
- **Search analytics**: Track popular queries, zero-result queries
- **Synonyms**: Configure synonym maps for common terms
