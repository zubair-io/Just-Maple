import { Elysia, t } from 'elysia';
import { authMiddleware, checkAuth } from '../middleware/auth';
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
    createProvisioningToken,
    revokeAllTokens,
    findTokensByUserBotId,
} from '../repositories/bot-provisioning-token.repo';
import { findActiveSessionsByBotId, revokeAllSessions } from '../repositories/bot-session.repo';
import { CreateCustomBotSchema, UpdateCustomBotSchema } from '@maple/shared';

/**
 * Custom Bot Management Routes
 *
 * User-facing routes for creating and managing custom bots.
 * These require user authentication (not bot auth).
 */
export const customBotRoutes = new Elysia({ prefix: '/api/custom-bots' })
    .use(authMiddleware)

    // List user's custom bots
    .get('/', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized' };
        }

        const bots = await findCustomBotsByUserId(auth.user._id);

        // Enrich with session counts
        const botsWithStats = await Promise.all(
            bots.map(async (bot) => {
                const sessions = await findActiveSessionsByBotId(bot._id);
                return {
                    ...bot,
                    activeSessionCount: sessions.length,
                };
            }),
        );

        return { bots: botsWithStats };
    })

    // Create a custom bot
    .post(
        '/',
        async ({ auth, set, body }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

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

            // Create a provisioning token
            const { plaintextToken } = await createProvisioningToken(bot._id, auth.user._id);

            return {
                bot,
                provisioning_token: plaintextToken,
                webhook_secret: webhookSecret,
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

            // Get session stats
            const sessions = await findActiveSessionsByBotId(bot._id);
            const tokens = await findTokensByUserBotId(bot._id);

            return {
                bot,
                activeSessionCount: sessions.length,
                tokenCount: tokens.filter((t) => !t.revoked).length,
            };
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

            const bot = await updateCustomBot(params.id, auth.user._id, body);

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
        async ({ auth, set, params }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            // Revoke all tokens and sessions first
            await revokeAllTokens(params.id);
            await revokeAllSessions(params.id);

            const deleted = await deleteCustomBot(params.id, auth.user._id);

            if (!deleted) {
                set.status = 404;
                return {
                    error: 'resource/not_found',
                    message: 'Bot not found or not a custom bot',
                };
            }

            return { message: 'Bot deleted successfully' };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Regenerate provisioning token
    .post(
        '/:id/regenerate-token',
        async ({ auth, set, params }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            // Verify ownership
            const bot = await findUserBotById(params.id);

            if (!bot || bot.userId !== auth.user._id || bot.botType !== 'custom') {
                set.status = 404;
                return {
                    error: 'resource/not_found',
                    message: 'Bot not found',
                };
            }

            // Revoke all existing tokens
            await revokeAllTokens(params.id);

            // Create new token
            const { plaintextToken } = await createProvisioningToken(params.id, auth.user._id);

            return {
                provisioning_token: plaintextToken,
                message: 'New provisioning token generated. All previous tokens are now invalid.',
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
        async ({ auth, set, params }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            const webhookSecret = await regenerateWebhookSecret(params.id, auth.user._id);

            if (!webhookSecret) {
                set.status = 404;
                return {
                    error: 'resource/not_found',
                    message: 'Bot not found or not a custom bot',
                };
            }

            return {
                webhook_secret: webhookSecret,
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
        async ({ auth, set, params, body }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            const updated = await updateBotStatus(params.id, auth.user._id, body.status);

            if (!updated) {
                set.status = 404;
                return {
                    error: 'resource/not_found',
                    message: 'Bot not found or not a custom bot',
                };
            }

            // If disabling or revoking, revoke all sessions
            if (body.status !== 'active') {
                await revokeAllSessions(params.id);
            }

            return { message: `Bot status updated to ${body.status}` };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                status: t.Union([t.Literal('active'), t.Literal('disabled'), t.Literal('revoked')]),
            }),
        },
    )

    // List active sessions for a bot
    .get(
        '/:id/sessions',
        async ({ auth, set, params }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            // Verify ownership
            const bot = await findUserBotById(params.id);

            if (!bot || bot.userId !== auth.user._id || bot.botType !== 'custom') {
                set.status = 404;
                return {
                    error: 'resource/not_found',
                    message: 'Bot not found',
                };
            }

            const sessions = await findActiveSessionsByBotId(params.id);

            return {
                sessions: sessions.map((s) => ({
                    _id: s._id,
                    created_at: s.createdAt,
                    expires_at: s.expiresAt,
                    last_used_at: s.lastUsedAt,
                    ip_address: s.ipAddress,
                })),
            };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Revoke all sessions for a bot
    .delete(
        '/:id/sessions',
        async ({ auth, set, params }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            // Verify ownership
            const bot = await findUserBotById(params.id);

            if (!bot || bot.userId !== auth.user._id || bot.botType !== 'custom') {
                set.status = 404;
                return {
                    error: 'resource/not_found',
                    message: 'Bot not found',
                };
            }

            const count = await revokeAllSessions(params.id);

            return { message: `${count} session(s) revoked` };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    );
