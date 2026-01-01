import { Type, Static } from '@sinclair/typebox';

// Collaboration event types
export const CollabActionSchema = Type.Union([
    Type.Literal('steps'), // OT steps received
    Type.Literal('init'), // Session initialized
    Type.Literal('resync'), // Client needs to resync
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
});

export type CollabEvent = Static<typeof CollabEventSchema>;
