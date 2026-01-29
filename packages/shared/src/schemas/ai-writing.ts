import { Type, Static } from '@sinclair/typebox';

// ============================================
// AI Writing Request Types
// ============================================

export const AIWritingTypeSchema = Type.Union([
    Type.Literal('continue'),
    Type.Literal('improve'),
    Type.Literal('simplify'),
    Type.Literal('expand'),
    Type.Literal('shorten'),
    Type.Literal('summarize'),
    Type.Literal('grammar'),
    Type.Literal('translate'),
    Type.Literal('custom'),
]);

export type AIWritingType = Static<typeof AIWritingTypeSchema>;

export const AIWritingRequestSchema = Type.Object({
    type: AIWritingTypeSchema,
    selection: Type.Optional(Type.String()), // Selected text
    context: Type.String(), // Surrounding content
    instruction: Type.Optional(Type.String()), // For custom prompts
    targetLanguage: Type.Optional(Type.String()), // For translate
    pageId: Type.Optional(Type.String()), // For analytics
});

export type AIWritingRequest = Static<typeof AIWritingRequestSchema>;

// ============================================
// AI Writing Response Types (SSE Events)
// ============================================

export const AITokenEventSchema = Type.Object({
    text: Type.String(),
});

export type AITokenEvent = Static<typeof AITokenEventSchema>;

export const AIDoneEventSchema = Type.Object({
    tokensUsed: Type.Number(),
    finishReason: Type.String(),
});

export type AIDoneEvent = Static<typeof AIDoneEventSchema>;

export const AIErrorEventSchema = Type.Object({
    error: Type.String(),
    resetAt: Type.Optional(Type.String()), // ISO date for rate limit reset
});

export type AIErrorEvent = Static<typeof AIErrorEventSchema>;

// ============================================
// AI Usage Tracking
// ============================================

export const AIUsageSchema = Type.Object({
    userId: Type.String(),
    date: Type.String(), // YYYY-MM-DD
    requests: Type.Number(),
    tokensInput: Type.Number(),
    tokensOutput: Type.Number(),
    createdAt: Type.String({ format: 'date-time' }),
    updatedAt: Type.String({ format: 'date-time' }),
});

export type AIUsage = Static<typeof AIUsageSchema>;

export const AIUsageResponseSchema = Type.Object({
    daily: Type.Object({
        requests: Type.Number(),
        tokens: Type.Number(),
        limit: Type.Number(),
    }),
    monthly: Type.Object({
        requests: Type.Number(),
        tokens: Type.Number(),
    }),
    resetAt: Type.String(), // ISO date
});

export type AIUsageResponse = Static<typeof AIUsageResponseSchema>;

// ============================================
// Rate Limiting
// ============================================

export const AI_RATE_LIMITS = {
    FREE_TIER: {
        DAILY_REQUESTS: 50,
        DAILY_TOKENS: 100000,
    },
    PRO_TIER: {
        DAILY_REQUESTS: 500,
        DAILY_TOKENS: 1000000,
    },
} as const;
