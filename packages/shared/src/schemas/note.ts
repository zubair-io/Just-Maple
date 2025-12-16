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

export const NoteSchema = Type.Object({
    _id: Type.String(),
    userId: Type.String(),
    title: Type.String(),
    content: NoteContentSchema, // ProseMirror JSON format
    version: Type.Number(),
    tagId: Type.Optional(Type.String()), // Associated tag/folder
    isFavorite: Type.Optional(Type.Boolean()),
    isArchived: Type.Optional(Type.Boolean()),
    isTrashed: Type.Optional(Type.Boolean()),
    trashedAt: Type.Optional(Type.String({ format: 'date-time' })),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type Note = Static<typeof NoteSchema>;

export const CreateNoteSchema = Type.Object({
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
