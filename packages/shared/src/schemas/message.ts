import { Type, Static } from '@sinclair/typebox';
import { PageContentSchema } from './page';

// Sender type - distinguishes between user and bot messages
export const SenderTypeSchema = Type.Union([
    Type.Literal('user'),
    Type.Literal('bot'),
    Type.Literal('system'),
]);

export type SenderType = Static<typeof SenderTypeSchema>;

// Parsed mention in content
export const MentionSchema = Type.Object({
    type: Type.Union([Type.Literal('user'), Type.Literal('bot')]),
    id: Type.String(),
    handle: Type.String(),
    startIndex: Type.Number(),
    endIndex: Type.Number(),
});

export type Mention = Static<typeof MentionSchema>;

// Message schema - chat messages per tag
export const MessageSchema = Type.Object({
    _id: Type.String(),
    id: Type.String(), // UUID v4 for routing
    notebookId: Type.String(), // Chat is per-tag
    threadId: Type.Optional(Type.String()), // If part of a thread (null = top-level message)
    userId: Type.String(), // Sender (user ID or bot owner ID)
    senderType: Type.Optional(SenderTypeSchema), // 'user' | 'bot' | 'system' (defaults to 'user')
    userBotId: Type.Optional(Type.String()), // If senderType = 'bot', reference to UserBot
    senderEmail: Type.Optional(Type.String()), // Populated sender email
    senderDisplayName: Type.Optional(Type.String()), // Populated sender display name (or bot name)
    senderProfilePictureUrl: Type.Optional(Type.String()), // Populated sender profile picture (or bot avatar)
    content: PageContentSchema, // TipTap/ProseMirror JSON (rich text)
    mentions: Type.Optional(Type.Array(MentionSchema)), // Parsed mentions from content
    hasThread: Type.Optional(Type.Boolean()), // Whether this message has a thread reply
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.Optional(Type.String({ format: 'date-time' })),
    editedAt: Type.Optional(Type.String({ format: 'date-time' })),
    deletedAt: Type.Optional(Type.String({ format: 'date-time' })),
});

export type Message = Static<typeof MessageSchema>;

// Create message input
export const CreateMessageSchema = Type.Object({
    content: PageContentSchema,
});

export type CreateMessageInput = Static<typeof CreateMessageSchema>;

// Update message input
export const UpdateMessageSchema = Type.Object({
    content: PageContentSchema,
});

export type UpdateMessageInput = Static<typeof UpdateMessageSchema>;

// Unread tracking per user per tag
export const UnreadTrackingSchema = Type.Object({
    _id: Type.String(),
    userId: Type.String(),
    notebookId: Type.String(),
    lastReadAt: Type.String({ format: 'date-time' }),
});

export type UnreadTracking = Static<typeof UnreadTrackingSchema>;

// Unread count response
export const UnreadCountSchema = Type.Object({
    notebookId: Type.String(),
    count: Type.Number(),
});

export type UnreadCount = Static<typeof UnreadCountSchema>;

// Real-time chat event actions
export const ChatActionSchema = Type.Union([
    Type.Literal('message'),
    Type.Literal('typing'),
    Type.Literal('edited'),
    Type.Literal('deleted'),
    Type.Literal('message_updated'), // Message metadata updated (e.g., hasThread flag)
    Type.Literal('thread_created'), // New thread started
    Type.Literal('thread_message'), // Message posted to thread
    Type.Literal('bot_invocation_started'), // Bot started processing
    Type.Literal('bot_invocation_completed'), // Bot finished
    Type.Literal('bot_invocation_failed'), // Bot failed
    Type.Literal('collectable_created'),
    Type.Literal('collectable_updated'),
    Type.Literal('collectable_deleted'),
]);

export type ChatAction = Static<typeof ChatActionSchema>;

// Real-time chat event payload
export const ChatEventSchema = Type.Object({
    action: ChatActionSchema,
    data: Type.Any(),
    notebookId: Type.String(),
    userId: Type.String(),
    timestamp: Type.String({ format: 'date-time' }),
});

export type ChatEvent = Static<typeof ChatEventSchema>;

// Typing indicator event
export const TypingEventSchema = Type.Object({
    notebookId: Type.String(),
    userId: Type.String(),
    isTyping: Type.Boolean(),
});

export type TypingEvent = Static<typeof TypingEventSchema>;
