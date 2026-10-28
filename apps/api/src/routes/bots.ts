import { listBotModels, BotModelsError } from '../services/bot-models.service';
import { isBotModel, type BotConfig, type BotProvider, type BotTemplate } from '@maple/shared';
import { resolveEndpoint } from '../utils/url-safety';
import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import { findNotebookById, findNotebookByIdWithAccess } from '../repositories/notebook.repo';
import type { JWTPayload } from '@maple/shared';
import {
    findAllBotTemplates,
    findBotTemplateById,
    findBotTemplatesByIds,
} from '../repositories/bot-template.repo';
import {
    findUserBotsByUserId,
    findUserBotById,
    findUserBotByIdInternal,
    findUserBotByHandle,
    findUserBotByHandleForNotebook,
    createUserBot,
    updateUserBot,
    deleteUserBot,
    findUserBotsForNotebook,
} from '../repositories/user-bot.repo';
import { findThreadByParentMessage, findThreadById } from '../repositories/thread.repo';
import { findMessagesByThreadId } from '../repositories/message.repo';
import { findInvocationById } from '../repositories/bot-invocation.repo';
import {
    createBotToken,
    findTokensByUserBotId,
    deleteToken,
    type CreateBotTokenInput,
} from '../repositories/bot-token.repo';
import { botExecutor } from '../services/bot-executor.service';
import { isWebSearchAvailable } from '../services/web-search.service';

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

        // The web search switch only shows when the server has a search key.
        return { userBots: enrichedBots, webSearchAvailable: isWebSearchAvailable() };
    })

    // Load available models for a draft or an owned bot. Saved keys stay on the server.
    .post(
        '/bot-models',
        async ({ auth, body, set }) => {
            if (!checkAuth(auth, set)) return { error: 'Unauthorized' };
            const bot = body.userBotId ? await findUserBotByIdInternal(body.userBotId) : null;
            if (body.userBotId && (!bot || bot.userId !== auth.user._id)) {
                set.status = 404;
                return { error: 'Bot not found' };
            }
            const templateId = bot?.templateId || body.templateId;
            const template = templateId ? await findBotTemplateById(templateId) : null;
            const action = template?.definition.actions.find((action) => action.type === 'llm');
            const provider = String(action?.config.provider || 'anthropic');
            if (!action || !['anthropic', 'openai', 'openai-compatible'].includes(provider)) {
                set.status = 400;
                return { error: 'Model discovery is not available for this bot' };
            }
            const apiKey = body.apiKey?.trim() || bot?.config?.apiKey || '';
            if ((!apiKey && provider !== 'openai-compatible') || apiKey === '***REDACTED***') {
                set.status = 400;
                return { error: 'Enter an API key to load available models' };
            }
            let baseUrl: string | undefined;
            if (provider === 'openai-compatible') {
                const draftUrl = body.baseUrl?.trim();
                // A saved key only goes to the saved server, never to a URL typed in a draft.
                if (draftUrl && !body.apiKey?.trim() && bot?.config?.apiKey) {
                    set.status = 400;
                    return { error: 'Enter the API key again to use a different server' };
                }
                try {
                    baseUrl = await resolveEndpoint(draftUrl || bot?.config?.baseUrl || '');
                } catch (error) {
                    set.status = 400;
                    return { error: (error as Error).message };
                }
            }
            try {
                return {
                    models: await listBotModels(
                        provider as BotProvider,
                        apiKey,
                        body.apiKey?.trim() ? false : bot?.config?.isOAuthToken,
                        baseUrl,
                    ),
                };
            } catch (error) {
                set.status = error instanceof BotModelsError ? error.status : 502;
                return {
                    error:
                        error instanceof BotModelsError
                            ? error.message
                            : 'Could not load provider models',
                };
            }
        },
        {
            body: t.Object({
                userBotId: t.Optional(t.String()),
                templateId: t.Optional(t.String()),
                apiKey: t.Optional(t.String({ maxLength: 8192 })),
                baseUrl: t.Optional(t.String({ maxLength: 2048 })),
            }),
        },
    )

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
            // Custom servers may not need a key (an open endpoint); every other AI bot does.
            if (template.requiresConfig && !body.config?.apiKey && !usesCustomServer(template)) {
                set.status = 400;
                return { error: 'This bot requires an API key' };
            }

            const endpointError = await checkEndpointConfig(template, body.config);
            if (endpointError) {
                set.status = 400;
                return { error: endpointError };
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
                        model: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
                        responseMode: t.Optional(t.Union([t.Literal('auto'), t.Literal('text')])),
                        apiKey: t.Optional(t.String()),
                        isOAuthToken: t.Optional(t.Boolean()),
                        baseUrl: t.Optional(t.String({ maxLength: 2048 })),
                        webSearch: t.Optional(t.Boolean()),
                        webSearchProactive: t.Optional(t.Boolean()),
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

            if (body.config?.baseUrl !== undefined) {
                const existing = await findUserBotByIdInternal(params.id);
                if (!existing || existing.userId !== auth.user._id) {
                    set.status = 404;
                    return { error: 'Bot not found' };
                }
                const template = existing.templateId
                    ? await findBotTemplateById(existing.templateId)
                    : null;
                const merged = { ...existing.config, ...body.config };
                const endpointError = template
                    ? await checkEndpointConfig(template, merged)
                    : 'Invalid bot template';
                if (endpointError) {
                    set.status = 400;
                    return { error: endpointError };
                }
                if (!template || !usesCustomServer(template)) {
                    // Not a custom-server bot: there is no URL to save.
                    delete body.config.baseUrl;
                } else {
                    // A saved key only goes to the saved server.
                    if (
                        merged.baseUrl !== existing.config?.baseUrl &&
                        existing.config?.apiKey &&
                        !body.config.apiKey?.trim()
                    ) {
                        set.status = 400;
                        return { error: 'Enter the API key again to use a different server' };
                    }
                    body.config.baseUrl = merged.baseUrl;
                }
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
                        model: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
                        responseMode: t.Optional(t.Union([t.Literal('auto'), t.Literal('text')])),
                        apiKey: t.Optional(t.String()),
                        isOAuthToken: t.Optional(t.Boolean()),
                        baseUrl: t.Optional(t.String({ maxLength: 2048 })),
                        webSearch: t.Optional(t.Boolean()),
                        webSearchProactive: t.Optional(t.Boolean()),
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

            const enrichedBots = await findUserBotsForNotebook(params.id);

            // Map to BotSuggestion format with owner info
            const suggestions = await Promise.all(
                enrichedBots.map(async (bot: any) => {
                    const template = bot.templateId
                        ? await findBotTemplateById(bot.templateId)
                        : null;
                    const llm = template?.definition.actions.find((a) => a.type === 'llm');
                    const provider = llm
                        ? (String(llm.config.provider || 'anthropic') as BotProvider)
                        : undefined;
                    return {
                        id: bot._id,
                        handle: bot.handle,
                        displayName: bot.displayName || bot.templateName || bot.handle,
                        avatar: bot.templateAvatar,
                        description: bot.templateDescription,
                        type: 'bot' as const,
                        provider,
                        defaultModel: bot.config?.model || llm?.config.model,
                        ownerId: bot.userId,
                        ownerName: bot.ownerName,
                        ownerAvatar: bot.ownerAvatar,
                    };
                }),
            );

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
            console.log(`[BotInvoke] Looking for bot @${body.botHandle} in notebook ${params.id}`);
            const userBot = await findUserBotByHandleForNotebook(body.botHandle, params.id);
            if (!userBot) {
                console.log(`[BotInvoke] Bot @${body.botHandle} not found in notebook`);
                set.status = 404;
                return { error: `Bot @${body.botHandle} not found` };
            }
            console.log(`[BotInvoke] Found bot: ${userBot._id}, type: ${userBot.botType}`);

            const template = userBot.templateId
                ? await findBotTemplateById(userBot.templateId)
                : null;
            const llm = template?.definition.actions.find((a) => a.type === 'llm');
            if (
                body.context.model &&
                (!llm ||
                    !isBotModel(body.context.model, String(llm.config.provider || 'anthropic')))
            ) {
                set.status = 400;
                return { error: 'The selected model does not match this bot provider' };
            }
            // Build context with conversation history if this is a thread
            const context: any = { ...body.context };

            // If source is a message, check if it has a thread and fetch thread history
            if (body.sourceType === 'message') {
                const { findMessageById } = await import('../repositories/message.repo');
                const { findThreadByParentMessage } = await import('../repositories/thread.repo');
                const { findMessagesByThreadId } = await import('../repositories/message.repo');

                const sourceMessage = await findMessageById(body.sourceId, auth.user._id);
                const { findPageById } = await import('../repositories/page.repo');
                const sourcePage = sourceMessage
                    ? await findPageById(sourceMessage.pageId, auth.user._id)
                    : null;
                if (!sourceMessage || sourcePage?.notebookId !== params.id) {
                    set.status = 404;
                    return { error: 'Source message not found in this notebook' };
                }
                context.pageId = sourceMessage.pageId;

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
                    notebookId: params.id,
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
                    model: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
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
            const tag = await findNotebookById(invocation.notebookId, auth.user._id);
            if (!tag) {
                set.status = 403;
                return { error: 'Access denied' };
            }

            // The run's variables (the model's raw output, tool results) are only for the
            // person who started it; other members get the status and the posted reply.
            if (invocation.userId !== auth.user._id) {
                const { variables: _variables, ...rest } = invocation;
                return { invocation: rest };
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

            // Verify thread has valid notebookId
            if (!thread.notebookId) {
                set.status = 500;
                return { error: 'Invalid thread data' };
            }

            // Verify access
            const tag = await findNotebookById(thread.notebookId, auth.user._id);
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

            // Verify thread has valid notebookId
            if (!thread.notebookId) {
                set.status = 500;
                return { error: 'Invalid thread data' };
            }

            // Verify access
            const tag = await findNotebookById(thread.notebookId, auth.user._id);
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

            // Verify thread has valid notebookId
            if (!thread.notebookId) {
                set.status = 500;
                return { error: 'Invalid thread data' };
            }

            // Verify access
            const tag = await findNotebookById(thread.notebookId, auth.user._id);
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
    )

    // ============================================
    // AI Document Editing
    // ============================================

    // AI edit endpoint for the AI Bot Widget
    .post(
        '/notebooks/:id/ai-edit',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            // Verify notebook access
            const notebook = await findNotebookByIdWithAccess(params.id, auth.user._id, 'write');
            if (!notebook) {
                set.status = 404;
                return { error: 'Notebook not found or access denied' };
            }

            try {
                const { aiEditService } = await import('../services/ai-edit.service');
                const result = await aiEditService.processEditRequest(params.id, body);
                return result;
            } catch (error) {
                set.status = 500;
                return {
                    error: 'AI edit failed',
                    message: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
        {
            params: t.Object({ id: t.String() }),
            body: t.Object({
                prompt: t.String(),
                pageId: t.String(), // Page ID for server-side edit application
                context: t.Object({
                    widgetPosition: t.Number(),
                }),
            }),
        },
    )

    // ============================================
    // Bot Access Tokens (for external services)
    // ============================================

    // Create a new access token for a user bot
    .post(
        '/user-bots/:id/tokens',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            // Verify user owns this bot
            const userBot = await findUserBotById(params.id);
            if (!userBot || userBot.userId !== auth.user._id) {
                set.status = 404;
                return { error: 'Bot not found' };
            }

            try {
                const input: CreateBotTokenInput = {
                    userBotId: params.id,
                    userId: auth.user._id,
                    name: body.name,
                    permissions: body.permissions,
                    notebookScope: body.notebookScope,
                    expiresAt: body.expiresInDays
                        ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
                        : undefined,
                };

                const result = await createBotToken(input);

                // Return the token - plaintext is only available now!
                return {
                    token: result.token,
                    plaintextToken: result.plaintextToken,
                    message: 'Save this token securely. It will not be shown again.',
                };
            } catch (error) {
                set.status = 500;
                return {
                    error: 'Failed to create token',
                    message: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
        {
            params: t.Object({ id: t.String() }),
            body: t.Object({
                name: t.String({ minLength: 1, maxLength: 100 }),
                permissions: t.Array(
                    t.Union([t.Literal('read'), t.Literal('write'), t.Literal('invoke')]),
                    { minItems: 1 },
                ),
                notebookScope: t.Optional(t.Array(t.String())),
                expiresInDays: t.Optional(t.Number({ minimum: 1, maximum: 365 })),
            }),
        },
    )

    // List all tokens for a user bot (names only, no secrets)
    .get(
        '/user-bots/:id/tokens',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            // Verify user owns this bot
            const userBot = await findUserBotById(params.id);
            if (!userBot || userBot.userId !== auth.user._id) {
                set.status = 404;
                return { error: 'Bot not found' };
            }

            const tokens = await findTokensByUserBotId(params.id);
            return { tokens };
        },
        { params: t.Object({ id: t.String() }) },
    )

    // Revoke (delete) an access token
    .delete(
        '/user-bots/:id/tokens/:tokenId',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized' };
            }

            // Verify user owns this bot
            const userBot = await findUserBotById(params.id);
            if (!userBot || userBot.userId !== auth.user._id) {
                set.status = 404;
                return { error: 'Bot not found' };
            }

            const deleted = await deleteToken(params.tokenId, auth.user._id);
            if (!deleted) {
                set.status = 404;
                return { error: 'Token not found' };
            }

            return { message: 'Token revoked' };
        },
        {
            params: t.Object({
                id: t.String(),
                tokenId: t.String(),
            }),
        },
    );

/**
 * OpenAI-compatible bots need a public https server URL; it is stored normalized.
 * Returns an error message, or null when the config is fine.
 */
async function checkEndpointConfig(
    template: BotTemplate,
    config: Partial<BotConfig> | undefined,
): Promise<string | null> {
    if (!usesCustomServer(template)) return null;
    if (!config?.baseUrl?.trim()) return 'Enter the server URL for this bot';
    try {
        config.baseUrl = await resolveEndpoint(config.baseUrl);
    } catch (error) {
        return (error as Error).message;
    }
    if (config.model && !isBotModel(config.model, 'openai-compatible'))
        return 'That model name has characters that are not allowed';
    return null;
}

function usesCustomServer(template: BotTemplate): boolean {
    const llm = template.definition.actions.find((action) => action.type === 'llm');
    return llm?.config.provider === 'openai-compatible';
}
