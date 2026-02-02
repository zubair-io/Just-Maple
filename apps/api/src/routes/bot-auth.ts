import { Elysia, t } from 'elysia';
import {
    verifyProvisioningToken,
    markTokenUsed,
} from '../repositories/bot-provisioning-token.repo';
import {
    createSession,
    validateSession,
    revokeSessionByJwtId,
    findActiveSessionsByBotId,
    revokeSession,
} from '../repositories/bot-session.repo';
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
 * - Login: Exchange provisioning token for JWT
 * - Refresh: Get new JWT before expiration
 * - Logout: Revoke current session
 * - Sessions: List and manage active sessions
 */
export const botAuthRoutes = new Elysia({ prefix: '/api/bots' })
    // Login: Exchange provisioning token for JWT
    .post(
        '/login',
        async ({ body, set, request }) => {
            const { provisioning_token } = body;
            const ctx = getRequestContext(request);

            // Verify the provisioning token
            const tokenData = await verifyProvisioningToken(provisioning_token);

            if (!tokenData) {
                // Log failed login attempt (can't know bot ID)
                await logAuditEvent({
                    action: 'bot.login_failed',
                    userId: 'unknown',
                    resourceType: 'bot_auth',
                    metadata: { reason: 'invalid_token' },
                    ...ctx,
                    success: false,
                    errorMessage: 'Invalid or expired provisioning token',
                });

                set.status = 401;
                return {
                    error: 'auth/invalid_token',
                    message: 'Invalid or expired provisioning token',
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

            // Create a session
            const ipAddress = request.headers.get('x-forwarded-for') || 'unknown';
            const userAgent = request.headers.get('user-agent') || undefined;

            const session = await createSession({
                userBotId: tokenData.userBotId,
                userId: tokenData.userId,
                expirationHours: bot.jwtExpirationHours || 12,
                ipAddress,
                userAgent,
            });

            // Generate JWT
            const { jwt, expiresAt } = await generateBotJWT(
                tokenData.userBotId,
                tokenData.userId,
                session.jwtId,
                bot.jwtExpirationHours || 12,
            );

            // Mark provisioning token as used (first use)
            if (!tokenData.usedAt) {
                await markTokenUsed(tokenData._id);
            }

            // Audit log successful login
            await logAuditEvent({
                action: 'bot.login',
                userId: tokenData.userId,
                userBotId: tokenData.userBotId,
                resourceType: 'bot_auth',
                resourceId: session._id,
                metadata: { handle: bot.handle, sessionId: session.jwtId },
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
                provisioning_token: t.String(),
            }),
        },
    )

    // Refresh: Get new JWT before expiration
    .post('/refresh', async ({ request, set }) => {
        const authHeader = request.headers.get('authorization');

        if (!authHeader?.startsWith('Bearer ')) {
            set.status = 401;
            return {
                error: 'auth/missing_token',
                message: 'Authorization header required',
            };
        }

        const token = authHeader.slice(7);
        const payload = await verifyBotJWT(token);

        if (!payload) {
            set.status = 401;
            return {
                error: 'auth/jwt_expired',
                message: 'Invalid or expired JWT',
            };
        }

        // Validate session is still active
        const session = await validateSession(payload.sessionId);

        if (!session) {
            set.status = 401;
            return {
                error: 'auth/session_revoked',
                message: 'Session has been revoked',
            };
        }

        // Get the bot for expiration config
        const bot = await findUserBotByIdInternal(payload.sub);

        if (!bot || bot.status === 'revoked' || bot.status === 'disabled') {
            set.status = 401;
            return {
                error: 'auth/bot_inactive',
                message: 'Bot is disabled or revoked',
            };
        }

        // Generate new JWT with fresh expiration
        const ipAddress = request.headers.get('x-forwarded-for') || 'unknown';
        const userAgent = request.headers.get('user-agent') || undefined;

        const newSession = await createSession({
            userBotId: payload.sub,
            userId: payload.userId,
            expirationHours: bot.jwtExpirationHours || 12,
            ipAddress,
            userAgent,
        });

        // Revoke old session
        await revokeSessionByJwtId(payload.sessionId);

        const { jwt, expiresAt } = await generateBotJWT(
            payload.sub,
            payload.userId,
            newSession.jwtId,
            bot.jwtExpirationHours || 12,
        );

        return {
            jwt,
            expires_at: expiresAt.toISOString(),
            bot_id: bot._id,
            bot_name: bot.displayName || bot.handle,
        };
    })

    // Logout: Revoke current session
    .post('/logout', async ({ request, set }) => {
        const authHeader = request.headers.get('authorization');
        const ctx = getRequestContext(request);

        if (!authHeader?.startsWith('Bearer ')) {
            set.status = 401;
            return {
                error: 'auth/missing_token',
                message: 'Authorization header required',
            };
        }

        const token = authHeader.slice(7);
        const payload = await verifyBotJWT(token);

        if (!payload) {
            // Already invalid/expired, consider it logged out
            return { message: 'Logged out successfully' };
        }

        // Revoke the session
        await revokeSessionByJwtId(payload.sessionId);

        // Audit log
        await logAuditEvent({
            action: 'bot.logout',
            userId: payload.userId,
            userBotId: payload.sub,
            resourceType: 'bot_auth',
            metadata: { sessionId: payload.sessionId },
            ...ctx,
            success: true,
        });

        return { message: 'Logged out successfully' };
    })

    // Get active sessions for the authenticated bot
    .get('/sessions', async ({ request, set }) => {
        const authHeader = request.headers.get('authorization');

        if (!authHeader?.startsWith('Bearer ')) {
            set.status = 401;
            return {
                error: 'auth/missing_token',
                message: 'Authorization header required',
            };
        }

        const token = authHeader.slice(7);
        const payload = await verifyBotJWT(token);

        if (!payload) {
            set.status = 401;
            return {
                error: 'auth/jwt_expired',
                message: 'Invalid or expired JWT',
            };
        }

        const sessions = await findActiveSessionsByBotId(payload.sub);

        return {
            sessions: sessions.map((s) => ({
                _id: s._id,
                created_at: s.createdAt,
                expires_at: s.expiresAt,
                last_used_at: s.lastUsedAt,
                ip_address: s.ipAddress,
                is_current: s.jwtId === payload.sessionId,
            })),
        };
    })

    // Revoke a specific session
    .delete(
        '/sessions/:id',
        async ({ params, request, set }) => {
            const authHeader = request.headers.get('authorization');

            if (!authHeader?.startsWith('Bearer ')) {
                set.status = 401;
                return {
                    error: 'auth/missing_token',
                    message: 'Authorization header required',
                };
            }

            const token = authHeader.slice(7);
            const payload = await verifyBotJWT(token);

            if (!payload) {
                set.status = 401;
                return {
                    error: 'auth/jwt_expired',
                    message: 'Invalid or expired JWT',
                };
            }

            const revoked = await revokeSession(params.id, payload.userId);

            if (!revoked) {
                set.status = 404;
                return {
                    error: 'resource/not_found',
                    message: 'Session not found',
                };
            }

            return { message: 'Session revoked successfully' };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    );
