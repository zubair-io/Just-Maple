# Bi-Directional Linking & Knowledge Graph Implementation Plan

## Executive Summary

This plan outlines the implementation of Roam/Obsidian-style bi-directional linking for Just Maple, enabling users to create interconnected notes with automatic backlink tracking and knowledge graph visualization.

---

## Feature Overview

### Core Capabilities

1. **Page Links** - Reference any page from within another page (inline or block)
2. **Backlink Panel** - See all pages that link to the current page
3. **Tag Pages** - Tags as first-class pages with bidirectional relationships
4. **Knowledge Graph** - Visual graph of page connections
5. **Link Suggestions** - Intelligent suggestions based on content
6. **Unlinked Mentions** - Find text that matches page titles but isn't linked

---

## Phase 1: Foundation - Page Link Infrastructure

### 1.1 Schema Extensions

**File: `packages/shared/src/schemas/page.ts`**

Add link metadata to Page schema:

```typescript
// New types for link tracking
export const PageLinkSchema = Type.Object({
    pageId: Type.String(),           // Target page UUID
    title: Type.String(),            // Denormalized for display
    type: Type.Union([
        Type.Literal('inline'),      // [[Page Name]] style
        Type.Literal('block'),       // Embed-style preview block
        Type.Literal('tag'),         // #tag reference
    ]),
    context: Type.Optional(Type.String()),  // Surrounding text snippet
});

export const PageLinksMetaSchema = Type.Object({
    forwardLinks: Type.Array(PageLinkSchema),   // Pages this page links to
    backlinks: Type.Array(PageLinkSchema),      // Pages linking to this page
    lastIndexedAt: Type.Optional(Type.String()), // When links were last extracted
});

// Add to existing PageSchema
linksMeta: Type.Optional(PageLinksMetaSchema),
```

**File: `packages/shared/src/schemas/tag.ts`**

Extend tags to be page-backed:

```typescript
export const TagSchema = Type.Object({
    _id: Type.String(),
    id: Type.String(), // UUID for routing
    label: Type.String(), // Display name
    userId: Type.String(),
    color: Type.Optional(Type.String()),
    icon: Type.Optional(Type.String()),

    // New: Tag as page
    pageId: Type.Optional(Type.String()), // Associated tag page
    description: Type.Optional(Type.String()),

    // Metadata
    useCount: Type.Optional(Type.Number()), // Denormalized count
    createdAt: Type.String(),
    updatedAt: Type.String(),
});
```

### 1.2 TipTap Extensions

**New File: `apps/web/src/app/components/organisms/notebook-editor/extensions/page-link.ts`**

Inline page link (wiki-link style):

```typescript
import { Mark, mergeAttributes } from '@tiptap/core';

export interface PageLinkOptions {
    HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        pageLink: {
            setPageLink: (attributes: { pageId: string; title: string }) => ReturnType;
            unsetPageLink: () => ReturnType;
        };
    }
}

export const PageLink = Mark.create<PageLinkOptions>({
    name: 'pageLink',

    addOptions() {
        return {
            HTMLAttributes: {},
        };
    },

    addAttributes() {
        return {
            pageId: { default: null },
            title: { default: null },
            type: { default: 'inline' },
        };
    },

    parseHTML() {
        return [{ tag: 'span[data-page-link]' }];
    },

    renderHTML({ HTMLAttributes }) {
        return [
            'span',
            mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
                'data-page-link': HTMLAttributes.pageId,
                class: 'page-link',
            }),
            0,
        ];
    },

    addCommands() {
        return {
            setPageLink:
                (attributes) =>
                ({ commands }) => {
                    return commands.setMark(this.name, attributes);
                },
            unsetPageLink:
                () =>
                ({ commands }) => {
                    return commands.unsetMark(this.name);
                },
        };
    },
});
```

**New File: `apps/web/src/app/components/organisms/notebook-editor/extensions/page-link-block.ts`**

Block-level page embed with preview:

```typescript
import { Node, mergeAttributes } from '@tiptap/core';
import { AngularNodeViewRenderer } from 'ngx-tiptap';

export const PageLinkBlock = Node.create({
    name: 'pageLinkBlock',
    group: 'block',
    atom: true,
    draggable: true,

    addAttributes() {
        return {
            pageId: { default: null },
            title: { default: null },
            showPreview: { default: true },
            previewLines: { default: 3 },
        };
    },

    parseHTML() {
        return [{ tag: 'div[data-page-link-block]' }];
    },

    renderHTML({ HTMLAttributes }) {
        return [
            'div',
            mergeAttributes(HTMLAttributes, {
                'data-page-link-block': HTMLAttributes.pageId,
                class: 'page-link-block',
            }),
        ];
    },

    addNodeView() {
        return AngularNodeViewRenderer(PageLinkBlockComponent);
    },
});
```

**New File: `apps/web/src/app/components/organisms/notebook-editor/extensions/tag-link.ts`**

Hashtag link extension:

```typescript
import { Mark, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export const TagLink = Mark.create({
    name: 'tagLink',

    addAttributes() {
        return {
            tagId: { default: null },
            label: { default: null },
        };
    },

    parseHTML() {
        return [{ tag: 'span[data-tag-link]' }];
    },

    renderHTML({ HTMLAttributes }) {
        return [
            'span',
            mergeAttributes(HTMLAttributes, {
                'data-tag-link': HTMLAttributes.tagId,
                class: 'tag-link',
            }),
            0,
        ];
    },

    // Auto-detect #hashtags while typing
    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: new PluginKey('tagLinkAutoDetect'),
                // Implementation: detect #word patterns and convert to tagLink marks
            }),
        ];
    },
});
```

### 1.3 Wiki-Link Input Handler

**New File: `apps/web/src/app/components/organisms/notebook-editor/extensions/wiki-link-input.ts`**

Handle `[[` input to trigger page search:

```typescript
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export const WikiLinkInput = Extension.create({
    name: 'wikiLinkInput',

    addProseMirrorPlugins() {
        const editor = this.editor;

        return [
            new Plugin({
                key: new PluginKey('wikiLinkInput'),
                props: {
                    handleTextInput(view, from, to, text) {
                        // Detect [[ pattern
                        const { state } = view;
                        const $from = state.doc.resolve(from);
                        const textBefore = $from.parent.textBetween(
                            Math.max(0, $from.parentOffset - 1),
                            $from.parentOffset,
                            null,
                            '\ufffc',
                        );

                        if (textBefore === '[' && text === '[') {
                            // Trigger page search popup
                            editor.emit('openPageLinkSearch', { from, to });
                            return true;
                        }
                        return false;
                    },
                },
            }),
        ];
    },
});
```

### 1.4 Slash Command Integration

**File: `apps/web/src/app/components/organisms/notebook-editor/extensions/slash-commands.ts`**

Add link commands to existing slash menu:

```typescript
// Add to existing suggestions array
{
    title: 'Page Link',
    description: 'Link to another page',
    icon: 'link',
    command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run();
        editor.emit('openPageLinkSearch', { inline: true });
    },
},
{
    title: 'Page Embed',
    description: 'Embed page with preview',
    icon: 'file-text',
    command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run();
        editor.emit('openPageLinkSearch', { inline: false, embed: true });
    },
},
{
    title: 'Tag',
    description: 'Add a tag',
    icon: 'hash',
    command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run();
        editor.emit('openTagSearch', {});
    },
},
```

---

## Phase 2: Backend Link Service

### 2.1 Link Extraction Service

**New File: `apps/api/src/services/link.service.ts`**

```typescript
import type { PageContent, PageLink } from '@maple/shared';

export class LinkService {
    /**
     * Extract all page links from content
     */
    extractLinksFromContent(content: PageContent): PageLink[] {
        const links: PageLink[] = [];

        const traverse = (node: any) => {
            // Check for pageLink marks
            if (node.marks) {
                for (const mark of node.marks) {
                    if (mark.type === 'pageLink') {
                        links.push({
                            pageId: mark.attrs.pageId,
                            title: mark.attrs.title,
                            type: 'inline',
                        });
                    }
                    if (mark.type === 'tagLink') {
                        links.push({
                            pageId: mark.attrs.tagId,
                            title: mark.attrs.label,
                            type: 'tag',
                        });
                    }
                }
            }

            // Check for pageLinkBlock nodes
            if (node.type === 'pageLinkBlock') {
                links.push({
                    pageId: node.attrs.pageId,
                    title: node.attrs.title,
                    type: 'block',
                });
            }

            // Recurse into children
            if (node.content) {
                for (const child of node.content) {
                    traverse(child);
                }
            }
        };

        traverse(content);
        return links;
    }

    /**
     * Update backlinks when a page's content changes
     */
    async updateLinksForPage(pageId: string, content: PageContent): Promise<void> {
        const db = getDb();
        const pages = db.collection('pages');

        // Extract new forward links
        const newLinks = this.extractLinksFromContent(content);
        const newLinkIds = new Set(newLinks.map((l) => l.pageId));

        // Get old forward links
        const page = await pages.findOne({ id: pageId });
        const oldLinkIds = new Set(page?.linksMeta?.forwardLinks?.map((l) => l.pageId) || []);

        // Find added and removed links
        const addedLinks = newLinks.filter((l) => !oldLinkIds.has(l.pageId));
        const removedLinkIds = [...oldLinkIds].filter((id) => !newLinkIds.has(id));

        // Update this page's forward links
        await pages.updateOne(
            { id: pageId },
            {
                $set: {
                    'linksMeta.forwardLinks': newLinks,
                    'linksMeta.lastIndexedAt': new Date().toISOString(),
                },
            },
        );

        // Add backlinks to newly linked pages
        if (addedLinks.length > 0) {
            const sourceTitle = page?.title || 'Untitled';
            for (const link of addedLinks) {
                await pages.updateOne(
                    { id: link.pageId },
                    {
                        $push: {
                            'linksMeta.backlinks': {
                                pageId: pageId,
                                title: sourceTitle,
                                type: link.type,
                            },
                        },
                    },
                );
            }
        }

        // Remove backlinks from unlinked pages
        if (removedLinkIds.length > 0) {
            await pages.updateMany(
                { id: { $in: removedLinkIds } },
                { $pull: { 'linksMeta.backlinks': { pageId: pageId } } },
            );
        }
    }

    /**
     * Get all backlinks for a page
     */
    async getBacklinks(pageId: string): Promise<PageLink[]> {
        const db = getDb();
        const page = await db.collection('pages').findOne({ id: pageId });
        return page?.linksMeta?.backlinks || [];
    }

    /**
     * Find unlinked mentions of a page title
     */
    async findUnlinkedMentions(
        pageId: string,
        notebookId: string,
    ): Promise<{ pageId: string; context: string }[]> {
        const db = getDb();
        const pages = db.collection('pages');

        const targetPage = await pages.findOne({ id: pageId });
        if (!targetPage?.title) return [];

        const titleRegex = new RegExp(targetPage.title, 'i');

        // Search for title in other pages' content
        const mentions = await pages
            .aggregate([
                {
                    $match: {
                        notebookId,
                        id: { $ne: pageId },
                        content: { $regex: titleRegex },
                    },
                },
                {
                    $project: {
                        pageId: '$id',
                        title: 1,
                        // Extract context around mention
                    },
                },
            ])
            .toArray();

        // Filter out pages that already have a link
        const linkedPages = new Set(targetPage?.linksMeta?.backlinks?.map((l) => l.pageId) || []);

        return mentions.filter((m) => !linkedPages.has(m.pageId));
    }

    /**
     * Handle page deletion - clean up all link references
     */
    async handlePageDeletion(pageId: string): Promise<void> {
        const db = getDb();
        const pages = db.collection('pages');

        // Get the page being deleted
        const page = await pages.findOne({ id: pageId });
        if (!page) return;

        // Remove backlinks from pages this page linked to
        const forwardLinkIds = page.linksMeta?.forwardLinks?.map((l) => l.pageId) || [];
        if (forwardLinkIds.length > 0) {
            await pages.updateMany(
                { id: { $in: forwardLinkIds } },
                { $pull: { 'linksMeta.backlinks': { pageId: pageId } } },
            );
        }

        // Mark backlinks to this page as broken (optional: or remove)
        const backlinkPageIds = page.linksMeta?.backlinks?.map((l) => l.pageId) || [];
        if (backlinkPageIds.length > 0) {
            // Option 1: Mark as broken (preserves user's intent)
            // Option 2: Remove the links entirely
            // For now, we'll leave them - they'll show as "Page not found"
        }
    }
}
```

### 2.2 API Routes

**New File: `apps/api/src/routes/links.ts`**

```typescript
import { Elysia, t } from 'elysia';
import { LinkService } from '../services/link.service';

const linkService = new LinkService();

export const linkRoutes = new Elysia({ prefix: '/api/links' })
    .use(jwtPlugin)
    .derive(authDerive)

    // Get backlinks for a page
    .get('/:pageId/backlinks', async ({ params, auth, set }) => {
        if (!auth.user) {
            set.status = 401;
            return { error: 'Unauthorized' };
        }

        const backlinks = await linkService.getBacklinks(params.pageId);
        return { backlinks };
    })

    // Get forward links for a page
    .get('/:pageId/forward', async ({ params, auth, set }) => {
        if (!auth.user) {
            set.status = 401;
            return { error: 'Unauthorized' };
        }

        const page = await findPageById(params.pageId);
        return {
            forwardLinks: page?.linksMeta?.forwardLinks || [],
        };
    })

    // Find unlinked mentions
    .get('/:pageId/unlinked', async ({ params, query, auth, set }) => {
        if (!auth.user) {
            set.status = 401;
            return { error: 'Unauthorized' };
        }

        const mentions = await linkService.findUnlinkedMentions(params.pageId, query.notebookId);
        return { mentions };
    })

    // Search pages for linking (autocomplete)
    .get(
        '/search',
        async ({ query, auth, set }) => {
            if (!auth.user) {
                set.status = 401;
                return { error: 'Unauthorized' };
            }

            const { q, notebookId, limit = 10 } = query;

            const pages = await searchPagesForLinking({
                query: q,
                notebookId,
                userId: auth.user._id,
                limit: Number(limit),
            });

            return { pages };
        },
        {
            query: t.Object({
                q: t.String(),
                notebookId: t.Optional(t.String()),
                limit: t.Optional(t.String()),
            }),
        },
    )

    // Bulk reindex links for a notebook (admin/migration)
    .post('/reindex/:notebookId', async ({ params, auth, set }) => {
        if (!auth.user) {
            set.status = 401;
            return { error: 'Unauthorized' };
        }

        // Queue background job to reindex all pages
        await queueLinkReindex(params.notebookId);
        return { status: 'queued' };
    });
```

### 2.3 Integration with Page Updates

**File: `apps/api/src/routes/pages.ts`**

Add link extraction on page content updates:

```typescript
// In PUT /api/pages/:id handler
.put('/:id', async ({ params, body, auth, set }) => {
    // ... existing validation ...

    const updatedPage = await updatePage(params.id, body);

    // Extract and update links if content changed
    if (body.content) {
        await linkService.updateLinksForPage(params.id, body.content);
    }

    return { page: updatedPage };
})

// In DELETE /api/pages/:id handler
.delete('/:id', async ({ params, auth, set }) => {
    // Clean up link references before deletion
    await linkService.handlePageDeletion(params.id);

    // ... existing deletion logic ...
})
```

---

## Phase 3: Frontend UI Components

### 3.1 Page Link Search Modal

**New File: `apps/web/src/app/components/molecules/page-link-search/page-link-search.component.ts`**

```typescript
@Component({
    selector: 'app-page-link-search',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './page-link-search.component.html',
    styleUrl: './page-link-search.component.scss',
})
export class PageLinkSearchComponent {
    private readonly http = inject(HttpClient);
    private readonly pageService = inject(PageService);

    readonly isOpen = input<boolean>(false);
    readonly mode = input<'inline' | 'embed'>('inline');

    readonly closed = output<void>();
    readonly selected = output<{ pageId: string; title: string }>();
    readonly createNew = output<string>(); // New page with this title

    readonly searchQuery = signal('');
    readonly searchResults = signal<PageSearchResult[]>([]);
    readonly isLoading = signal(false);
    readonly selectedIndex = signal(0);

    constructor() {
        // Debounced search
        effect(() => {
            const query = this.searchQuery();
            if (query.length >= 2) {
                this.performSearch(query);
            } else {
                this.searchResults.set([]);
            }
        });
    }

    private async performSearch(query: string) {
        this.isLoading.set(true);

        const response = await firstValueFrom(
            this.http.get<{ pages: PageSearchResult[] }>('/api/links/search', {
                params: { q: query, limit: '10' },
            }),
        );

        this.searchResults.set(response.pages);
        this.isLoading.set(false);
    }

    selectPage(page: PageSearchResult) {
        this.selected.emit({ pageId: page.id, title: page.title });
        this.close();
    }

    createNewPage() {
        const title = this.searchQuery().trim();
        if (title) {
            this.createNew.emit(title);
            this.close();
        }
    }

    handleKeydown(event: KeyboardEvent) {
        switch (event.key) {
            case 'ArrowDown':
                this.selectedIndex.update((i) => Math.min(i + 1, this.searchResults().length));
                event.preventDefault();
                break;
            case 'ArrowUp':
                this.selectedIndex.update((i) => Math.max(i - 1, 0));
                event.preventDefault();
                break;
            case 'Enter':
                const results = this.searchResults();
                const index = this.selectedIndex();
                if (index < results.length) {
                    this.selectPage(results[index]);
                } else {
                    this.createNewPage();
                }
                event.preventDefault();
                break;
            case 'Escape':
                this.close();
                break;
        }
    }

    close() {
        this.closed.emit();
    }
}
```

**Template: `page-link-search.component.html`**

```html
<div class="page-link-search-overlay" (click)="close()">
    <div class="page-link-search-modal" (click)="$event.stopPropagation()">
        <input
            type="text"
            [value]="searchQuery()"
            (input)="searchQuery.set($any($event.target).value)"
            (keydown)="handleKeydown($event)"
            placeholder="Search pages or create new..."
            class="search-input"
            autofocus
        />

        <div class="search-results">
            @if (isLoading()) {
            <div class="loading">Searching...</div>
            } @for (page of searchResults(); track page.id; let i = $index) {
            <div
                class="search-result"
                [class.selected]="selectedIndex() === i"
                (click)="selectPage(page)"
            >
                <span class="page-icon">{{ page.type === 'memo' ? '📝' : '📄' }}</span>
                <span class="page-title">{{ page.title }}</span>
                <span class="page-notebook">{{ page.notebookName }}</span>
            </div>
            } @if (searchQuery().length >= 2 && !isLoading()) {
            <div
                class="search-result create-new"
                [class.selected]="selectedIndex() === searchResults().length"
                (click)="createNewPage()"
            >
                <span class="create-icon">+</span>
                <span>Create "{{ searchQuery() }}"</span>
            </div>
            }
        </div>
    </div>
</div>
```

### 3.2 Backlinks Panel Component

**New File: `apps/web/src/app/components/molecules/backlinks-panel/backlinks-panel.component.ts`**

```typescript
@Component({
    selector: 'app-backlinks-panel',
    standalone: true,
    imports: [CommonModule, RouterLink],
    templateUrl: './backlinks-panel.component.html',
    styleUrl: './backlinks-panel.component.scss',
})
export class BacklinksPanelComponent {
    private readonly http = inject(HttpClient);
    private readonly router = inject(Router);

    readonly pageId = input.required<string>();
    readonly notebookId = input.required<string>();

    readonly backlinks = signal<PageLink[]>([]);
    readonly unlinkedMentions = signal<UnlinkedMention[]>([]);
    readonly isExpanded = signal(true);
    readonly showUnlinked = signal(false);
    readonly isLoading = signal(false);

    constructor() {
        effect(() => {
            const id = this.pageId();
            if (id) {
                this.loadBacklinks(id);
            }
        });
    }

    private async loadBacklinks(pageId: string) {
        this.isLoading.set(true);

        const [backlinksRes, unlinkedRes] = await Promise.all([
            firstValueFrom(
                this.http.get<{ backlinks: PageLink[] }>(`/api/links/${pageId}/backlinks`),
            ),
            firstValueFrom(
                this.http.get<{ mentions: UnlinkedMention[] }>(`/api/links/${pageId}/unlinked`, {
                    params: { notebookId: this.notebookId() },
                }),
            ),
        ]);

        this.backlinks.set(backlinksRes.backlinks);
        this.unlinkedMentions.set(unlinkedRes.mentions);
        this.isLoading.set(false);
    }

    navigateToPage(pageId: string) {
        this.router.navigate(['/', this.notebookId(), pageId]);
    }

    toggleExpanded() {
        this.isExpanded.update((v) => !v);
    }

    toggleUnlinked() {
        this.showUnlinked.update((v) => !v);
    }
}
```

**Template: `backlinks-panel.component.html`**

```html
<div class="backlinks-panel">
    <div class="panel-header" (click)="toggleExpanded()">
        <span class="toggle-icon">{{ isExpanded() ? '▼' : '▶' }}</span>
        <span class="panel-title">Linked References</span>
        <span class="count-badge">{{ backlinks().length }}</span>
    </div>

    @if (isExpanded()) {
    <div class="panel-content">
        @if (isLoading()) {
        <div class="loading">Loading...</div>
        } @else if (backlinks().length === 0) {
        <div class="empty-state">No pages link to this page yet.</div>
        } @else { @for (link of backlinks(); track link.pageId) {
        <div class="backlink-item" (click)="navigateToPage(link.pageId)">
            <span class="link-icon"> {{ link.type === 'inline' ? '🔗' : '📄' }} </span>
            <span class="link-title">{{ link.title }}</span>
            @if (link.context) {
            <p class="link-context">{{ link.context }}</p>
            }
        </div>
        } }

        <!-- Unlinked Mentions -->
        @if (unlinkedMentions().length > 0) {
        <div class="unlinked-section">
            <div class="section-header" (click)="toggleUnlinked()">
                <span>Unlinked Mentions</span>
                <span class="count-badge">{{ unlinkedMentions().length }}</span>
            </div>

            @if (showUnlinked()) { @for (mention of unlinkedMentions(); track mention.pageId) {
            <div class="mention-item">
                <span class="mention-title">{{ mention.title }}</span>
                <p class="mention-context">{{ mention.context }}</p>
                <button class="link-btn" (click)="linkMention(mention)">Link</button>
            </div>
            } }
        </div>
        }
    </div>
    }
</div>
```

### 3.3 Page Link Block Component

**New File: `apps/web/src/app/components/atoms/page-link-block/page-link-block.component.ts`**

```typescript
@Component({
    selector: 'app-page-link-block',
    standalone: true,
    imports: [CommonModule],
    template: `
        <div class="page-link-block" [class.loading]="isLoading()" (click)="navigateToPage()">
            <div class="block-header">
                <span class="page-icon">📄</span>
                <span class="page-title">{{ title() }}</span>
            </div>

            @if (showPreview() && preview()) {
                <div class="block-preview">
                    {{ preview() }}
                </div>
            }

            @if (pageNotFound()) {
                <div class="not-found">Page not found</div>
            }
        </div>
    `,
    styleUrl: './page-link-block.component.scss',
})
export class PageLinkBlockComponent {
    private readonly http = inject(HttpClient);
    private readonly router = inject(Router);

    readonly pageId = input.required<string>();
    readonly title = input<string>('');
    readonly showPreview = input<boolean>(true);

    readonly preview = signal<string>('');
    readonly pageNotFound = signal(false);
    readonly isLoading = signal(false);

    constructor() {
        effect(() => {
            if (this.showPreview()) {
                this.loadPreview(this.pageId());
            }
        });
    }

    private async loadPreview(pageId: string) {
        this.isLoading.set(true);
        try {
            const response = await firstValueFrom(
                this.http.get<{ page: Page }>(`/api/pages/${pageId}`),
            );
            // Extract first few lines of content
            const text = extractText(response.page.content);
            this.preview.set(text.slice(0, 200) + (text.length > 200 ? '...' : ''));
        } catch (error) {
            this.pageNotFound.set(true);
        }
        this.isLoading.set(false);
    }

    navigateToPage() {
        if (!this.pageNotFound()) {
            // Get notebook from current route and navigate
            this.router.navigate(['../', this.pageId()], { relativeTo: this.route });
        }
    }
}
```

---

## Phase 4: Tag System Enhancement

### 4.1 Tag Pages

Convert tags to have associated pages for notes about the tag:

**File: `apps/api/src/services/tag.service.ts`**

```typescript
export class TagService {
    /**
     * Create a tag with an associated page
     */
    async createTag(userId: string, label: string, notebookId: string): Promise<Tag> {
        const db = getDb();

        // Create the tag page first
        const tagPage = await createPage({
            userId,
            notebookId,
            type: 'memo',
            title: `#${label}`,
            content: {
                type: 'doc',
                content: [
                    {
                        type: 'heading',
                        attrs: { level: 1 },
                        content: [{ type: 'text', text: `#${label}` }],
                    },
                    {
                        type: 'paragraph',
                        content: [{ type: 'text', text: 'Notes about this tag...' }],
                    },
                ],
            },
        });

        // Create the tag with page reference
        const tag = await db.collection('tags').insertOne({
            id: uuidv4(),
            userId,
            label,
            pageId: tagPage.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        return tag;
    }

    /**
     * Get all pages with a specific tag
     */
    async getPagesWithTag(tagId: string): Promise<Page[]> {
        const db = getDb();

        // Query pages that have links to this tag
        const pages = await db
            .collection('pages')
            .find({
                'linksMeta.forwardLinks': {
                    $elemMatch: {
                        pageId: tagId,
                        type: 'tag',
                    },
                },
            })
            .toArray();

        return pages;
    }
}
```

### 4.2 Tag Page View

When navigating to a tag, show:

1. Tag page content (user's notes about the tag)
2. List of all pages using this tag (backlinks)

**Integration in routing:**

```typescript
// Add tag route guard
{
    path: ':notebookId/tag/:tagId',
    loadComponent: () => import('./pages/tag-view/tag-view.component'),
}
```

---

## Phase 5: Knowledge Graph Visualization

### 5.1 Graph Data Service

**New File: `apps/api/src/services/graph.service.ts`**

```typescript
export class GraphService {
    /**
     * Get graph data for visualization
     */
    async getGraphData(notebookId: string, options: GraphOptions = {}): Promise<GraphData> {
        const db = getDb();
        const pages = db.collection('pages');

        const { depth = 2, centerPageId } = options;

        // Get all pages in notebook
        const allPages = await pages
            .find({
                notebookId,
                isTrashed: { $ne: true },
            })
            .project({
                id: 1,
                title: 1,
                type: 1,
                'linksMeta.forwardLinks': 1,
                'linksMeta.backlinks': 1,
            })
            .toArray();

        // Build nodes
        const nodes: GraphNode[] = allPages.map((page) => ({
            id: page.id,
            label: page.title || 'Untitled',
            type: page.type,
            linkCount:
                (page.linksMeta?.forwardLinks?.length || 0) +
                (page.linksMeta?.backlinks?.length || 0),
        }));

        // Build edges
        const edges: GraphEdge[] = [];
        const edgeSet = new Set<string>();

        for (const page of allPages) {
            const forwardLinks = page.linksMeta?.forwardLinks || [];
            for (const link of forwardLinks) {
                const edgeId = `${page.id}-${link.pageId}`;
                if (!edgeSet.has(edgeId)) {
                    edges.push({
                        source: page.id,
                        target: link.pageId,
                        type: link.type,
                    });
                    edgeSet.add(edgeId);
                }
            }
        }

        return { nodes, edges };
    }

    /**
     * Get local graph centered on a page
     */
    async getLocalGraph(pageId: string, depth: number = 1): Promise<GraphData> {
        // BFS to get nodes within depth
        const visited = new Set<string>();
        const queue: Array<{ id: string; level: number }> = [{ id: pageId, level: 0 }];
        const nodes: GraphNode[] = [];
        const edges: GraphEdge[] = [];

        while (queue.length > 0) {
            const { id, level } = queue.shift()!;
            if (visited.has(id) || level > depth) continue;
            visited.add(id);

            const page = await this.getPageWithLinks(id);
            if (!page) continue;

            nodes.push({
                id: page.id,
                label: page.title,
                type: page.type,
                isCenter: id === pageId,
            });

            // Add connected pages to queue
            const allLinks = [
                ...(page.linksMeta?.forwardLinks || []),
                ...(page.linksMeta?.backlinks || []),
            ];

            for (const link of allLinks) {
                if (!visited.has(link.pageId)) {
                    queue.push({ id: link.pageId, level: level + 1 });
                    edges.push({
                        source: id,
                        target: link.pageId,
                        type: link.type,
                    });
                }
            }
        }

        return { nodes, edges };
    }
}
```

### 5.2 Graph API Routes

**New File: `apps/api/src/routes/graph.ts`**

```typescript
export const graphRoutes = new Elysia({ prefix: '/api/graph' })
    .use(jwtPlugin)
    .derive(authDerive)

    // Get full notebook graph
    .get('/notebook/:notebookId', async ({ params, auth, set }) => {
        if (!auth.user) {
            set.status = 401;
            return { error: 'Unauthorized' };
        }

        const graph = await graphService.getGraphData(params.notebookId);
        return { graph };
    })

    // Get local graph around a page
    .get('/page/:pageId', async ({ params, query, auth, set }) => {
        if (!auth.user) {
            set.status = 401;
            return { error: 'Unauthorized' };
        }

        const depth = Number(query.depth) || 1;
        const graph = await graphService.getLocalGraph(params.pageId, depth);
        return { graph };
    });
```

### 5.3 Graph Visualization Component

**New File: `apps/web/src/app/components/organisms/knowledge-graph/knowledge-graph.component.ts`**

Using D3.js or vis.js for force-directed graph:

```typescript
@Component({
    selector: 'app-knowledge-graph',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './knowledge-graph.component.html',
    styleUrl: './knowledge-graph.component.scss',
})
export class KnowledgeGraphComponent implements AfterViewInit, OnDestroy {
    private readonly http = inject(HttpClient);
    private readonly router = inject(Router);

    @ViewChild('graphContainer') containerRef!: ElementRef<HTMLDivElement>;

    readonly notebookId = input.required<string>();
    readonly focusPageId = input<string>();
    readonly viewMode = input<'full' | 'local'>('full');

    private simulation: d3.Simulation<GraphNode, GraphEdge> | null = null;

    async ngAfterViewInit() {
        await this.loadAndRenderGraph();
    }

    private async loadAndRenderGraph() {
        const graph = await this.fetchGraphData();
        this.renderGraph(graph);
    }

    private async fetchGraphData(): Promise<GraphData> {
        if (this.viewMode() === 'local' && this.focusPageId()) {
            const res = await firstValueFrom(
                this.http.get<{ graph: GraphData }>(`/api/graph/page/${this.focusPageId()}`, {
                    params: { depth: '2' },
                }),
            );
            return res.graph;
        }

        const res = await firstValueFrom(
            this.http.get<{ graph: GraphData }>(`/api/graph/notebook/${this.notebookId()}`),
        );
        return res.graph;
    }

    private renderGraph(data: GraphData) {
        const container = this.containerRef.nativeElement;
        const width = container.clientWidth;
        const height = container.clientHeight;

        // Clear previous
        d3.select(container).selectAll('*').remove();

        const svg = d3.select(container).append('svg').attr('width', width).attr('height', height);

        // Create force simulation
        this.simulation = d3
            .forceSimulation(data.nodes)
            .force(
                'link',
                d3
                    .forceLink(data.edges)
                    .id((d: any) => d.id)
                    .distance(100),
            )
            .force('charge', d3.forceManyBody().strength(-300))
            .force('center', d3.forceCenter(width / 2, height / 2));

        // Draw edges
        const links = svg
            .append('g')
            .selectAll('line')
            .data(data.edges)
            .enter()
            .append('line')
            .attr('class', 'graph-edge')
            .attr('stroke', '#999')
            .attr('stroke-opacity', 0.6);

        // Draw nodes
        const nodes = svg
            .append('g')
            .selectAll('circle')
            .data(data.nodes)
            .enter()
            .append('circle')
            .attr('class', 'graph-node')
            .attr('r', (d) => 5 + Math.sqrt(d.linkCount) * 2)
            .attr('fill', (d) => this.getNodeColor(d))
            .call(this.drag(this.simulation))
            .on('click', (event, d) => this.navigateToPage(d.id));

        // Add labels
        const labels = svg
            .append('g')
            .selectAll('text')
            .data(data.nodes)
            .enter()
            .append('text')
            .text((d) => d.label)
            .attr('font-size', 10)
            .attr('dx', 12)
            .attr('dy', 4);

        // Update positions on tick
        this.simulation.on('tick', () => {
            links
                .attr('x1', (d: any) => d.source.x)
                .attr('y1', (d: any) => d.source.y)
                .attr('x2', (d: any) => d.target.x)
                .attr('y2', (d: any) => d.target.y);

            nodes.attr('cx', (d: any) => d.x).attr('cy', (d: any) => d.y);

            labels.attr('x', (d: any) => d.x).attr('y', (d: any) => d.y);
        });
    }

    private getNodeColor(node: GraphNode): string {
        if (node.isCenter) return '#D94E3B'; // Maple red for focused node
        if (node.type === 'memo') return '#3b82f6';
        if (node.type === 'whiteboard') return '#10b981';
        return '#6b7280';
    }

    private drag(simulation: any) {
        return d3
            .drag()
            .on('start', (event, d: any) => {
                if (!event.active) simulation.alphaTarget(0.3).restart();
                d.fx = d.x;
                d.fy = d.y;
            })
            .on('drag', (event, d: any) => {
                d.fx = event.x;
                d.fy = event.y;
            })
            .on('end', (event, d: any) => {
                if (!event.active) simulation.alphaTarget(0);
                d.fx = null;
                d.fy = null;
            });
    }

    private navigateToPage(pageId: string) {
        this.router.navigate(['/', this.notebookId(), pageId]);
    }

    ngOnDestroy() {
        this.simulation?.stop();
    }
}
```

### 5.4 Graph View Page

**New File: `apps/web/src/app/pages/graph-view/graph-view.component.ts`**

Full-page graph view accessible from sidebar:

```typescript
@Component({
    selector: 'app-graph-view',
    standalone: true,
    imports: [CommonModule, KnowledgeGraphComponent],
    template: `
        <div class="graph-view">
            <div class="graph-toolbar">
                <h1>Knowledge Graph</h1>
                <div class="controls">
                    <button (click)="toggleViewMode()">
                        {{ viewMode() === 'full' ? 'Show Local' : 'Show Full' }}
                    </button>
                    <input
                        type="range"
                        min="1"
                        max="5"
                        [value]="depth()"
                        (input)="depth.set($any($event.target).value)"
                    />
                    <span>Depth: {{ depth() }}</span>
                </div>
            </div>

            <app-knowledge-graph
                [notebookId]="notebookId()"
                [focusPageId]="focusPageId()"
                [viewMode]="viewMode()"
            />
        </div>
    `,
    styleUrl: './graph-view.component.scss',
})
export class GraphViewComponent {
    readonly notebookId = input.required<string>();
    readonly focusPageId = input<string>();

    readonly viewMode = signal<'full' | 'local'>('full');
    readonly depth = signal(2);

    toggleViewMode() {
        this.viewMode.update((m) => (m === 'full' ? 'local' : 'full'));
    }
}
```

---

## Phase 6: Daily Notes Integration

### 6.1 Daily Note Links

Auto-link daily notes to create a timeline:

```typescript
// When creating a daily note, auto-link to previous day
async function createDailyNote(userId: string, notebookId: string, date: Date) {
    const yesterday = new Date(date);
    yesterday.setDate(yesterday.getDate() - 1);

    const yesterdayNote = await findDailyNote(userId, notebookId, yesterday);

    const content = {
        type: 'doc',
        content: [
            {
                type: 'heading',
                attrs: { level: 1 },
                content: [{ type: 'text', text: formatDate(date) }],
            },
            // Auto-link to yesterday if exists
            ...(yesterdayNote
                ? [
                      {
                          type: 'paragraph',
                          content: [
                              { type: 'text', text: '← ' },
                              {
                                  type: 'text',
                                  marks: [
                                      {
                                          type: 'pageLink',
                                          attrs: {
                                              pageId: yesterdayNote.id,
                                              title: 'Yesterday',
                                          },
                                      },
                                  ],
                                  text: 'Yesterday',
                              },
                          ],
                      },
                  ]
                : []),
        ],
    };

    const page = await createPage({
        userId,
        notebookId,
        type: 'memo',
        title: formatDate(date),
        content,
        metadata: { isDailyNote: true, date: date.toISOString() },
    });

    // Update yesterday's note to link to today
    if (yesterdayNote) {
        // Add "Tomorrow" link to yesterday's page
        await appendLinkToPage(yesterdayNote.id, page.id, 'Tomorrow →');
    }

    return page;
}
```

---

## Implementation Phases & Timeline

### Phase 1: Foundation (Week 1-2)

- [ ] Schema extensions for links metadata
- [ ] PageLink mark extension (inline)
- [ ] WikiLink input handler (`[[` trigger)
- [ ] Page search modal component
- [ ] Basic link extraction service

### Phase 2: Backend Services (Week 2-3)

- [ ] Link service with backlink tracking
- [ ] API routes for links
- [ ] Integration with page CRUD operations
- [ ] Unlinked mentions detection

### Phase 3: UI Components (Week 3-4)

- [ ] Backlinks panel component
- [ ] Page link block (embed style)
- [ ] Slash command integration
- [ ] Link styling in editor

### Phase 4: Tag Enhancement (Week 4-5)

- [ ] Tag pages (notes about tags)
- [ ] Tag link extension (#hashtag)
- [ ] Tag view with backlinks
- [ ] Tag autocompletion

### Phase 5: Knowledge Graph (Week 5-6)

- [ ] Graph data service
- [ ] Graph API routes
- [ ] D3.js graph component
- [ ] Graph view page
- [ ] Local graph view

### Phase 6: Polish & Edge Cases (Week 6-7)

- [ ] Link validation on delete
- [ ] Broken link handling
- [ ] Daily note integration
- [ ] Performance optimization
- [ ] Migration script for existing content

---

## Data Migration

For existing content, run a one-time migration to extract and index links:

```typescript
async function migrateLinkIndexes() {
    const db = getDb();
    const pages = db.collection('pages');
    const linkService = new LinkService();

    const cursor = pages.find({});

    while (await cursor.hasNext()) {
        const page = await cursor.next();
        if (page.content) {
            await linkService.updateLinksForPage(page.id, page.content);
        }
    }

    console.log('Link migration complete');
}
```

---

## Success Metrics

1. **Adoption**: % of pages with at least one outbound link
2. **Graph density**: Average links per page
3. **Discovery**: Click-through rate on backlinks panel
4. **Retention**: Users who use linking features vs. those who don't

---

## Technical Considerations

### Performance

- Denormalize link counts for fast display
- Use MongoDB indexes on `linksMeta.forwardLinks.pageId` and `linksMeta.backlinks.pageId`
- Lazy-load backlinks panel content
- Paginate graph data for large notebooks

### Collaboration

- Y.js handles concurrent link edits automatically
- Backlink updates are eventually consistent (acceptable delay)
- Real-time link count updates via WebSocket

### Data Integrity

- Soft-delete pages to preserve link history
- Mark broken links but don't remove them
- Store link title separately for display even if target changes

---

## Appendix: UI/UX Guidelines

### Link Appearance

- **Inline links**: Styled like internal links (subtle background, maple accent on hover)
- **Block links**: Card-style with title, preview, and link icon
- **Tag links**: Pill-style with # prefix and tag color

### Interactions

- `[[` triggers page search popup
- `#` triggers tag search popup
- Cmd/Ctrl+Click opens link in new tab
- Click opens in same view
- Hover shows preview tooltip

### Keyboard Shortcuts

- `Cmd+K`: Insert page link
- `Cmd+Shift+K`: Insert block link
- `#`: Insert tag (auto-detected)
