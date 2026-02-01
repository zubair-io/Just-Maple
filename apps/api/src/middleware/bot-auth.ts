import { Elysia } from 'elysia';
import {
    verifyToken,
    hasPermission,
    canAccessNotebook,
    type BotAccessTokenInternal,
} from '../repositories/bot-token.repo';
import { verifyBotJWT } from '../services/bot-jwt.service';
import { validateSession } from '../repositories/bot-session.repo';
import { findUserBotByIdInternal } from '../repositories/user-bot.repo';
import type { BotJWTPayload, CustomBotPermissions } from '@maple/shared';

/**
 * Bot auth context - available when bot token authentication succeeds
 * Supports both access tokens (template bots) and JWTs (custom bots)
 */
export interface BotAuthContext {
    authType: 'token' | 'jwt';
    token?: BotAccessTokenInternal; // For access token auth
    jwtPayload?: BotJWTPayload; // For JWT auth
    userBotId: string;
    userId: string;
    permissions?: CustomBotPermissions; // For custom bots
}

/**
 * Bot auth middleware - authenticates requests using bot access tokens or JWTs
 * Extracts token from Authorization header: "Bearer <token>"
 */
export const botAuthMiddleware = new Elysia({ name: 'bot-auth-middleware' }).derive(
    async ({ request }) => {
        const authHeader = request.headers.get('authorization');

        if (!authHeader?.startsWith('Bearer ')) {
            return { botAuth: null as BotAuthContext | null };
        }

        const bearerToken = authHeader.slice(7);

        try {
            // Try JWT first (custom bots)
            const jwtPayload = await verifyBotJWT(bearerToken);

            if (jwtPayload) {
                // Validate session is still active
                const session = await validateSession(jwtPayload.sessionId);

                if (!session) {
                    return { botAuth: null as BotAuthContext | null };
                }

                // Get bot for permissions
                const bot = await findUserBotByIdInternal(jwtPayload.sub);

                if (!bot || bot.status === 'revoked' || bot.status === 'disabled') {
                    return { botAuth: null as BotAuthContext | null };
                }

                return {
                    botAuth: {
                        authType: 'jwt',
                        jwtPayload,
                        userBotId: jwtPayload.sub,
                        userId: jwtPayload.userId,
                        permissions: bot.permissions,
                    } as BotAuthContext,
                };
            }

            // Fall back to access token (template bots)
            const token = await verifyToken(bearerToken);

            if (!token) {
                return { botAuth: null as BotAuthContext | null };
            }

            return {
                botAuth: {
                    authType: 'token',
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
 * Helper to check if bot has required permission
 * Works for both access tokens (template bots) and JWTs (custom bots)
 */
export function checkBotPermission(
    botAuth: BotAuthContext,
    permission: 'read' | 'write' | 'invoke',
    set: { status?: number | string },
): boolean {
    // For access token auth, check token permissions
    if (botAuth.authType === 'token' && botAuth.token) {
        if (!hasPermission(botAuth.token, permission)) {
            set.status = 403;
            return false;
        }
        return true;
    }

    // For JWT auth (custom bots), check bot permissions
    if (botAuth.authType === 'jwt' && botAuth.permissions) {
        // Currently only 'messages' permissions are supported
        // Map 'invoke' to 'write' for custom bots
        const mappedPermission = permission === 'invoke' ? 'write' : permission;

        if (!botAuth.permissions.messages[mappedPermission]) {
            set.status = 403;
            return false;
        }
        return true;
    }

    // No valid auth type
    set.status = 403;
    return false;
}

/**
 * Helper to check if bot can access a specific notebook
 * Works for both access tokens (template bots) and JWTs (custom bots)
 */
export async function checkBotNotebookAccess(
    botAuth: BotAuthContext,
    notebookId: string,
    set: { status?: number | string },
): Promise<boolean> {
    // For access token auth, check token scope
    if (botAuth.authType === 'token' && botAuth.token) {
        if (!canAccessNotebook(botAuth.token, notebookId)) {
            set.status = 403;
            return false;
        }
    }

    // For both auth types, verify the bot is shared with this notebook
    const { isBotSharedWithNotebook } = await import('../repositories/user-bot.repo');
    const isShared = await isBotSharedWithNotebook(botAuth.userBotId, notebookId);

    if (!isShared) {
        set.status = 403;
        return false;
    }

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
