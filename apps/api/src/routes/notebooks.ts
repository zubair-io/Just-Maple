import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import type { JWTPayload } from '@maple/shared';

/**
 * Sanitize a name/label string by trimming whitespace and removing newlines
 */
function sanitizeName(name: string): string {
    return name.replace(/[\r\n]/g, ' ').trim();
}
import {
    findNotebooksByUserId,
    findNotebookById,
    createNotebook,
    updateNotebook,
    deleteNotebook,
    shareNotebook,
    unshareNotebook,
    updateNotebookPublicStatus,
    updateNotebookPublicConfig,
    getNotebookMembers,
    getNotebookMembersWithUserData,
    getAccessLevel,
    shareBotToNotebook,
    unshareBotFromNotebook,
} from '../repositories/notebook.repo';
import { findUserBotsForNotebook, findUserBotByIdInternal } from '../repositories/user-bot.repo';
import { sendNotification } from '../services/notification.service';
import { findBotTemplateById } from '../repositories/bot-template.repo';

export const notebookRoutes = new Elysia({ prefix: '/api/notebooks' })
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

    // Get all notebooks for the current user
    .get('/', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized', message: 'Valid authentication required' };
        }
        const notebooks = await findNotebooksByUserId(auth.user._id);
        return { notebooks };
    })

    // Get a single notebook by ID
    .get(
        '/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const notebook = await findNotebookById(params.id, auth.user._id);

            if (!notebook) {
                set.status = 404;
                return { error: 'Notebook not found' };
            }

            return { notebook };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Create a new notebook
    .post(
        '/',
        async ({ auth, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const sanitizedBody = {
                ...body,
                label: sanitizeName(body.label),
            };
            const notebook = await createNotebook(auth.user._id, sanitizedBody);
            return { notebook };
        },
        {
            body: t.Object({
                label: t.String({ minLength: 1, maxLength: 255 }),
                value: t.Optional(
                    t.Union([t.Literal('mixed'), t.Literal('recordings'), t.Literal('notes')]),
                ),
            }),
        },
    )

    // Update a notebook
    .put(
        '/:id',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const sanitizedBody = {
                ...body,
                label: body.label ? sanitizeName(body.label) : undefined,
            };
            const notebook = await updateNotebook(params.id, auth.user._id, sanitizedBody);

            if (!notebook) {
                set.status = 404;
                return { error: 'Notebook not found' };
            }

            return { notebook };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                label: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
                value: t.Optional(
                    t.Union([t.Literal('mixed'), t.Literal('recordings'), t.Literal('notes')]),
                ),
            }),
        },
    )

    // Delete a notebook
    .delete(
        '/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }
            const deleted = await deleteNotebook(params.id, auth.user._id);

            if (!deleted) {
                set.status = 404;
                return { error: 'Notebook not found' };
            }

            return { message: 'Notebook deleted successfully' };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Get notebook members (users with access) including full user data
    .get(
        '/:id/members',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const members = await getNotebookMembersWithUserData(params.id, auth.user._id);
            if (!members) {
                set.status = 404;
                return { error: 'Notebook not found' };
            }

            return { members };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Share notebook with user (by account ID)
    .post(
        '/:id/share',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            // Find user by account ID
            const targetUser = await findUserById(body.userId);
            if (!targetUser) {
                set.status = 404;
                return { error: 'User not found', message: 'No user with that account ID exists' };
            }

            const notebook = await shareNotebook(params.id, auth.user._id, {
                userId: targetUser._id,
                accessLevel: body.accessLevel,
            });

            if (!notebook) {
                set.status = 403;
                return {
                    error: 'Forbidden',
                    message: 'You do not have permission to share this notebook',
                };
            }

            // Send notification to the user who received the share
            try {
                await sendNotification(targetUser._id, 'share_received', {
                    notebookId: params.id,
                    sharedBy: auth.user._id,
                    notebookLabel: notebook.label,
                });
            } catch (error) {
                console.error('[Notebooks] Failed to send share notification:', error);
                // Don't fail the request if notification fails
            }

            return { notebook };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                userId: t.String({ pattern: '^[a-fA-F0-9]{24}$' }),
                accessLevel: t.Union([t.Literal('read'), t.Literal('write')]),
            }),
        },
    )

    // Remove user's access to notebook
    .delete(
        '/:id/share/:userId',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const notebook = await unshareNotebook(params.id, auth.user._id, params.userId);

            if (!notebook) {
                set.status = 403;
                return {
                    error: 'Forbidden',
                    message: 'You do not have permission to unshare this notebook',
                };
            }

            return { notebook };
        },
        {
            params: t.Object({
                id: t.String(),
                userId: t.String(),
            }),
        },
    )

    // Update notebook's public status
    .put(
        '/:id/public',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const notebook = await updateNotebookPublicStatus(
                params.id,
                auth.user._id,
                body.isPublic,
            );

            if (!notebook) {
                set.status = 403;
                return {
                    error: 'Forbidden',
                    message: 'You do not have permission to change public status',
                };
            }

            return { notebook };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                isPublic: t.Boolean(),
            }),
        },
    )

    // Update notebook's public configuration (slug, displayName, etc.)
    .patch(
        '/:id/public',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const notebook = await updateNotebookPublicConfig(params.id, auth.user._id, body);

            if (!notebook) {
                set.status = 403;
                return {
                    error: 'Forbidden',
                    message: 'Could not update public configuration.',
                };
            }

            // If notebook was just made public, bulk-publish existing pages
            if (body.isPublic === true) {
                const { bulkPublishPagesForNotebook } = await import('../repositories/page.repo');
                await bulkPublishPagesForNotebook(params.id);
            }

            return { notebook };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                isPublic: t.Optional(t.Boolean()),
                publicConfig: t.Optional(
                    t.Object({
                        displayName: t.Optional(t.String()),
                        description: t.Optional(t.String()),
                        faviconUrl: t.Optional(t.String()),
                        logoUrl: t.Optional(t.String()),
                        landingPageId: t.Optional(t.String()),
                        showPageList: t.Optional(t.Boolean()),
                    }),
                ),
            }),
        },
    )

    // Get current user's access level for a notebook
    .get(
        '/:id/access',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const notebook = await findNotebookById(params.id, auth.user._id);
            if (!notebook) {
                set.status = 404;
                return { error: 'Notebook not found' };
            }

            const accessLevel = getAccessLevel(notebook, auth.user._id);

            return { accessLevel };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Get bots shared with this notebook
    .get(
        '/:id/shared-bots',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const notebook = await findNotebookById(params.id, auth.user._id);
            if (!notebook) {
                set.status = 404;
                return { error: 'Notebook not found' };
            }

            const enrichedBots = await findUserBotsForNotebook(params.id);
            return { bots: enrichedBots };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Share bot with notebook
    .post(
        '/:id/bots',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const updatedNotebook = await shareBotToNotebook(
                params.id,
                auth.user._id,
                body.userBotId,
            );

            if (!updatedNotebook) {
                set.status = 400;
                return { error: 'Failed to share bot' };
            }

            return { notebook: updatedNotebook };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                userBotId: t.String(),
            }),
        },
    )

    // Remove bot from notebook
    .delete(
        '/:id/bots/:userBotId',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const updatedNotebook = await unshareBotFromNotebook(
                params.id,
                auth.user._id,
                params.userBotId,
            );

            if (!updatedNotebook) {
                set.status = 400;
                return { error: 'Failed to remove bot' };
            }

            return { notebook: updatedNotebook };
        },
        {
            params: t.Object({
                id: t.String(),
                userBotId: t.String(),
            }),
        },
    )

    // Get notebook summary (page counts by type)
    .get(
        '/:id/summary',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const notebook = await findNotebookById(params.id, auth.user._id);
            if (!notebook) {
                set.status = 404;
                return { error: 'Notebook not found' };
            }

            const { countPagesByTypeForNotebook, getTodoStatsForNotebook } =
                await import('../repositories/page.repo');
            const [pageCounts, todoStats] = await Promise.all([
                countPagesByTypeForNotebook(params.id),
                getTodoStatsForNotebook(params.id),
            ]);

            return {
                notebook,
                summary: {
                    pageCounts,
                    totalPages: Object.values(pageCounts).reduce((sum, count) => sum + count, 0),
                    todoStats,
                },
            };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // AI Summarize content using notebook's Claude bot
    .post(
        '/:id/ai-summarize',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const notebook = await findNotebookById(params.id, auth.user._id);
            if (!notebook) {
                set.status = 404;
                return { error: 'Notebook not found' };
            }

            // Find Claude bot shared with this notebook
            const sharedBots = await findUserBotsForNotebook(params.id);
            const claudeBot = sharedBots.find(
                (bot) =>
                    bot.handle?.toLowerCase() === 'claude' ||
                    bot.handle?.toLowerCase() === 'ai' ||
                    bot.templateName?.toLowerCase().includes('claude'),
            );

            if (!claudeBot) {
                set.status = 400;
                return { error: 'No Claude bot configured for this notebook' };
            }

            // Get full bot config including API key
            const userBot = await findUserBotByIdInternal(claudeBot._id);
            if (!userBot?.config?.apiKey) {
                set.status = 400;
                return { error: 'Claude bot API key not configured' };
            }

            // Call Claude API to summarize
            const systemPrompt =
                'You are a helpful assistant that creates brief summaries. ' +
                'Respond with ONLY a short summary (1-2 sentences, max 100 characters). ' +
                'No explanations, no quotes, just the summary text.';

            const userPrompt = `Summarize this ${body.type || 'content'} in one brief sentence:\n\n${body.content}`;

            try {
                const response = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'anthropic-version': '2023-06-01',
                        'x-api-key': userBot.config.apiKey,
                    },
                    body: JSON.stringify({
                        model: 'claude-sonnet-4-20250514',
                        max_tokens: 150,
                        system: systemPrompt,
                        messages: [{ role: 'user', content: userPrompt }],
                    }),
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('[AI Summarize] Claude API error:', response.status, errorText);
                    set.status = 500;
                    return { error: 'Failed to generate summary' };
                }

                const data = (await response.json()) as {
                    content: Array<{ type: string; text?: string }>;
                };
                const textContent = data.content.find((c) => c.type === 'text');
                const summary = textContent?.text?.trim() || '';

                // Truncate to maxLength if specified
                const maxLength = body.maxLength || 256;
                const truncatedSummary = summary.slice(0, maxLength);

                return { summary: truncatedSummary };
            } catch (error) {
                console.error('[AI Summarize] Error:', error);
                set.status = 500;
                return { error: 'Failed to generate summary' };
            }
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                content: t.String(),
                type: t.Optional(t.String()),
                maxLength: t.Optional(t.Number()),
            }),
        },
    );
