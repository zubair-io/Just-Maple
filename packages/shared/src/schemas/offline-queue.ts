import { Type, Static } from '@sinclair/typebox';

// Actions that can be queued for offline sync
export const OfflineActionSchema = Type.Union([
    Type.Literal('create-note'), // Create a new note on server
    Type.Literal('update-note'), // Update note metadata
    Type.Literal('delete-note'), // Delete a note
    Type.Literal('sync-notebook'), // Sync Y.Doc state to server
    Type.Literal('move-note'), // Move note to different tag
    Type.Literal('trash-note'), // Move note to trash
    Type.Literal('restore-note'), // Restore from trash
]);

export type OfflineAction = Static<typeof OfflineActionSchema>;

// Queue item stored in IndexedDB
export const OfflineQueueItemSchema = Type.Object({
    id: Type.String(), // Unique queue item ID
    action: OfflineActionSchema,
    noteId: Type.String(), // The note this action applies to
    documentId: Type.String(), // Document ID for routing
    payload: Type.Optional(Type.Any()), // Action-specific data
    createdAt: Type.String({ format: 'date-time' }),
    retryCount: Type.Number({ default: 0 }),
    maxRetries: Type.Number({ default: 5 }),
    lastError: Type.Optional(Type.String()),
    lastAttemptAt: Type.Optional(Type.String({ format: 'date-time' })),
});

export type OfflineQueueItem = Static<typeof OfflineQueueItemSchema>;

// Queue processing result
export const QueueProcessResultSchema = Type.Object({
    success: Type.Boolean(),
    processedCount: Type.Number(),
    failedCount: Type.Number(),
    errors: Type.Array(
        Type.Object({
            itemId: Type.String(),
            error: Type.String(),
        }),
    ),
});

export type QueueProcessResult = Static<typeof QueueProcessResultSchema>;
