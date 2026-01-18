import { Type, Static } from '@sinclair/typebox';

// Memo document stored in MongoDB 'memos' collection
// Separate from pages collection to store Y.Doc binary state
export const MemoSchema = Type.Object({
    _id: Type.String(),
    noteId: Type.String(), // Links to parent page document
    state: Type.Any(), // Y.Doc encoded state (Uint8Array stored as Binary)
    version: Type.Number(), // Increments on each update, for cache invalidation
    updatedAt: Type.String({ format: 'date-time' }),
});

export type Memo = Static<typeof MemoSchema>;

// For creating a new memo (when syncing offline-created memo)
export const CreateMemoSchema = Type.Object({
    noteId: Type.String(),
    state: Type.Any(), // Y.Doc encoded state
});

export type CreateMemoInput = Static<typeof CreateMemoSchema>;

// For updating memo state
export const UpdateMemoSchema = Type.Object({
    state: Type.Any(), // Y.Doc update or full state
    version: Type.Number(),
});

export type UpdateMemoInput = Static<typeof UpdateMemoSchema>;

// Memo metadata for SSE events (without the heavy binary state)
export const MemoMetadataSchema = Type.Object({
    noteId: Type.String(),
    version: Type.Number(),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type MemoMetadata = Static<typeof MemoMetadataSchema>;

// Y.Doc update message for SSE streaming
export const YDocUpdateSchema = Type.Object({
    type: Type.Literal('ydoc-update'),
    noteId: Type.String(),
    update: Type.String(), // Base64-encoded Y.Doc update
    clientId: Type.String(), // Origin client
    version: Type.Number(),
});

export type YDocUpdate = Static<typeof YDocUpdateSchema>;

// Initial state message when client connects
export const YDocInitSchema = Type.Object({
    type: Type.Literal('ydoc-init'),
    noteId: Type.String(),
    state: Type.String(), // Base64-encoded full Y.Doc state
    version: Type.Number(),
});

export type YDocInit = Static<typeof YDocInitSchema>;
