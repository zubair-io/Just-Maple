import { Type, Static } from '@sinclair/typebox';

// Version trigger types
export const VersionTriggerSchema = Type.Union([
    Type.Literal('auto-interval'),
    Type.Literal('auto-idle'),
    Type.Literal('manual'),
    Type.Literal('ai-edit'),
    Type.Literal('significant-change'),
    Type.Literal('import'),
]);

export type VersionTrigger = Static<typeof VersionTriggerSchema>;

// Memo version document stored in MongoDB 'memo_versions' collection
export const MemoVersionSchema = Type.Object({
    _id: Type.String(),
    noteId: Type.String(), // References pages.id
    state: Type.Any(), // Y.js state snapshot (Binary in MongoDB, base64 in API)
    version: Type.Number(), // Version from parent memo at time of snapshot
    byteSize: Type.Number(), // Size of state for storage management
    trigger: VersionTriggerSchema, // What caused this snapshot
    label: Type.Optional(Type.String()), // User-provided label for manual versions
    createdAt: Type.String({ format: 'date-time' }),
    // Display metadata
    contentPreview: Type.Optional(Type.String()), // First 200 chars of text
    wordCount: Type.Optional(Type.Number()),
    headingText: Type.Optional(Type.String()), // Document title/first heading
});

export type MemoVersion = Static<typeof MemoVersionSchema>;

// List item (without the heavy state field)
export const MemoVersionListItemSchema = Type.Object({
    _id: Type.String(),
    noteId: Type.String(),
    version: Type.Number(),
    byteSize: Type.Number(),
    trigger: VersionTriggerSchema,
    label: Type.Optional(Type.String()),
    createdAt: Type.String({ format: 'date-time' }),
    contentPreview: Type.Optional(Type.String()),
    wordCount: Type.Optional(Type.Number()),
    headingText: Type.Optional(Type.String()),
});

export type MemoVersionListItem = Static<typeof MemoVersionListItemSchema>;

// API response for listing versions
export const MemoVersionsResponseSchema = Type.Object({
    versions: Type.Array(MemoVersionListItemSchema),
    hasMore: Type.Boolean(),
});

export type MemoVersionsResponse = Static<typeof MemoVersionsResponseSchema>;

// API response for restore
export const RestoreVersionResponseSchema = Type.Object({
    success: Type.Boolean(),
    newVersion: Type.Number(), // The new current version after restore
    restoredFrom: Type.Number(), // The version that was restored
});

export type RestoreVersionResponse = Static<typeof RestoreVersionResponseSchema>;

// Request body for creating manual checkpoint
export const CreateCheckpointRequestSchema = Type.Object({
    label: Type.Optional(Type.String()),
});

export type CreateCheckpointRequest = Static<typeof CreateCheckpointRequestSchema>;
