import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import type { JWTPayload } from '@maple/shared';
import {
    createCustomBot,
    updateCustomBot,
    findCustomBotsByUserId,
    findUserBotById,
    updateBotStatus,
    regenerateWebhookSecret,
    deleteCustomBot,
    findUserBotByHandle,
} from '../repositories/user-bot.repo';
import {
    createBotToken,
    revokeAllBotTokens,
    regenerateBotToken,
} from '../repositories/bot-auth-token.repo';
import { logAuditEvent, createBotAuditEntry } from '../services/audit-log.service';
import { CreateCustomBotSchema, UpdateCustomBotSchema } from '@maple/shared';

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
 * Custom Bot Management Routes
 *
 * User-facing routes for creating and managing custom bots.
 * These require user authentication (not bot auth).
 */
export const customBotRoutes = new Elysia({ prefix: '/api/custom-bots' })
    .use(jwtPlugin)
    .derive(async ({ jwt, request }) => {
        const authHeader = request.headers.get('authorization');
        if (!authHeader?.startsWith('Bearer ')) {
            return { auth: null as AuthContext | null };
        }
        const token = authHeader.slice(7);
        try {
            const payload = (await jwt.verify(token)) as JWTPayload | false;
            if (!payload) return { auth: null as AuthContext | null };
            const user = await findUserById(payload.sub);
            if (!user) return { auth: null as AuthContext | null };
            return { auth: { user, payload } as AuthContext };
        } catch {
            return { auth: null as AuthContext | null };
        }
    })

    // List user's custom bots
    .get('/', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized' };
        }

        const bots = await findCustomBotsByUserId(auth.user._id);

        return { bots };
    })

    // Create a custom bot
    .post(
        '/',
        async ({ auth, set, body, request }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            const ctx = getRequestContext(request);

            // Check if handle is already taken
            const existingBot = await findUserBotByHandle(auth.user._id, body.handle);
            if (existingBot) {
                set.status = 400;
                return {
                    error: 'validation/duplicate_handle',
                    message: 'A bot with this handle already exists',
                };
            }

            // Create the custom bot
            const { bot, webhookSecret } = await createCustomBot(auth.user._id, body);

            // Create a bot auth token
            const { plaintextToken } = await createBotToken(bot._id, auth.user._id);

            // Audit log
            await logAuditEvent(
                createBotAuditEntry('custom_bot.created', auth.user._id, bot._id, {
                    metadata: {
                        handle: body.handle,
                        invokeUrl: body.invokeUrl,
                        permissions: body.permissions,
                    },
                    ...ctx,
                }),
            );

            return {
                bot,
                botToken: plaintextToken,
                webhookSecret: webhookSecret,
            };
        },
        {
            body: CreateCustomBotSchema,
        },
    )

    // Get a specific custom bot
    .get(
        '/:id',
        async ({ auth, set, params }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            const bot = await findUserBotById(params.id);

            if (!bot || bot.userId !== auth.user._id || bot.botType !== 'custom') {
                set.status = 404;
                return {
                    error: 'resource/not_found',
                    message: 'Bot not found',
                };
            }

            return { bot };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Update a custom bot
    .patch(
        '/:id',
        async ({ auth, set, params, body }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            const existing = await findUserBotById(params.id);
            if (!existing || existing.userId !== auth.user._id || existing.botType !== 'custom') {
                set.status = 404;
                return {
                    error: 'resource/not_found',
                    message: 'Bot not found or not a custom bot',
                };
            }
            if (body.handle !== undefined) {
                body.handle = body.handle.toLowerCase();
                const taken = await findUserBotByHandle(auth.user._id, body.handle);
                if (taken && taken._id !== params.id) {
                    set.status = 409;
                    return {
                        error: 'validation/duplicate_handle',
                        message: `You already have a bot with handle @${body.handle}`,
                    };
                }
            }
            let bot;
            try {
                bot = await updateCustomBot(params.id, auth.user._id, body);
            } catch (error) {
                if ((error as { code?: number }).code !== 11000) throw error;
                set.status = 409;
                return {
                    error: 'validation/duplicate_handle',
                    message: 'A bot with this handle already exists',
                };
            }

            if (!bot) {
                set.status = 404;
                return {
                    error: 'resource/not_found',
                    message: 'Bot not found or not a custom bot',
                };
            }

            return { bot };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: UpdateCustomBotSchema,
        },
    )

    // Delete a custom bot
    .delete(
        '/:id',
        async ({ auth, set, params, request }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            const ctx = getRequestContext(request);

            // Verify ownership before any modifications
            const bot = await findUserBotById(params.id);

            if (!bot || bot.userId !== auth.user._id || bot.botType !== 'custom') {
                set.status = 404;
                return {
                    error: 'resource/not_found',
                    message: 'Bot not found or not a custom bot',
                };
            }

            // Revoke all tokens
            await revokeAllBotTokens(params.id);

            const deleted = await deleteCustomBot(params.id, auth.user._id);

            if (!deleted) {
                set.status = 500;
                return {
                    error: 'server/delete_failed',
                    message: 'Failed to delete bot',
                };
            }

            // Audit log
            await logAuditEvent(
                createBotAuditEntry('custom_bot.deleted', auth.user._id, params.id, {
                    metadata: { handle: bot.handle },
                    ...ctx,
                }),
            );

            return { message: 'Bot deleted successfully' };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Regenerate bot token
    .post(
        '/:id/regenerate-token',
        async ({ auth, set, params, request }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            const ctx = getRequestContext(request);

            // Verify ownership
            const bot = await findUserBotById(params.id);

            if (!bot || bot.userId !== auth.user._id || bot.botType !== 'custom') {
                set.status = 404;
                return {
                    error: 'resource/not_found',
                    message: 'Bot not found',
                };
            }

            // Revoke existing and create new token
            const { plaintextToken } = await regenerateBotToken(params.id, auth.user._id);

            // Audit log
            await logAuditEvent(
                createBotAuditEntry('custom_bot.token_regenerated', auth.user._id, params.id, {
                    metadata: { handle: bot.handle },
                    ...ctx,
                }),
            );

            return {
                botToken: plaintextToken,
                message: 'New bot token generated. All previous tokens are now invalid.',
            };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Regenerate webhook secret
    .post(
        '/:id/webhook-secret',
        async ({ auth, set, params, request }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            const ctx = getRequestContext(request);

            const webhookSecret = await regenerateWebhookSecret(params.id, auth.user._id);

            if (!webhookSecret) {
                set.status = 404;
                return {
                    error: 'resource/not_found',
                    message: 'Bot not found or not a custom bot',
                };
            }

            // Audit log
            await logAuditEvent(
                createBotAuditEntry('custom_bot.secret_regenerated', auth.user._id, params.id, ctx),
            );

            return {
                webhookSecret: webhookSecret,
                message: 'New webhook secret generated.',
            };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Update bot status (enable/disable)
    .post(
        '/:id/status',
        async ({ auth, set, params, body, request }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            const ctx = getRequestContext(request);

            const updated = await updateBotStatus(params.id, auth.user._id, body.status);

            if (!updated) {
                set.status = 404;
                return {
                    error: 'resource/not_found',
                    message: 'Bot not found or not a custom bot',
                };
            }

            // Audit log
            await logAuditEvent(
                createBotAuditEntry('custom_bot.status_changed', auth.user._id, params.id, {
                    metadata: { newStatus: body.status },
                    ...ctx,
                }),
            );

            // Fetch and return the updated bot
            const updatedBot = await findUserBotById(params.id);

            return {
                bot: updatedBot,
                message: `Bot status updated to ${body.status}`,
            };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                status: t.Union([t.Literal('active'), t.Literal('disabled'), t.Literal('revoked')]),
            }),
        },
    );
