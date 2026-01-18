import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import { findNotebookById, findNotebookByIdWithAccess } from '../repositories/notebook.repo';
import type { JWTPayload, ChatEvent } from '@maple/shared';
import {
    findAllBotTemplates,
    findBotTemplateById,
    findBotTemplatesByIds,
} from '../repositories/bot-template.repo';
import {
    findUserBotsByUserId,
    findUserBotById,
    findUserBotByHandle,
    findUserBotByHandleForTag,
    createUserBot,
    updateUserBot,
    deleteUserBot,
    findUserBotsForTag,
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
                        isOAuthToken: t.Optional(t.Boolean()),
                        customSettings: t.Optional(t.Record(t.String(), t.Any())),
                    }),
                ),
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
                        isOAuthToken: t.Optional(t.Boolean()),
                        customSettings: t.Optional(t.Record(t.String(), t.Any())),
                    }),
                ),
                isEnabled: t.Optional(t.Boolean()),
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

    // Get all bots available in a notebook (for @mention autocomplete)
    .get(
        '/notebooks/:id/bots',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            const notebook = await findNotebookById(params.id, auth.user._id);
            if (!notebook) {
                set.status = 404;
                return { error: 'Notebook not found' };
            }

            const enrichedBots = await findUserBotsForTag(params.id);

            // Map to BotSuggestion format with owner info
            const suggestions = enrichedBots.map((bot: any) => ({
                id: bot._id,
                handle: bot.handle,
                displayName: bot.displayName || bot.templateName || bot.handle,
                avatar: bot.templateAvatar,
                description: bot.templateDescription,
                type: 'bot' as const,
                ownerId: bot.userId,
                ownerName: bot.ownerName,
                ownerAvatar: bot.ownerAvatar,
            }));

            return { bots: suggestions };
        },
        { params: t.Object({ id: t.String() }) },
    )

    // Invoke a bot (trigger via @mention)
    .post(
        '/notebooks/:id/bots/invoke',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            // Verify notebook access - bot invocation requires write access
            const notebook = await findNotebookByIdWithAccess(params.id, auth.user._id, 'write');
            if (!notebook) {
                set.status = 404;
                return { error: 'Notebook not found or access denied' };
            }

            // Find the bot by handle
            const userBot = await findUserBotByHandleForTag(body.botHandle, params.id);
            if (!userBot) {
                set.status = 404;
                return { error: `Bot @${body.botHandle} not found` };
            }

            // Build context with conversation history if this is a thread
            const context: any = { ...body.context };

            // If source is a message, check if it has a thread and fetch thread history
            if (body.sourceType === 'message') {
                const { findMessageById } = await import('../repositories/message.repo');
                const { findThreadByParentMessage } = await import('../repositories/thread.repo');
                const { findMessagesByThreadId } = await import('../repositories/message.repo');

                const sourceMessage = await findMessageById(body.sourceId);

                // Check if this message has a thread
                if (sourceMessage?.hasThread) {
                    const thread = await findThreadByParentMessage(body.sourceId);
                    if (thread) {
                        // Fetch all messages in the thread for context
                        const threadMessages = await findMessagesByThreadId(thread._id);
                        context.previousMessages = threadMessages;
                    }
                }
            }

            // Invoke the bot
            try {
                const invocation = await botExecutor.invoke({
                    userBotId: userBot._id,
                    sourceType: body.sourceType,
                    sourceId: body.sourceId,
                    tagId: params.id,
                    userId: auth.user._id,
                    context,
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
            params: t.Object({ id: t.String() }),
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
            const tag = await findNotebookById(invocation.tagId, auth.user._id);
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
            const tag = await findNotebookById(thread.tagId, auth.user._id);
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

    // Get thread details by ID
    .get(
        '/threads/:id',
        async ({ auth, params, set }) => {
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
            const tag = await findNotebookById(thread.tagId, auth.user._id);
            if (!tag) {
                set.status = 403;
                return { error: 'Access denied' };
            }

            return { thread };
        },
        { params: t.Object({ id: t.String() }) },
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
            const tag = await findNotebookById(thread.tagId, auth.user._id);
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
