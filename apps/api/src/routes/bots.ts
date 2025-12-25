import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import { findTagById, findTagByIdWithAccess } from '../repositories/tag.repo';
import type { JWTPayload, ChatEvent } from '@maple/shared';
import {
    findAllBotTemplates,
    findBotTemplateById,
    findBotTemplatesByIds,
    searchBotTemplates,
} from '../repositories/bot-template.repo';
import {
    findUserBotsByUserId,
    findUserBotById,
    findUserBotByHandle,
    findUserBotByHandleForTag,
    createUserBot,
    updateUserBot,
    deleteUserBot,
    searchUserBots,
} from '../repositories/user-bot.repo';
import { findThreadByParentMessage, findThreadById } from '../repositories/thread.repo';
import { findMessagesByThreadId } from '../repositories/message.repo';
import { findInvocationById } from '../repositories/bot-invocation.repo';
import { botExecutor } from '../services/bot-executor.service';
import { extractTextFromContent } from '../utils/content-utils';

export const botRoutes = new Elysia({ prefix: '/api' })
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

    // ============================================
    // Bot Templates (System-defined bots)
    // ============================================

    // List all available bot templates
    .get('/bot-templates', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized' };
        }

        const templates = await findAllBotTemplates();
        return { templates };
    })

    // Get a specific bot template
    .get(
        '/bot-templates/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            const template = await findBotTemplateById(params.id);
            if (!template) {
                set.status = 404;
                return { error: 'Bot template not found' };
            }

            return { template };
        },
        { params: t.Object({ id: t.String() }) },
    )

    // Search bot templates
    .get(
        '/bot-templates/search',
        async ({ auth, query, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            const templates = await searchBotTemplates(query.q || '');
            return { templates };
        },
        { query: t.Object({ q: t.Optional(t.String({ maxLength: 100 })) }) },
    )

    // ============================================
    // User Bots (User-registered bots)
    // ============================================

    // List user's registered bots
    .get('/user-bots', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized' };
        }

        const userBots = await findUserBotsByUserId(auth.user._id);

        // Batch load all templates in a single query (fix N+1)
        const templateIds = [...new Set(userBots.map((b) => b.templateId))];
        const templates = await findBotTemplatesByIds(templateIds);
        const templateMap = new Map(templates.map((t) => [t._id, t]));

        // Enrich with template info
        const enrichedBots = userBots.map((userBot) => {
            const template = templateMap.get(userBot.templateId);
            return {
                ...userBot,
                templateName: template?.name,
                templateAvatar: template?.avatar,
                templateDescription: template?.description,
            };
        });

        return { userBots: enrichedBots };
    })

    // Register a new bot
    .post(
        '/user-bots',
        async ({ auth, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            // Validate template exists
            const template = await findBotTemplateById(body.templateId);
            if (!template) {
                set.status = 400;
                return { error: 'Invalid bot template' };
            }

            // Check if template requires config
            if (template.requiresConfig && !body.config?.apiKey) {
                set.status = 400;
                return { error: 'This bot requires an API key' };
            }

            // Check handle uniqueness for this user
            const handle = (body.handle || template.handle).toLowerCase();
            const existing = await findUserBotByHandle(auth.user._id, handle);
            if (existing) {
                set.status = 400;
                return { error: `You already have a bot with handle @${handle}` };
            }

            // Validate tag access if specified
            if (body.tagId) {
                const tag = await findTagByIdWithAccess(body.tagId, auth.user._id, 'write');
                if (!tag) {
                    set.status = 400;
                    return { error: 'Invalid tag or no access' };
                }
            }

            const userBot = await createUserBot(auth.user._id, body, template.handle);

            return {
                userBot: {
                    ...userBot,
                    templateName: template.name,
                    templateAvatar: template.avatar,
                },
            };
        },
        {
            body: t.Object({
                templateId: t.String(),
                handle: t.Optional(t.String()),
                displayName: t.Optional(t.String()),
                config: t.Optional(
                    t.Object({
                        apiKey: t.Optional(t.String()),
                        customSettings: t.Optional(t.Record(t.String(), t.Any())),
                    }),
                ),
                tagId: t.Optional(t.String()),
            }),
        },
    )

    // Update a user bot
    .patch(
        '/user-bots/:id',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            const userBot = await updateUserBot(params.id, auth.user._id, body);
            if (!userBot) {
                set.status = 404;
                return { error: 'Bot not found' };
            }

            return { userBot };
        },
        {
            params: t.Object({ id: t.String() }),
            body: t.Object({
                displayName: t.Optional(t.String()),
                config: t.Optional(
                    t.Object({
                        apiKey: t.Optional(t.String()),
                        customSettings: t.Optional(t.Record(t.String(), t.Any())),
                    }),
                ),
                isEnabled: t.Optional(t.Boolean()),
                tagId: t.Optional(t.String()),
            }),
        },
    )

    // Delete a user bot
    .delete(
        '/user-bots/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            const deleted = await deleteUserBot(params.id, auth.user._id);
            if (!deleted) {
                set.status = 404;
                return { error: 'Bot not found' };
            }

            return { message: 'Bot deleted' };
        },
        { params: t.Object({ id: t.String() }) },
    )

    // ============================================
    // Bot Invocation (Triggering bots)
    // ============================================

    // Search bots available in a tag (for @mention autocomplete)
    .get(
        '/tags/:tagId/bots/search',
        async ({ auth, params, query, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            const tag = await findTagById(params.tagId, auth.user._id);
            if (!tag) {
                set.status = 404;
                return { error: 'Tag not found' };
            }

            const userBots = await searchUserBots(auth.user._id, params.tagId, query.q || '', 10);

            // Batch load all templates in a single query (fix N+1)
            const templateIds = [...new Set(userBots.map((b) => b.templateId))];
            const templates = await findBotTemplatesByIds(templateIds);
            const templateMap = new Map(templates.map((t) => [t._id, t]));

            // Enrich with template info
            const enrichedBots = userBots.map((userBot) => {
                const template = templateMap.get(userBot.templateId);
                return {
                    id: userBot._id,
                    handle: userBot.handle,
                    displayName: userBot.displayName || template?.name || userBot.handle,
                    avatar: template?.avatar,
                    description: template?.description,
                    type: 'bot' as const,
                };
            });

            return { bots: enrichedBots };
        },
        {
            params: t.Object({ tagId: t.String() }),
            query: t.Object({ q: t.Optional(t.String({ maxLength: 100 })) }),
        },
    )

    // Invoke a bot (trigger via @mention)
    .post(
        '/tags/:tagId/bots/invoke',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            // Verify tag access - bot invocation requires write access
            const tag = await findTagByIdWithAccess(params.tagId, auth.user._id, 'write');
            if (!tag) {
                set.status = 404;
                return { error: 'Tag not found or access denied' };
            }

            // Find the bot by handle
            const userBot = await findUserBotByHandleForTag(body.botHandle, params.tagId);
            if (!userBot) {
                set.status = 404;
                return { error: `Bot @${body.botHandle} not found` };
            }

            // Invoke the bot
            try {
                const invocation = await botExecutor.invoke({
                    userBotId: userBot._id,
                    sourceType: body.sourceType,
                    sourceId: body.sourceId,
                    tagId: params.tagId,
                    userId: auth.user._id,
                    context: body.context,
                });

                return { invocation };
            } catch (error) {
                set.status = 500;
                return {
                    error: 'Bot invocation failed',
                    message: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
        {
            params: t.Object({ tagId: t.String() }),
            body: t.Object({
                botHandle: t.String(),
                sourceType: t.Union([t.Literal('message'), t.Literal('note')]),
                sourceId: t.String(),
                context: t.Object({
                    mentionText: t.Optional(t.String()),
                    fullContent: t.Optional(t.String()),
                    documentTitle: t.Optional(t.String()),
                    selection: t.Optional(t.String()),
                }),
            }),
        },
    )

    // Get invocation status
    .get(
        '/invocations/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            const invocation = await findInvocationById(params.id);
            if (!invocation) {
                set.status = 404;
                return { error: 'Invocation not found' };
            }

            // Verify user has access to the tag
            const tag = await findTagById(invocation.tagId, auth.user._id);
            if (!tag) {
                set.status = 403;
                return { error: 'Access denied' };
            }

            return { invocation };
        },
        { params: t.Object({ id: t.String() }) },
    )

    // ============================================
    // Threads
    // ============================================

    // Get thread for a message
    .get(
        '/messages/:messageId/thread',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            const thread = await findThreadByParentMessage(params.messageId);
            if (!thread) {
                set.status = 404;
                return { error: 'Thread not found' };
            }

            // Verify thread has valid tagId
            if (!thread.tagId) {
                set.status = 500;
                return { error: 'Invalid thread data' };
            }

            // Verify access
            const tag = await findTagById(thread.tagId, auth.user._id);
            if (!tag) {
                set.status = 403;
                return { error: 'Access denied' };
            }

            // Get messages in thread
            const messages = await findMessagesByThreadId(thread._id);

            return { thread, messages };
        },
        { params: t.Object({ messageId: t.String() }) },
    )

    // Get messages in a thread
    .get(
        '/threads/:id/messages',
        async ({ auth, params, query, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            const thread = await findThreadById(params.id);
            if (!thread) {
                set.status = 404;
                return { error: 'Thread not found' };
            }

            // Verify thread has valid tagId
            if (!thread.tagId) {
                set.status = 500;
                return { error: 'Invalid thread data' };
            }

            // Verify access
            const tag = await findTagById(thread.tagId, auth.user._id);
            if (!tag) {
                set.status = 403;
                return { error: 'Access denied' };
            }

            const messages = await findMessagesByThreadId(params.id, {
                limit: query.limit ? parseInt(query.limit) : 50,
                before: query.before,
            });

            return { messages };
        },
        {
            params: t.Object({ id: t.String() }),
            query: t.Object({
                limit: t.Optional(t.String()),
                before: t.Optional(t.String()),
            }),
        },
    );
