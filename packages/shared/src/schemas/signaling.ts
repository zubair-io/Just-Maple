import { Type, Static } from '@sinclair/typebox';

// WebRTC signaling message types
export const SignalTypeSchema = Type.Union([
    Type.Literal('announce'), // Peer joined the room
    Type.Literal('leave'), // Peer left the room
    Type.Literal('offer'), // WebRTC SDP offer
    Type.Literal('answer'), // WebRTC SDP answer
    Type.Literal('ice-candidate'), // ICE candidate for connection
]);

export type SignalType = Static<typeof SignalTypeSchema>;

// Signaling message sent between peers via server
export const SignalMessageSchema = Type.Object({
    type: SignalTypeSchema,
    from: Type.String(), // Sender client ID
    to: Type.Optional(Type.String()), // Target client ID (omit for broadcast)
    roomId: Type.String(), // Document/note ID acting as room
    payload: Type.Any(), // Signal-specific data (SDP, ICE candidate, etc.)
    timestamp: Type.Optional(Type.String({ format: 'date-time' })),
});

export type SignalMessage = Static<typeof SignalMessageSchema>;

// Peer presence info for awareness
export const PeerPresenceSchema = Type.Object({
    clientId: Type.String(),
    oderId: Type.String(),
    userName: Type.String(),
    userColor: Type.String(), // Hex color for cursor
    joinedAt: Type.String({ format: 'date-time' }),
    lastSeenAt: Type.String({ format: 'date-time' }),
});

export type PeerPresence = Static<typeof PeerPresenceSchema>;

// Room state (all peers in a document)
export const RoomStateSchema = Type.Object({
    roomId: Type.String(),
    peers: Type.Array(PeerPresenceSchema),
});

export type RoomState = Static<typeof RoomStateSchema>;

// SSE event types for notebook collaboration
export const NotebookSSEEventTypeSchema = Type.Union([
    Type.Literal('ydoc-init'), // Initial document state
    Type.Literal('ydoc-update'), // Document update from another client
    Type.Literal('signal'), // WebRTC signaling message
    Type.Literal('peer-join'), // Peer joined the room
    Type.Literal('peer-leave'), // Peer left the room
    Type.Literal('ping'), // Keepalive ping
]);

export type NotebookSSEEventType = Static<typeof NotebookSSEEventTypeSchema>;

// Generic SSE event wrapper
export const NotebookSSEEventSchema = Type.Object({
    type: NotebookSSEEventTypeSchema,
    data: Type.Any(),
    timestamp: Type.String({ format: 'date-time' }),
});

export type NotebookSSEEvent = Static<typeof NotebookSSEEventSchema>;
