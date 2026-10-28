import { Type, Static } from '@sinclair/typebox';
import { PageContentSchema } from './page';
import { BotUIResponseSchema } from './bot-ui';
import { ProactiveMessageMetaSchema } from './proactive';

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

// An earlier version of a message a bot revised in place (see `revisedAt`)
export const MessageRevisionSchema = Type.Object({
    content: PageContentSchema,
    botUI: Type.Optional(BotUIResponseSchema),
    // When this version was written (the post's creation, or an earlier revision)
    at: Type.String({ format: 'date-time' }),
});

export type MessageRevision = Static<typeof MessageRevisionSchema>;

// Message schema - chat messages per page
export const MessageSchema = Type.Object({
    _id: Type.String(),
    id: Type.String(), // UUID v4 for routing
    pageId: Type.String(), // Messages belong to a page (type: 'message')
    notebookId: Type.Optional(Type.String()), // Deprecated: kept for backward compatibility during migration
    threadId: Type.Optional(Type.String()), // If part of a thread (null = top-level message)
    userId: Type.String(), // Sender (user ID or bot owner ID)
    senderType: Type.Optional(SenderTypeSchema), // 'user' | 'bot' | 'system' (defaults to 'user')
    userBotId: Type.Optional(Type.String()), // If senderType = 'bot', reference to UserBot
    senderEmail: Type.Optional(Type.String()), // Populated sender email
    senderDisplayName: Type.Optional(Type.String()), // Populated sender display name (or bot name)
    senderProfilePictureUrl: Type.Optional(Type.String()), // Populated sender profile picture (or bot avatar)
    botUI: Type.Optional(BotUIResponseSchema),
    botModel: Type.Optional(Type.String()),
    content: PageContentSchema, // TipTap/ProseMirror JSON (rich text)
    mentions: Type.Optional(Type.Array(MentionSchema)), // Parsed mentions from content
    hasThread: Type.Optional(Type.Boolean()), // Whether this message has a thread reply
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.Optional(Type.String({ format: 'date-time' })),
    editedAt: Type.Optional(Type.String({ format: 'date-time' })),
    deletedAt: Type.Optional(Type.String({ format: 'date-time' })),
    // Proactive bot posts: what kind of post this is (news, brief, ...)
    proactiveMeta: Type.Optional(ProactiveMessageMetaSchema),
    // A proactive bot rewrote this unread post with newer news ("Updated 3:40 PM")
    revisedAt: Type.Optional(Type.String({ format: 'date-time' })),
    // Earlier versions, oldest first (the first version is always kept)
    revisions: Type.Optional(Type.Array(MessageRevisionSchema)),
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

// Unread tracking per user per page
export const UnreadTrackingSchema = Type.Object({
    _id: Type.String(),
    userId: Type.String(),
    pageId: Type.String(), // Tracks unread per messages page
    notebookId: Type.Optional(Type.String()), // Deprecated: kept for backward compatibility
    lastReadAt: Type.String({ format: 'date-time' }),
});

export type UnreadTracking = Static<typeof UnreadTrackingSchema>;

// Unread count response
export const UnreadCountSchema = Type.Object({
    pageId: Type.String(),
    notebookId: Type.Optional(Type.String()), // Included for convenience (page's notebookId)
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
    Type.Literal('calendar_proposal_updated'), // An "Add to calendar" card changed state
    Type.Literal('bot_action_updated'), // A logged bot action changed (bot-action.ts)
]);

export type ChatAction = Static<typeof ChatActionSchema>;

// Real-time chat event payload
export const ChatEventSchema = Type.Object({
    action: ChatActionSchema,
    data: Type.Any(),
    pageId: Type.String(), // Messages page ID
    notebookId: Type.Optional(Type.String()), // Included for convenience (for permission checks)
    userId: Type.String(),
    timestamp: Type.String({ format: 'date-time' }),
});

export type ChatEvent = Static<typeof ChatEventSchema>;

// Typing indicator event
export const TypingEventSchema = Type.Object({
    pageId: Type.String(), // Messages page ID
    notebookId: Type.Optional(Type.String()), // Included for convenience
    userId: Type.String(),
    isTyping: Type.Boolean(),
});

export type TypingEvent = Static<typeof TypingEventSchema>;
