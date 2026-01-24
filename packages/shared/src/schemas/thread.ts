import { Type, Static } from '@sinclair/typebox';

// Thread schema - for bot responses attached to parent messages
export const ThreadSchema = Type.Object({
    _id: Type.String(),
    parentMessageId: Type.String(), // The message where @bot was mentioned
    notebookId: Type.String(),
    botInvocationId: Type.Optional(Type.String()), // If thread was created by bot
    messageCount: Type.Number(),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type Thread = Static<typeof ThreadSchema>;

// Thread with messages for API response
export const ThreadWithMessagesSchema = Type.Object({
    thread: ThreadSchema,
    messages: Type.Array(Type.Any()), // Message[]
});

export type ThreadWithMessages = Static<typeof ThreadWithMessagesSchema>;
