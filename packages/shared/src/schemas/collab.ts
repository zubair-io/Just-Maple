import { Type, Static } from '@sinclair/typebox';

// Collaboration event types
export const CollabActionSchema = Type.Union([
    Type.Literal('steps'), // OT steps received (will be removed later)
    Type.Literal('init'), // Session initialized
    Type.Literal('resync'), // Client needs to resync
    Type.Literal('automerge-sync'), // Automerge sync message
]);

export type CollabAction = Static<typeof CollabActionSchema>;

// Collaboration event payload (similar to ChatEvent)
export const CollabEventSchema = Type.Object({
    type: CollabActionSchema,
    noteId: Type.String(),
    version: Type.Optional(Type.Number()),
    steps: Type.Optional(Type.Array(Type.Any())),
    clientIDs: Type.Optional(Type.Array(Type.String())),
    clientID: Type.Optional(Type.String()),
    doc: Type.Optional(Type.Any()), // ProseMirror document
    syncMessage: Type.Optional(Type.String()), // Base64-encoded Automerge sync message
});

export type CollabEvent = Static<typeof CollabEventSchema>;

// Request schemas for HTTP endpoints

// Send steps request (single step submission)
export const CollabStepsRequestSchema = Type.Object({
    version: Type.Number({ minimum: 0 }),
    steps: Type.Array(Type.Any(), { minItems: 1, maxItems: 50 }), // Limit steps per request
    doc: Type.Any(),
    clientID: Type.Optional(Type.String()),
});

export type CollabStepsRequest = Static<typeof CollabStepsRequestSchema>;

// Batch steps request (offline queue flush)
export const CollabBatchRequestSchema = Type.Object({
    stepsBatch: Type.Array(
        Type.Object({
            version: Type.Number({ minimum: 0 }),
            steps: Type.Array(Type.Any(), { minItems: 1 }),
        }),
        { minItems: 1, maxItems: 100 }, // Limit batch size to prevent DoS
    ),
    doc: Type.Any(),
    clientID: Type.Optional(Type.String()),
});

export type CollabBatchRequest = Static<typeof CollabBatchRequestSchema>;
