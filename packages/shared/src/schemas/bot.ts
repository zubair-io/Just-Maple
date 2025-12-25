import { Type, Static } from '@sinclair/typebox';

// ============================================
// UI Component Types
// ============================================

export const UIComponentTypeSchema = Type.Union([
    Type.Literal('text'),
    Type.Literal('markdown'),
    Type.Literal('code'),
    Type.Literal('list'),
    Type.Literal('status'),
    Type.Literal('button'),
    Type.Literal('divider'),
    Type.Literal('card'),
]);

export type UIComponentType = Static<typeof UIComponentTypeSchema>;

// UI component for bot output rendering
// Note: children uses Type.Any() to avoid recursive type complexity
export const UIComponentSchema = Type.Object({
    id: Type.String(),
    type: UIComponentTypeSchema,
    condition: Type.Optional(Type.String()),
    props: Type.Optional(Type.Record(Type.String(), Type.Any())),
    children: Type.Optional(Type.Array(Type.Any())), // Nested UIComponents
});

export type UIComponent = Static<typeof UIComponentSchema>;

// ============================================
// Action Types
// ============================================

export const ActionTypeSchema = Type.Union([
    Type.Literal('llm'), // Call LLM with prompt
    Type.Literal('set'), // Set variable
    Type.Literal('transform'), // Transform data
    Type.Literal('http'), // HTTP request
    Type.Literal('reply'), // Simple reply action
]);

export type ActionType = Static<typeof ActionTypeSchema>;

export const ActionSchema = Type.Object({
    type: ActionTypeSchema,
    id: Type.String(),
    config: Type.Record(Type.String(), Type.Any()),
    outputVariable: Type.Optional(Type.String()),
});

export type Action = Static<typeof ActionSchema>;

// ============================================
// Bot Definition
// ============================================

export const BotTriggerSchema = Type.Object({
    mentionPatterns: Type.Optional(Type.Array(Type.String())),
});

export type BotTrigger = Static<typeof BotTriggerSchema>;

export const BotInputSchema = Type.Object({
    includeContext: Type.Object({
        mentionText: Type.Optional(Type.Boolean()),
        fullMessage: Type.Optional(Type.Boolean()),
        documentContent: Type.Optional(Type.Boolean()),
        documentTitle: Type.Optional(Type.Boolean()),
        previousMessages: Type.Optional(Type.Number()),
        selection: Type.Optional(Type.Boolean()),
    }),
});

export type BotInput = Static<typeof BotInputSchema>;

export const BotOutputSchema = Type.Object({
    chatView: Type.Optional(
        Type.Object({
            components: Type.Array(UIComponentSchema),
        }),
    ),
    noteView: Type.Optional(
        Type.Object({
            components: Type.Array(UIComponentSchema),
            width: Type.Optional(
                Type.Union([
                    Type.Literal('narrow'),
                    Type.Literal('medium'),
                    Type.Literal('wide'),
                    Type.Literal('full'),
                ]),
            ),
            collapsible: Type.Optional(Type.Boolean()),
        }),
    ),
});

export type BotOutput = Static<typeof BotOutputSchema>;

export const BotDefinitionSchema = Type.Object({
    trigger: BotTriggerSchema,
    input: BotInputSchema,
    actions: Type.Array(ActionSchema),
    output: BotOutputSchema,
    onError: Type.Optional(
        Type.Object({
            retryCount: Type.Optional(Type.Number()),
            fallbackMessage: Type.Optional(Type.String()),
        }),
    ),
});

export type BotDefinition = Static<typeof BotDefinitionSchema>;

// ============================================
// Bot Configuration (User-provided settings)
// ============================================

// Settings that users provide when registering a bot that requires configuration
export const BotConfigSchema = Type.Object({
    apiKey: Type.Optional(Type.String()), // For bots that need external API keys (e.g., Claude)
    customSettings: Type.Optional(Type.Record(Type.String(), Type.Any())),
});

export type BotConfig = Static<typeof BotConfigSchema>;

// ============================================
// Bot Template (System-defined bot types)
// ============================================

export const BotTemplateSchema = Type.Object({
    _id: Type.String(),
    name: Type.String(),
    handle: Type.String(), // e.g., "hello", "claude"
    description: Type.Optional(Type.String()),
    avatar: Type.Optional(Type.String()),
    definition: BotDefinitionSchema,
    requiresConfig: Type.Boolean(), // Whether user needs to provide config (e.g., API key)
    configSchema: Type.Optional(Type.Any()), // JSON schema for required config
    isSystemBot: Type.Boolean(), // System-provided bots
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type BotTemplate = Static<typeof BotTemplateSchema>;

// ============================================
// User Bot Registration
// ============================================

// When a user registers a bot to their account
export const UserBotSchema = Type.Object({
    _id: Type.String(),
    userId: Type.String(), // Owner
    templateId: Type.String(), // Reference to BotTemplate
    handle: Type.String(), // User's chosen handle (must be unique per user)
    displayName: Type.Optional(Type.String()), // Custom display name
    config: Type.Optional(BotConfigSchema), // User-provided configuration (encrypted)
    isEnabled: Type.Boolean(),
    tagId: Type.Optional(Type.String()), // Scope to specific tag (null = all user's tags)
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type UserBot = Static<typeof UserBotSchema>;

// Create user bot input
export const CreateUserBotSchema = Type.Object({
    templateId: Type.String(),
    handle: Type.Optional(Type.String()), // Optional custom handle
    displayName: Type.Optional(Type.String()),
    config: Type.Optional(BotConfigSchema),
    tagId: Type.Optional(Type.String()),
});

export type CreateUserBotInput = Static<typeof CreateUserBotSchema>;

// Update user bot input
export const UpdateUserBotSchema = Type.Object({
    displayName: Type.Optional(Type.String()),
    config: Type.Optional(BotConfigSchema),
    isEnabled: Type.Optional(Type.Boolean()),
    tagId: Type.Optional(Type.String()),
});

export type UpdateUserBotInput = Static<typeof UpdateUserBotSchema>;

// ============================================
// Bot Invocation
// ============================================

export const InvocationStatusSchema = Type.Union([
    Type.Literal('pending'),
    Type.Literal('running'),
    Type.Literal('completed'),
    Type.Literal('failed'),
    Type.Literal('cancelled'),
]);

export type InvocationStatus = Static<typeof InvocationStatusSchema>;

export const BotInvocationSchema = Type.Object({
    _id: Type.String(),
    userBotId: Type.String(), // Reference to UserBot
    templateId: Type.String(), // Reference to BotTemplate
    sourceType: Type.Union([Type.Literal('message'), Type.Literal('note')]),
    sourceId: Type.String(), // Message or Note ID (parent message for threads)
    tagId: Type.String(),
    userId: Type.String(), // Who triggered the bot
    context: Type.Object({
        mentionText: Type.Optional(Type.String()),
        fullContent: Type.Optional(Type.String()),
        documentTitle: Type.Optional(Type.String()),
        selection: Type.Optional(Type.String()),
        previousMessages: Type.Optional(Type.Array(Type.Any())),
    }),
    variables: Type.Record(Type.String(), Type.Any()),
    // Output is NoteContent (ProseMirror JSON) for consistent rendering with TipTap
    output: Type.Optional(Type.Any()),
    status: InvocationStatusSchema,
    error: Type.Optional(
        Type.Object({
            code: Type.String(),
            message: Type.String(),
            step: Type.Optional(Type.String()),
        }),
    ),
    threadId: Type.Optional(Type.String()), // Thread where bot responded
    responseMessageId: Type.Optional(Type.String()), // Bot's response message
    executionTimeMs: Type.Optional(Type.Number()),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type BotInvocation = Static<typeof BotInvocationSchema>;

// ============================================
// Resolved Bot (Runtime view combining template + user config)
// ============================================

export const ResolvedBotSchema = Type.Object({
    userBotId: Type.String(),
    templateId: Type.String(),
    userId: Type.String(),
    handle: Type.String(),
    displayName: Type.String(),
    avatar: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    definition: BotDefinitionSchema,
    config: Type.Optional(BotConfigSchema),
    isEnabled: Type.Boolean(),
});

export type ResolvedBot = Static<typeof ResolvedBotSchema>;
