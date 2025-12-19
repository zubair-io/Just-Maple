import { Type, Static } from '@sinclair/typebox';
import { NoteContentSchema } from './note';

// Message schema - chat messages per tag
export const MessageSchema = Type.Object({
    _id: Type.String(),
    tagId: Type.String(), // Chat is per-tag
    userId: Type.String(), // Sender
    senderEmail: Type.Optional(Type.String()), // Populated sender email
    senderDisplayName: Type.Optional(Type.String()), // Populated sender display name
    senderProfilePictureUrl: Type.Optional(Type.String()), // Populated sender profile picture
    content: NoteContentSchema, // TipTap/ProseMirror JSON (rich text)
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.Optional(Type.String({ format: 'date-time' })),
    editedAt: Type.Optional(Type.String({ format: 'date-time' })),
    deletedAt: Type.Optional(Type.String({ format: 'date-time' })),
});

export type Message = Static<typeof MessageSchema>;

// Create message input
export const CreateMessageSchema = Type.Object({
    content: NoteContentSchema,
});

export type CreateMessageInput = Static<typeof CreateMessageSchema>;

// Update message input
export const UpdateMessageSchema = Type.Object({
    content: NoteContentSchema,
});

export type UpdateMessageInput = Static<typeof UpdateMessageSchema>;

// Unread tracking per user per tag
export const UnreadTrackingSchema = Type.Object({
    _id: Type.String(),
    userId: Type.String(),
    tagId: Type.String(),
    lastReadAt: Type.String({ format: 'date-time' }),
});

export type UnreadTracking = Static<typeof UnreadTrackingSchema>;

// Unread count response
export const UnreadCountSchema = Type.Object({
    tagId: Type.String(),
    count: Type.Number(),
});

export type UnreadCount = Static<typeof UnreadCountSchema>;

// Real-time chat event actions
export const ChatActionSchema = Type.Union([
    Type.Literal('message'),
    Type.Literal('typing'),
    Type.Literal('edited'),
    Type.Literal('deleted'),
    Type.Literal('paper_created'),
    Type.Literal('paper_updated'),
    Type.Literal('paper_deleted'),
]);

export type ChatAction = Static<typeof ChatActionSchema>;

// Real-time chat event payload
export const ChatEventSchema = Type.Object({
    action: ChatActionSchema,
    data: Type.Any(),
    tagId: Type.String(),
    userId: Type.String(),
    timestamp: Type.String({ format: 'date-time' }),
});

export type ChatEvent = Static<typeof ChatEventSchema>;

// Typing indicator event
export const TypingEventSchema = Type.Object({
    tagId: Type.String(),
    userId: Type.String(),
    isTyping: Type.Boolean(),
});

export type TypingEvent = Static<typeof TypingEventSchema>;
