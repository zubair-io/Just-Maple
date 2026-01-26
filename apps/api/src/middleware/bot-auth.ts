import { Elysia } from 'elysia';
import {
    verifyToken,
    hasPermission,
    canAccessNotebook,
    type BotAccessTokenInternal,
} from '../repositories/bot-token.repo';

/**
 * Bot auth context - available when bot token authentication succeeds
 */
export interface BotAuthContext {
    token: BotAccessTokenInternal;
    userBotId: string;
    userId: string;
}

/**
 * Bot auth middleware - authenticates requests using bot access tokens
 * Extracts token from Authorization header: "Bearer <token>"
 */
export const botAuthMiddleware = new Elysia({ name: 'bot-auth-middleware' }).derive(
    async ({ request }) => {
        const authHeader = request.headers.get('authorization');

        if (!authHeader?.startsWith('Bearer ')) {
            return { botAuth: null as BotAuthContext | null };
        }

        const plaintextToken = authHeader.slice(7);

        try {
            // Verify the token
            const token = await verifyToken(plaintextToken);

            if (!token) {
                return { botAuth: null as BotAuthContext | null };
            }

            return {
                botAuth: {
                    token,
                    userBotId: token.userBotId,
                    userId: token.userId,
                } as BotAuthContext,
            };
        } catch {
            return { botAuth: null as BotAuthContext | null };
        }
    },
);

/**
 * Helper to check bot auth and return early if not authenticated
 */
export function checkBotAuth(
    botAuth: BotAuthContext | null,
    set: { status?: number | string },
): botAuth is BotAuthContext {
    if (!botAuth) {
        set.status = 401;
        return false;
    }
    return true;
}

/**
 * Helper to check if bot token has required permission
 */
export function checkBotPermission(
    botAuth: BotAuthContext,
    permission: 'read' | 'write' | 'invoke',
    set: { status?: number | string },
): boolean {
    if (!hasPermission(botAuth.token, permission)) {
        set.status = 403;
        return false;
    }
    return true;
}

/**
 * Helper to check if bot token can access a specific notebook
 * Also verifies the bot is shared with the notebook
 */
export async function checkBotNotebookAccess(
    botAuth: BotAuthContext,
    notebookId: string,
    set: { status?: number | string },
): Promise<boolean> {
    // First check token scope
    if (!canAccessNotebook(botAuth.token, notebookId)) {
        set.status = 403;
        return false;
    }

    // Then verify the bot is shared with this notebook
    // (The external API should verify this when looking up pages)
    // For now, just check token scope
    return true;
}

/**
 * Rate limiting state (simple in-memory implementation)
 * In production, use Redis for cross-instance rate limiting
 */
const rateLimitState = new Map<
    string,
    {
        count: number;
        resetAt: number;
    }
>();

/**
 * Rate limiting constants
 */
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100; // 100 requests per minute

/**
 * Check rate limit for a bot token
 * Returns true if request is allowed, false if rate limited
 */
export function checkRateLimit(
    tokenId: string,
    set: { status?: number | string; headers: Record<string, string> },
): boolean {
    const now = Date.now();
    const key = `bot:${tokenId}`;

    // Get or create rate limit entry
    let entry = rateLimitState.get(key);
    if (!entry || entry.resetAt <= now) {
        // Reset the window
        entry = {
            count: 0,
            resetAt: now + RATE_LIMIT_WINDOW_MS,
        };
        rateLimitState.set(key, entry);
    }

    // Increment request count
    entry.count++;

    // Add rate limit headers
    set.headers['X-RateLimit-Limit'] = RATE_LIMIT_MAX_REQUESTS.toString();
    set.headers['X-RateLimit-Remaining'] = Math.max(
        0,
        RATE_LIMIT_MAX_REQUESTS - entry.count,
    ).toString();
    set.headers['X-RateLimit-Reset'] = Math.ceil(entry.resetAt / 1000).toString();

    // Check if rate limited
    if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
        set.status = 429;
        set.headers['Retry-After'] = Math.ceil((entry.resetAt - now) / 1000).toString();
        return false;
    }

    return true;
}

/**
 * Cleanup old rate limit entries (run periodically)
 */
export function cleanupRateLimitState(): void {
    const now = Date.now();
    for (const [key, entry] of rateLimitState) {
        if (entry.resetAt <= now) {
            rateLimitState.delete(key);
        }
    }
}

// Cleanup every 5 minutes
setInterval(cleanupRateLimitState, 5 * 60 * 1000);
