import { Type, Static } from '@sinclair/typebox';

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
    Type.Literal('write'),
    Type.Literal('collectable'),
    Type.Literal('whiteboard'),
    Type.Literal('kanban'),
    Type.Literal('memo'),
    Type.Literal('message'),
]);

export type PageType = Static<typeof PageTypeSchema>;

export const PageSchema = Type.Object({
    _id: Type.String(),
    userId: Type.String(),
    type: PageTypeSchema,
    title: Type.String(),
    // DUAL STORAGE: content field kept for search/compatibility, automergeDoc is source of truth
    content: PageContentSchema, // ProseMirror JSON format (for search indexing)
    automergeDoc: Type.Optional(Type.Any()), // Binary CRDT (source of truth)
    documentId: Type.String(), // Document ID for routing and Automerge identification
    // Automerge metadata
    version: Type.Optional(Type.Number()), // Hash of Automerge heads (for cache validation)
    lastSyncedHeads: Type.Optional(Type.Array(Type.String())), // Automerge heads (for sync optimization)
    tagId: Type.Optional(Type.String()), // Associated notebook/folder
    isFavorite: Type.Optional(Type.Boolean()),
    isArchived: Type.Optional(Type.Boolean()),
    isTrashed: Type.Optional(Type.Boolean()),
    trashedAt: Type.Optional(Type.String({ format: 'date-time' })),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type Page = Static<typeof PageSchema>;

export const CreatePageSchema = Type.Object({
    type: Type.Optional(PageTypeSchema),
    title: Type.Optional(Type.String({ maxLength: 500 })),
    content: Type.Optional(PageContentSchema),
    tagId: Type.Optional(Type.String()),
    documentId: Type.Optional(Type.String()), // Document ID for routing
    automergeDoc: Type.Optional(Type.Any()), // Binary CRDT
});

export type CreatePageInput = Static<typeof CreatePageSchema>;

export const UpdatePageSchema = Type.Object({
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    content: Type.Optional(PageContentSchema),
    automergeDoc: Type.Optional(Type.Any()), // Binary CRDT
    documentId: Type.Optional(Type.String()), // Document ID for routing
    version: Type.Optional(Type.Number()), // Automerge heads hash
    lastSyncedHeads: Type.Optional(Type.Array(Type.String())), // Automerge heads
    tagId: Type.Optional(Type.String()),
    isFavorite: Type.Optional(Type.Boolean()),
    isArchived: Type.Optional(Type.Boolean()),
    isTrashed: Type.Optional(Type.Boolean()),
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
