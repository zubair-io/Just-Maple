import { Type, Static } from '@sinclair/typebox';
import { PageTodoMetaSchema } from './todo';
import { PageLinksMetaSchema } from './link';

export const PageContentSchema = Type.Object({
    type: Type.String(),
    content: Type.Optional(Type.Array(Type.Any())),
    attrs: Type.Optional(Type.Record(Type.String(), Type.Any())),
    text: Type.Optional(Type.String()),
});

export type PageContent = Static<typeof PageContentSchema>;

export const SyncStatusSchema = Type.Union([
    Type.Literal('pending'),
    Type.Literal('syncing'),
    Type.Literal('synced'),
    Type.Literal('failed'),
    Type.Literal('conflict'),
]);

export type SyncStatus = Static<typeof SyncStatusSchema>;

// Page type - determines the editor/view used
export const PageTypeSchema = Type.Union([
    Type.Literal('memo'), // Default (was 'write')
    Type.Literal('collectable'),
    Type.Literal('whiteboard'),
    Type.Literal('kanban'),
    Type.Literal('message'), // Chat messages container
    Type.Literal('recording'),
]);

export type PageType = Static<typeof PageTypeSchema>;

export const PageSchema = Type.Object({
    _id: Type.String(),
    id: Type.String(), // UUID v4 for routing (was documentId)
    userId: Type.String(),
    type: PageTypeSchema,
    title: Type.String(),
    // DUAL STORAGE: content field kept for search/compatibility, automergeDoc is source of truth
    content: PageContentSchema, // ProseMirror JSON format (for search indexing)
    automergeDoc: Type.Optional(Type.Any()), // Binary CRDT (source of truth)
    // Automerge metadata
    version: Type.Optional(Type.Number()), // Hash of Automerge heads (for cache validation)
    lastSyncedHeads: Type.Optional(Type.Array(Type.String())), // Automerge heads (for sync optimization)
    notebookId: Type.Optional(Type.String()), // Associated notebook/folder
    headerImageUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])), // Header/cover image URL
    isFavorite: Type.Optional(Type.Boolean()),
    isArchived: Type.Optional(Type.Boolean()),
    isTrashed: Type.Optional(Type.Boolean()),
    trashedAt: Type.Optional(Type.String({ format: 'date-time' })),
    // Todo metadata for efficient querying across memos
    todoMeta: Type.Optional(PageTodoMetaSchema),
    // Link metadata for bi-directional linking
    linksMeta: Type.Optional(PageLinksMetaSchema),
    // Tags extracted from content (e.g., #work, #ideas)
    tags: Type.Optional(Type.Array(Type.String())),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type Page = Static<typeof PageSchema>;

export const CreatePageSchema = Type.Object({
    type: Type.Optional(PageTypeSchema),
    title: Type.Optional(Type.String({ maxLength: 500 })),
    content: Type.Optional(PageContentSchema),
    notebookId: Type.Optional(Type.String()),
    id: Type.Optional(Type.String()), // UUID v4 for routing (was documentId)
    automergeDoc: Type.Optional(Type.Any()), // Binary CRDT
});

export type CreatePageInput = Static<typeof CreatePageSchema>;

export const UpdatePageSchema = Type.Object({
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    content: Type.Optional(PageContentSchema),
    automergeDoc: Type.Optional(Type.Any()), // Binary CRDT
    version: Type.Optional(Type.Number()), // Automerge heads hash
    lastSyncedHeads: Type.Optional(Type.Array(Type.String())), // Automerge heads
    notebookId: Type.Optional(Type.String()),
    headerImageUrl: Type.Optional(Type.Union([Type.String(), Type.Null()])), // Header/cover image URL (null to remove)
    isFavorite: Type.Optional(Type.Boolean()),
    isArchived: Type.Optional(Type.Boolean()),
    isTrashed: Type.Optional(Type.Boolean()),
    todoMeta: Type.Optional(PageTodoMetaSchema), // Todo metadata for efficient querying
    linksMeta: Type.Optional(PageLinksMetaSchema), // Link metadata for bi-directional linking
    tags: Type.Optional(Type.Array(Type.String())), // Tags extracted from content
});

export type UpdatePageInput = Static<typeof UpdatePageSchema>;

// Default empty page content - starts with H1 heading as title
export const DEFAULT_PAGE_CONTENT: PageContent = {
    type: 'doc',
    content: [
        {
            type: 'heading',
            attrs: { level: 1 },
            content: [],
        },
        {
            type: 'paragraph',
            content: [],
        },
    ],
};
