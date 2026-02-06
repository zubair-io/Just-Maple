import { Elysia, t } from 'elysia';
import { verifyBotToken } from '../repositories/bot-auth-token.repo';
import { findUserBotByIdInternal } from '../repositories/user-bot.repo';
import { generateBotJWT, verifyBotJWT } from '../services/bot-jwt.service';
import { logAuditEvent } from '../services/audit-log.service';

// Helper to extract request context for audit logs
function getRequestContext(request: Request): { ipAddress?: string; userAgent?: string } {
    return {
        ipAddress:
            request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
            request.headers.get('x-real-ip') ||
            undefined,
        userAgent: request.headers.get('user-agent') || undefined,
    };
}

/**
 * Bot Authentication Routes
 *
 * Handles authentication for custom bots:
 * - Login: Exchange bot token for JWT (also used for refresh — just call login again)
 * - Logout: No-op, JWT just expires
 */
export const botAuthRoutes = new Elysia({ prefix: '/api/bots' })
    // Login: Exchange bot token for JWT
    .post(
        '/login',
        async ({ body, set, request }) => {
            const { token } = body;
            const ctx = getRequestContext(request);

            // Verify the bot token (hash lookup, check not revoked, update lastUsedAt)
            const tokenData = await verifyBotToken(token);

            if (!tokenData) {
                await logAuditEvent({
                    action: 'bot.login_failed',
                    userId: 'unknown',
                    resourceType: 'bot_auth',
                    metadata: { reason: 'invalid_token' },
                    ...ctx,
                    success: false,
                    errorMessage: 'Invalid or revoked bot token',
                });

                set.status = 401;
                return {
                    error: 'auth/invalid_token',
                    message: 'Invalid or revoked bot token',
                };
            }

            // Get the bot to verify it exists and is active
            const bot = await findUserBotByIdInternal(tokenData.userBotId);

            if (!bot) {
                await logAuditEvent({
                    action: 'bot.login_failed',
                    userId: tokenData.userId,
                    userBotId: tokenData.userBotId,
                    resourceType: 'bot_auth',
                    metadata: { reason: 'bot_not_found' },
                    ...ctx,
                    success: false,
                    errorMessage: 'Bot not found',
                });

                set.status = 401;
                return {
                    error: 'auth/invalid_token',
                    message: 'Bot not found',
                };
            }

            if (bot.status === 'revoked' || bot.status === 'disabled') {
                await logAuditEvent({
                    action: 'bot.login_failed',
                    userId: tokenData.userId,
                    userBotId: tokenData.userBotId,
                    resourceType: 'bot_auth',
                    metadata: { reason: 'bot_inactive', status: bot.status },
                    ...ctx,
                    success: false,
                    errorMessage: 'Bot is disabled or revoked',
                });

                set.status = 401;
                return {
                    error: 'auth/bot_inactive',
                    message: 'Bot is disabled or revoked',
                };
            }

            // Generate JWT with embedded permissions (no session, no DB lookup on verify)
            const permissions = bot.permissions || {
                messages: { read: true, write: true },
            };

            const { jwt, expiresAt } = await generateBotJWT(
                tokenData.userBotId,
                tokenData.userId,
                permissions,
                bot.jwtExpirationHours || 12,
            );

            // Audit log successful login
            await logAuditEvent({
                action: 'bot.login',
                userId: tokenData.userId,
                userBotId: tokenData.userBotId,
                resourceType: 'bot_auth',
                metadata: { handle: bot.handle },
                ...ctx,
                success: true,
            });

            return {
                jwt,
                expires_at: expiresAt.toISOString(),
                bot_id: bot._id,
                bot_name: bot.displayName || bot.handle,
            };
        },
        {
            body: t.Object({
                token: t.String(),
            }),
        },
    )

    // Logout: No-op — JWT just expires. Kept for client compatibility.
    .post('/logout', async ({ request }) => {
        const authHeader = request.headers.get('authorization');
        const ctx = getRequestContext(request);

        if (authHeader?.startsWith('Bearer ')) {
            const token = authHeader.slice(7);
            const payload = await verifyBotJWT(token);

            if (payload) {
                await logAuditEvent({
                    action: 'bot.logout',
                    userId: payload.userId,
                    userBotId: payload.sub,
                    resourceType: 'bot_auth',
                    ...ctx,
                    success: true,
                });
            }
        }

        return { message: 'Logged out successfully' };
    });
