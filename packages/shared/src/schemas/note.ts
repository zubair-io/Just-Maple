import { Type, Static } from '@sinclair/typebox';

export const NoteContentSchema = Type.Object({
    type: Type.String(),
    content: Type.Optional(Type.Array(Type.Any())),
    attrs: Type.Optional(Type.Record(Type.String(), Type.Any())),
    text: Type.Optional(Type.String()),
});

export type NoteContent = Static<typeof NoteContentSchema>;

export const SyncStatusSchema = Type.Union([
    Type.Literal('pending'),
    Type.Literal('syncing'),
    Type.Literal('synced'),
    Type.Literal('failed'),
    Type.Literal('conflict'),
]);

export type SyncStatus = Static<typeof SyncStatusSchema>;

// Note type - determines the editor/view used
export const NoteTypeSchema = Type.Union([
    Type.Literal('write'),
    Type.Literal('lego'),
    Type.Literal('draw'),
    Type.Literal('kanban'),
]);

export type NoteType = Static<typeof NoteTypeSchema>;

export const NoteSchema = Type.Object({
    _id: Type.String(),
    userId: Type.String(),
    type: NoteTypeSchema,
    title: Type.String(),
    content: NoteContentSchema, // ProseMirror JSON format (legacy, synced from Y.Doc)
    version: Type.Number(),
    tagId: Type.Optional(Type.String()), // Associated tag/folder
    isFavorite: Type.Optional(Type.Boolean()),
    isArchived: Type.Optional(Type.Boolean()),
    isTrashed: Type.Optional(Type.Boolean()),
    trashedAt: Type.Optional(Type.String({ format: 'date-time' })),

    // Y.js collaboration fields
    yjsUpdates: Type.Optional(Type.Array(Type.Any())), // Array of binary Y.js update chunks
    yjsSnapshot: Type.Optional(Type.Any()), // Compacted Y.js snapshot (binary)
    lastCompactedAt: Type.Optional(Type.String({ format: 'date-time' })), // Last snapshot time
    activeUsers: Type.Optional(Type.Array(Type.String())), // Currently editing user IDs

    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type Note = Static<typeof NoteSchema>;

export const CreateNoteSchema = Type.Object({
    type: Type.Optional(NoteTypeSchema),
    title: Type.Optional(Type.String({ maxLength: 500 })),
    content: Type.Optional(NoteContentSchema),
    tagId: Type.Optional(Type.String()),
});

export type CreateNoteInput = Static<typeof CreateNoteSchema>;

export const UpdateNoteSchema = Type.Object({
    title: Type.Optional(Type.String({ maxLength: 500 })),
    content: Type.Optional(NoteContentSchema),
    tagId: Type.Optional(Type.String()),
    isFavorite: Type.Optional(Type.Boolean()),
    isArchived: Type.Optional(Type.Boolean()),
    isTrashed: Type.Optional(Type.Boolean()),
    version: Type.Optional(Type.Number()),

    // Y.js collaboration fields (CRITICAL FIX: Enable persistence of Y.js updates)
    yjsSnapshot: Type.Optional(Type.Any()),
    yjsUpdates: Type.Optional(Type.Array(Type.Any())),
    lastCompactedAt: Type.Optional(Type.String({ format: 'date-time' })),
});

export type UpdateNoteInput = Static<typeof UpdateNoteSchema>;

// Default empty note content - starts with H1 heading as title
export const DEFAULT_NOTE_CONTENT: NoteContent = {
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
