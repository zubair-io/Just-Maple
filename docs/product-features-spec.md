# Just Maple - Product Features Roadmap

This document outlines 15 recommended product features for Just Maple, with detailed specifications for the top 5 priority features.

---

## Feature Overview (15 Features)

### Top 5 (Detailed Specs Below)

1. **Templates System** - Pre-built and custom note templates
2. **Full-Text Search** - Global search across all content
3. **Version History** - Track and restore document changes
4. **AI Writing Assistant** - Smart writing help integrated into the editor
5. **Bi-directional Linking** - Wiki-style page linking with backlinks

### Additional Features (6-15)

6. **Tags/Labels** - Cross-notebook tagging for flexible organization
7. **Reminders & Scheduled Todos** - Push notifications for due dates
8. **Web Clipper** - Browser extension to save web content
9. **Dashboard/Home View** - Personalized home with recents, todos, activity
10. **Calendar Integration** - Sync todos with Google/Apple Calendar
11. **PDF Import & Annotation** - Import PDFs and annotate inline
12. **Inline Comments** - Collaborative review and feedback on documents
13. **Focus Mode** - Distraction-free writing environment
14. **Public Sharing Links** - Share individual pages publicly (read-only)
15. **Recurring Todos** - Tasks that repeat on schedule

---

## 1. Templates System

### Overview

Allow users to create notes from pre-built or custom templates, reducing friction for recurring document types like meeting notes, daily journals, and project briefs.

### User Stories

- As a user, I want to create a new note from a template so I don't start from scratch
- As a user, I want to save my current note as a template for future use
- As a user, I want to browse system-provided templates for common use cases
- As a user, I want to edit or delete my custom templates

### Functional Requirements

| Requirement         | Description                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| System Templates    | 5-10 pre-built templates (Meeting Notes, Daily Journal, Project Brief, Weekly Review, Bug Report, etc.) |
| Custom Templates    | Users can save any memo as a personal template                                                          |
| Template Gallery    | Modal/page to browse and preview templates                                                              |
| Quick Create        | "New from template" option in page creation flow                                                        |
| Template Variables  | Support placeholders like `{{date}}`, `{{notebook}}` auto-filled on creation                            |
| Template Categories | Organize templates by category (Work, Personal, Planning)                                               |

### Data Model

```typescript
interface Template {
    id: string; // UUID
    userId: string | null; // null = system template
    title: string;
    description: string;
    category: 'work' | 'personal' | 'planning' | 'custom';
    content: ProseMirrorJSON; // TipTap document structure
    isSystem: boolean;
    createdAt: Date;
    updatedAt: Date;
}
```

### API Endpoints

| Endpoint                                    | Method | Description                  |
| ------------------------------------------- | ------ | ---------------------------- |
| `GET /api/templates`                        | GET    | List system + user templates |
| `POST /api/templates`                       | POST   | Create custom template       |
| `PATCH /api/templates/:id`                  | PATCH  | Update template              |
| `DELETE /api/templates/:id`                 | DELETE | Delete custom template       |
| `POST /api/pages/from-template/:templateId` | POST   | Create page from template    |

### UI Components

- `TemplateGalleryModal` - Grid of template cards with preview
- `SaveAsTemplateButton` - In editor toolbar/menu
- `TemplateCard` - Preview card with title, description, category badge

### Implementation Notes

- Store templates in new `templates` collection
- Variable substitution happens server-side on page creation
- Templates use same ProseMirror JSON format as memos

---

## 2. Full-Text Search

### Overview

Global search across all notes, whiteboards (text elements), and messages with filters and instant results.

### User Stories

- As a user, I want to search all my content from one search bar
- As a user, I want to filter search by content type (memo, whiteboard, message)
- As a user, I want to filter search by notebook
- As a user, I want to see matching text snippets in results
- As a user, I want keyboard navigation in search results

### Functional Requirements

| Requirement       | Description                                             |
| ----------------- | ------------------------------------------------------- |
| Global Search Bar | Cmd/Ctrl+K to open search overlay                       |
| Instant Results   | Debounced search with <200ms perceived latency          |
| Content Types     | Search memos, whiteboards (text), messages, page titles |
| Filters           | Filter by type, notebook, date range                    |
| Snippets          | Show matching text with highlighted keywords            |
| Keyboard Nav      | Arrow keys to navigate, Enter to open                   |
| Recent Searches   | Show recent search queries                              |

### Data Model

```typescript
interface SearchResult {
    type: 'memo' | 'whiteboard' | 'message' | 'page';
    id: string;
    pageId: string;
    notebookId: string;
    title: string;
    snippet: string; // Matching text with <mark> tags
    score: number; // Relevance score
    updatedAt: Date;
}

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

### API Endpoints

| Endpoint                 | Method | Description                   |
| ------------------------ | ------ | ----------------------------- |
| `GET /api/search`        | GET    | Full-text search with filters |
| `POST /api/search/index` | POST   | Admin: trigger re-indexing    |

### Technical Approach

**Option A: MongoDB Atlas Search** (Recommended for MVP)

- Use MongoDB Atlas Search with text indexes
- Lucene-based, supports fuzzy matching, snippets
- Query using `$search` aggregation stage

**Option B: Dedicated Search Service**

- Elasticsearch or Meilisearch for advanced features
- Better for large scale, more complex relevance tuning

### UI Components

- `SearchOverlay` - Full-screen modal with search input
- `SearchResults` - Grouped results by type
- `SearchResultItem` - Individual result with snippet
- `SearchFilters` - Type and notebook filter chips

### Implementation Notes

- Create text indexes on `pages.title`, `pages.content`, `messages.content`
- Extract text from Y.js documents for indexing
- Consider background job to extract and index content
- Cache recent searches in localStorage

---

## 3. Version History

### Overview

Track document changes over time and allow users to view, compare, and restore previous versions.

### User Stories

- As a user, I want to see when my document was last edited
- As a user, I want to view the history of changes to a document
- As a user, I want to preview a previous version
- As a user, I want to restore a document to a previous version
- As a user, I want to see who made changes (for shared docs)

### Functional Requirements

| Requirement        | Description                                                  |
| ------------------ | ------------------------------------------------------------ |
| Auto-save Versions | Create version snapshot every 10 mins of active editing      |
| Manual Versions    | Allow users to create named versions                         |
| Version List       | Show timeline of versions with timestamps                    |
| Version Preview    | Read-only view of historical version                         |
| Diff View          | Side-by-side or inline diff between versions                 |
| Restore            | Restore any version (creates new version, preserves history) |
| Retention          | Keep 30 days of versions (configurable)                      |

### Data Model

```typescript
interface PageVersion {
    id: string; // UUID
    pageId: string; // Reference to page
    userId: string; // Who created this version
    name?: string; // Optional name for manual versions
    content: Buffer; // Y.js document state vector
    plainText: string; // Extracted text for preview
    isAutoSave: boolean;
    createdAt: Date;
}
```

### API Endpoints

| Endpoint                                          | Method | Description                  |
| ------------------------------------------------- | ------ | ---------------------------- |
| `GET /api/pages/:id/versions`                     | GET    | List versions for a page     |
| `GET /api/pages/:id/versions/:versionId`          | GET    | Get specific version content |
| `POST /api/pages/:id/versions`                    | POST   | Create manual named version  |
| `POST /api/pages/:id/versions/:versionId/restore` | POST   | Restore to version           |
| `DELETE /api/pages/:id/versions/:versionId`       | DELETE | Delete specific version      |

### UI Components

- `VersionHistoryPanel` - Slide-out panel with version timeline
- `VersionItem` - Version card with timestamp, author, name
- `VersionPreview` - Read-only editor showing historical content
- `VersionDiff` - Split view comparing two versions
- `CreateVersionButton` - Save current state as named version

### Implementation Notes

- Use Y.js `encodeStateAsUpdate` to capture document state efficiently
- Store versions in new `page_versions` collection
- Background job to cleanup versions older than retention period
- Version snapshots are space-efficient (store deltas if needed)
- For diff view, use Y.js to decode both states and compare

---

## 4. AI Writing Assistant

### Overview

Integrated AI assistant in the editor that helps users write, edit, summarize, and improve their content.

### User Stories

- As a user, I want AI to help me continue writing when I'm stuck
- As a user, I want to select text and ask AI to improve/simplify/expand it
- As a user, I want to generate a summary of my document
- As a user, I want to fix grammar and spelling with AI
- As a user, I want to translate selected text to another language

### Functional Requirements

| Requirement      | Description                                      |
| ---------------- | ------------------------------------------------ |
| Inline Commands  | Type `/ai` or select text + keyboard shortcut    |
| Continue Writing | AI continues from cursor position                |
| Edit Selection   | Improve, simplify, expand, shorten selected text |
| Summarize        | Generate summary of document or selection        |
| Grammar Fix      | Fix grammar/spelling issues                      |
| Translate        | Translate to specified language                  |
| Custom Prompt    | Free-form AI instruction                         |
| Accept/Reject    | Preview AI output before inserting               |
| Streaming        | Stream AI response for better UX                 |

### Data Model

```typescript
interface AIRequest {
    type:
        | 'continue'
        | 'improve'
        | 'simplify'
        | 'expand'
        | 'shorten'
        | 'summarize'
        | 'grammar'
        | 'translate'
        | 'custom';
    context: string; // Surrounding document content
    selection?: string; // Selected text (if applicable)
    instruction?: string; // Custom instruction
    targetLanguage?: string; // For translate
}

interface AIResponse {
    result: string;
    tokensUsed: number;
}
```

### API Endpoints

| Endpoint                | Method | Description                         |
| ----------------------- | ------ | ----------------------------------- |
| `POST /api/ai/generate` | POST   | Generate AI content (streaming SSE) |
| `GET /api/ai/usage`     | GET    | User's AI usage stats               |

### UI Components

- `AICommandMenu` - Popup menu with AI actions
- `AIPreviewPanel` - Floating panel showing AI output
- `AIInlineWidget` - Inline indicator during generation
- Extend existing `SlashCommandMenu` with AI commands

### Implementation Notes

- Use Claude API or OpenAI for generation
- Implement rate limiting per user (e.g., 50 requests/day free)
- Stream responses using Server-Sent Events
- Store usage metrics for potential monetization
- Context window: send ~2000 tokens of surrounding content
- Extend existing bot infrastructure or create dedicated AI service

---

## 5. Bi-directional Linking (Backlinks)

### Overview

Wiki-style linking between pages with automatic backlink discovery, enabling knowledge graph navigation.

### User Stories

- As a user, I want to link to another page by typing `[[Page Name]]`
- As a user, I want autocomplete suggestions when creating links
- As a user, I want to see all pages that link to the current page (backlinks)
- As a user, I want to see unlinked mentions (pages that mention this page's title)
- As a user, I want to create a new page from a link if it doesn't exist
- As a user, I want to visualize the link graph between my pages

### Functional Requirements

| Requirement       | Description                                     |
| ----------------- | ----------------------------------------------- |
| Wiki Links        | `[[Page Name]]` syntax creates clickable link   |
| Autocomplete      | Fuzzy search pages when typing `[[`             |
| Backlinks Panel   | Show all pages linking to current page          |
| Unlinked Mentions | Find pages mentioning title without link        |
| Create from Link  | `[[New Page]]` creates page if it doesn't exist |
| Hover Preview     | Hover over link to preview page content         |
| Graph View        | Visual node graph of page connections           |
| Link Rename       | Rename page updates all links automatically     |

### Data Model

```typescript
interface PageLink {
    sourcePageId: string; // Page containing the link
    targetPageId: string; // Page being linked to
    targetTitle: string; // Title at time of linking
    createdAt: Date;
}

// Extend Page model
interface Page {
    // ...existing fields
    outgoingLinks: string[]; // Page IDs this page links to
    incomingLinks: string[]; // Page IDs linking to this page
}
```

### API Endpoints

| Endpoint                               | Method | Description                        |
| -------------------------------------- | ------ | ---------------------------------- |
| `GET /api/pages/:id/backlinks`         | GET    | Get pages linking to this page     |
| `GET /api/pages/:id/unlinked-mentions` | GET    | Find unlinked mentions             |
| `GET /api/pages/search-links`          | GET    | Search pages for link autocomplete |
| `POST /api/pages/:id/links`            | POST   | Create link (updates indexes)      |
| `GET /api/pages/graph`                 | GET    | Get link graph for visualization   |

### TipTap Extension

```typescript
// New extension: wiki-link.ts
export const WikiLink = Node.create({
    name: 'wikiLink',
    group: 'inline',
    inline: true,
    atom: true,

    addAttributes() {
        return {
            pageId: { default: null },
            title: { default: '' },
        };
    },

    addInputRules() {
        // Match [[Page Name]] pattern
    },
});
```

### UI Components

- `WikiLinkNode` - Rendered inline link with hover preview
- `LinkAutocomplete` - Dropdown when typing `[[`
- `BacklinksPanel` - Sidebar panel showing incoming links
- `UnlinkedMentions` - Suggestions for creating links
- `GraphView` - Force-directed graph visualization (D3.js or similar)
- `LinkHoverPreview` - Floating preview card

### Implementation Notes

- Parse wiki links from TipTap document on save
- Maintain `page_links` collection for efficient backlink queries
- Index page titles for fast autocomplete search
- For graph view, consider client-side rendering with D3.js
- Handle link target rename by updating all source pages
- Consider adding this as a premium feature (graph view)

---

## Implementation Priority

| Priority | Feature                | Effort | Impact | Notes                |
| -------- | ---------------------- | ------ | ------ | -------------------- |
| 1        | Full-Text Search       | Medium | High   | Essential for scale  |
| 2        | Templates              | Low    | High   | Quick wins for users |
| 3        | AI Writing Assistant   | Medium | High   | Differentiator       |
| 4        | Bi-directional Linking | High   | High   | Knowledge management |
| 5        | Version History        | Medium | Medium | Safety & confidence  |

---

## Additional Features (6-15) - Brief Specs

### 6. Tags/Labels

Cross-notebook tagging system for flexible content organization beyond folder hierarchy.

- Add/remove tags on any page
- Filter sidebar by tags
- Tag management UI

### 7. Reminders & Scheduled Todos

Push notifications for todo due dates and custom reminders.

- Set reminder time on todos
- Daily digest of upcoming tasks
- APNs/FCM integration

### 8. Web Clipper

Browser extension to save web content directly to notebooks.

- Chrome/Firefox extension
- Save selection or full page
- Quick notebook selector

### 9. Dashboard/Home View

Personalized home page with activity feed and quick access.

- Recent pages
- Upcoming todos
- Quick create buttons
- Activity timeline

### 10. Calendar Integration

Sync todos with external calendars.

- Google Calendar OAuth
- Apple Calendar support
- Two-way sync of due dates

### 11. PDF Import & Annotation

Import PDFs and annotate inline with highlights and comments.

- PDF viewer in editor
- Highlight and annotate
- Export annotated PDF

### 12. Inline Comments

Collaborative review and feedback on documents.

- Select text and add comment
- Threaded replies
- Resolve/close comments

### 13. Focus Mode

Distraction-free writing environment.

- Hide sidebar and toolbar
- Typewriter scrolling
- Ambient sounds (optional)

### 14. Public Sharing Links

Share individual pages publicly (read-only).

- Generate shareable URL
- Password protection option
- View analytics

### 15. Recurring Todos

Tasks that repeat on a schedule.

- Daily/weekly/monthly/custom
- Auto-create next occurrence on completion
- Streak tracking

---

## Next Steps

1. Validate priorities with user research/feedback
2. Create technical design docs for top 2 features
3. Estimate engineering effort
4. Plan sprint(s) for implementation
5. Define success metrics for each feature
