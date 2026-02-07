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
    isOAuthToken: Type.Optional(Type.Boolean()), // Whether apiKey is an OAuth token (vs API key)
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

// Bot type: template (system-defined) or custom (user webhook)
export const BotTypeSchema = Type.Union([
    Type.Literal('template'), // Existing template-based bots
    Type.Literal('custom'), // New webhook-based bots
]);

export type BotType = Static<typeof BotTypeSchema>;

// Permissions for custom bots
export const CustomBotPermissionsSchema = Type.Object({
    messages: Type.Object({
        read: Type.Boolean(),
        write: Type.Boolean(),
    }),
    memos: Type.Optional(
        Type.Object({
            read: Type.Boolean(),
            write: Type.Boolean(),
        }),
    ),
});

export type CustomBotPermissions = Static<typeof CustomBotPermissionsSchema>;

// When a user registers a bot to their account
export const UserBotSchema = Type.Object({
    _id: Type.String(),
    userId: Type.String(), // Owner
    templateId: Type.Optional(Type.String()), // Reference to BotTemplate (required for template bots)
    handle: Type.String(), // User's chosen handle (must be unique per user)
    displayName: Type.Optional(Type.String()), // Custom display name
    description: Type.Optional(Type.String()), // Bot description
    avatar: Type.Optional(Type.String()), // Bot avatar URL
    config: Type.Optional(BotConfigSchema), // User-provided configuration (encrypted)
    isEnabled: Type.Boolean(),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),

    // Custom bot fields
    botType: Type.Optional(BotTypeSchema), // Default 'template' for backward compat
    invokeUrl: Type.Optional(Type.String()), // Webhook URL for custom bots
    webhookSecret: Type.Optional(Type.String()), // HMAC secret for signature verification
    permissions: Type.Optional(CustomBotPermissionsSchema), // Permissions for custom bots
    jwtExpirationHours: Type.Optional(Type.Number()), // JWT expiration (default 12)
    status: Type.Optional(
        Type.Union([Type.Literal('active'), Type.Literal('disabled'), Type.Literal('revoked')]),
    ),
});

export type UserBot = Static<typeof UserBotSchema>;

// Create user bot input (for template bots)
export const CreateUserBotSchema = Type.Object({
    templateId: Type.String(),
    handle: Type.Optional(Type.String()), // Optional custom handle
    displayName: Type.Optional(Type.String()),
    config: Type.Optional(BotConfigSchema),
});

export type CreateUserBotInput = Static<typeof CreateUserBotSchema>;

// Create custom bot input
export const CreateCustomBotSchema = Type.Object({
    name: Type.String({ minLength: 1, maxLength: 50 }),
    handle: Type.String({ minLength: 1, maxLength: 30, pattern: '^[a-z0-9_-]+$' }),
    description: Type.Optional(Type.String({ maxLength: 500 })),
    invokeUrl: Type.String({ format: 'uri' }),
    permissions: CustomBotPermissionsSchema,
    jwtExpirationHours: Type.Optional(Type.Number({ minimum: 1, maximum: 720, default: 12 })), // 1h to 30 days
});

export type CreateCustomBotInput = Static<typeof CreateCustomBotSchema>;

// Update user bot input
export const UpdateUserBotSchema = Type.Object({
    displayName: Type.Optional(Type.String()),
    config: Type.Optional(BotConfigSchema),
    isEnabled: Type.Optional(Type.Boolean()),
});

export type UpdateUserBotInput = Static<typeof UpdateUserBotSchema>;

// Update custom bot input
export const UpdateCustomBotSchema = Type.Object({
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
    description: Type.Optional(Type.String({ maxLength: 500 })),
    invokeUrl: Type.Optional(Type.String({ format: 'uri' })),
    permissions: Type.Optional(CustomBotPermissionsSchema),
    jwtExpirationHours: Type.Optional(Type.Number({ minimum: 1, maximum: 720 })),
    isEnabled: Type.Optional(Type.Boolean()),
});

export type UpdateCustomBotInput = Static<typeof UpdateCustomBotSchema>;

// ============================================
// Bot Auth Token (long-lived, revocable, reusable)
// ============================================

export const BotTokenSchema = Type.Object({
    _id: Type.String(),
    userBotId: Type.String(),
    userId: Type.String(),
    createdAt: Type.String({ format: 'date-time' }),
    lastUsedAt: Type.Optional(Type.String({ format: 'date-time' })),
    revokedAt: Type.Optional(Type.String({ format: 'date-time' })),
});

export type BotToken = Static<typeof BotTokenSchema>;

// ============================================
// Bot JWT Payload
// ============================================

export const BotJWTPayloadSchema = Type.Object({
    sub: Type.String(), // Bot ID (userBotId)
    userId: Type.String(), // Owner user ID
    type: Type.Literal('bot'), // Distinguish from user JWTs
    permissions: CustomBotPermissionsSchema, // Embedded permissions
    iat: Type.Number(),
    exp: Type.Number(),
});

export type BotJWTPayload = Static<typeof BotJWTPayloadSchema>;

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
    notebookId: Type.String(),
    userId: Type.String(), // Who triggered the bot
    context: Type.Object({
        mentionText: Type.Optional(Type.String()),
        fullContent: Type.Optional(Type.String()),
        documentTitle: Type.Optional(Type.String()),
        selection: Type.Optional(Type.String()),
        previousMessages: Type.Optional(Type.Array(Type.Any())),
    }),
    variables: Type.Record(Type.String(), Type.Any()),
    // Output is PageContent (ProseMirror JSON) for consistent rendering with TipTap
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
