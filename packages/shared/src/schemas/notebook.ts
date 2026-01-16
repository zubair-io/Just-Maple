import { Type, Static } from '@sinclair/typebox';

// Notebook document stored in MongoDB 'notebooks' collection
// Separate from notes collection to store Y.Doc binary state
export const NotebookSchema = Type.Object({
    _id: Type.String(),
    noteId: Type.String(), // Links to parent note document
    state: Type.Any(), // Y.Doc encoded state (Uint8Array stored as Binary)
    version: Type.Number(), // Increments on each update, for cache invalidation
    updatedAt: Type.String({ format: 'date-time' }),
});

export type Notebook = Static<typeof NotebookSchema>;

// For creating a new notebook (when syncing offline-created notebook)
export const CreateNotebookSchema = Type.Object({
    noteId: Type.String(),
    state: Type.Any(), // Y.Doc encoded state
});

export type CreateNotebookInput = Static<typeof CreateNotebookSchema>;

// For updating notebook state
export const UpdateNotebookSchema = Type.Object({
    state: Type.Any(), // Y.Doc update or full state
    version: Type.Number(),
});

export type UpdateNotebookInput = Static<typeof UpdateNotebookSchema>;

// Notebook metadata for SSE events (without the heavy binary state)
export const NotebookMetadataSchema = Type.Object({
    noteId: Type.String(),
    version: Type.Number(),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type NotebookMetadata = Static<typeof NotebookMetadataSchema>;

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
