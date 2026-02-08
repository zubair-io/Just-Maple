import { Elysia, t } from 'elysia';
import {
    type BotAuthContext,
    checkBotAuth,
    checkBotPermission,
    checkBotNotebookAccess,
} from '../../middleware/bot-auth';
import {
    findMessagesByPageId,
    findMessagesByThreadId,
    createMessageInThread,
    createMessage,
    findMessageById,
    markMessageHasThread,
} from '../../repositories/message.repo';
import {
    getOrCreateThread,
    findThreadByParentMessage,
    incrementThreadMessageCount,
} from '../../repositories/thread.repo';
import { findPageByIdForBot } from '../../repositories/page.repo';
import { findUserBotByIdInternal, isBotSharedWithNotebook } from '../../repositories/user-bot.repo';
import {
    findInvocationsBySourceMessage,
    updateInvocationStatus,
} from '../../repositories/bot-invocation.repo';
import { broadcastChatEvent } from '../../services/realtime.service';
import { markdownToProseMirror } from '../../utils/markdown-to-prosemirror';
import { verifyBotJWT } from '../../services/bot-jwt.service';
import { verifyToken } from '../../repositories/bot-token.repo';
import type { PageContent } from '@maple/shared';

/**
 * Bot Messages API
 *
 * API endpoints for custom bots to read and write messages.
 * Requires bot JWT authentication.
 */
export const botMessagesRoutes = new Elysia({ prefix: '/api/bots' })
    // Inline bot auth - derive context for all routes
    .derive(async ({ request }) => {
        console.log('[BotMessages] Auth derive called for:', request.url);
        const authHeader = request.headers.get('authorization');
        const hasAuthHeader = !!authHeader;
        console.log('[BotMessages] Auth header present:', hasAuthHeader);

        if (!authHeader?.startsWith('Bearer ')) {
            console.log('[BotMessages] No Bearer token found');
            return { botAuth: null as BotAuthContext | null };
        }

        const bearerToken = authHeader.slice(7);
        console.log('[BotMessages] Bearer token present:', !!bearerToken);

        try {
            // Try JWT first (custom bots)
            console.log('[BotMessages] Verifying bot JWT...');
            const jwtPayload = await verifyBotJWT(bearerToken);

            if (jwtPayload) {
                console.log(`[BotMessages] JWT valid for bot ${jwtPayload.sub}`);

                // Zero DB lookups — permissions are embedded in the JWT
                return {
                    botAuth: {
                        authType: 'jwt',
                        jwtPayload,
                        userBotId: jwtPayload.sub,
                        userId: jwtPayload.userId,
                        permissions: jwtPayload.permissions,
                    } as BotAuthContext,
                };
            }

            // Fall back to access token (template bots)
            console.log('[BotMessages] JWT verification failed, trying access token...');
            const token = await verifyToken(bearerToken);

            if (!token) {
                console.log('[BotMessages] Access token verification also failed');
                return { botAuth: null as BotAuthContext | null };
            }

            console.log(`[BotMessages] Access token valid for bot ${token.userBotId}`);
            return {
                botAuth: {
                    authType: 'token',
                    token,
                    userBotId: token.userBotId,
                    userId: token.userId,
                } as BotAuthContext,
            };
        } catch (error) {
            console.error('[BotMessages] Error during authentication:', error);
            return { botAuth: null as BotAuthContext | null };
        }
    })

    // Get messages for a page
    .get(
        '/pages/:pageId/messages',
        async ({ botAuth, params, query, set }) => {
            if (!checkBotAuth(botAuth, set)) {
                return { error: 'auth/missing_token', message: 'Bot authentication required' };
            }

            if (!checkBotPermission(botAuth, 'read', set)) {
                return {
                    error: 'auth/insufficient_permissions',
                    message: 'Read permission required',
                };
            }

            // Get page to find notebook
            const page = await findPageByIdForBot(params.pageId);
            if (!page) {
                set.status = 404;
                return { error: 'resource/not_found', message: 'Page not found' };
            }

            // Check notebook access
            const notebookId = page.tagId || page.notebookId;
            if (!notebookId || !(await checkBotNotebookAccess(botAuth, notebookId, set))) {
                return {
                    error: 'auth/insufficient_permissions',
                    message: 'Bot cannot access this notebook',
                };
            }

            const messages = await findMessagesByPageId(params.pageId, {
                limit: query.limit || 50,
                before: query.before,
            });

            return {
                messages: messages.map((m) => ({
                    id: m.id || m._id,
                    page_id: m.pageId,
                    thread_id: m.threadId,
                    author: {
                        id: m.userId,
                        name: m.senderDisplayName || m.senderEmail || 'Unknown',
                        type: m.senderType || 'user',
                    },
                    content: extractText(m.content as PageContent),
                    content_json: m.content,
                    has_thread: m.hasThread,
                    created_at: m.createdAt,
                })),
            };
        },
        {
            params: t.Object({
                pageId: t.String(),
            }),
            query: t.Object({
                limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
                before: t.Optional(t.String()),
            }),
        },
    )

    // Get thread messages
    .get(
        '/threads/:threadId',
        async ({ botAuth, params, query, set }) => {
            if (!checkBotAuth(botAuth, set)) {
                return { error: 'auth/missing_token', message: 'Bot authentication required' };
            }

            if (!checkBotPermission(botAuth, 'read', set)) {
                return {
                    error: 'auth/insufficient_permissions',
                    message: 'Read permission required',
                };
            }

            const messages = await findMessagesByThreadId(params.threadId, {
                limit: query.limit || 50,
                before: query.before,
            });

            if (messages.length === 0) {
                set.status = 404;
                return { error: 'resource/not_found', message: 'Thread not found or empty' };
            }

            // Get the first message to check notebook access
            const page = await findPageByIdForBot(messages[0].pageId);
            if (page) {
                const notebookId = page.tagId || page.notebookId;
                if (notebookId && !(await checkBotNotebookAccess(botAuth, notebookId, set))) {
                    return {
                        error: 'auth/insufficient_permissions',
                        message: 'Bot cannot access this notebook',
                    };
                }
            }

            return {
                thread_id: params.threadId,
                messages: messages.map((m) => ({
                    id: m.id || m._id,
                    page_id: m.pageId,
                    author: {
                        id: m.userId,
                        name: m.senderDisplayName || m.senderEmail || 'Unknown',
                        type: m.senderType || 'user',
                    },
                    content: extractText(m.content as PageContent),
                    content_json: m.content,
                    created_at: m.createdAt,
                })),
            };
        },
        {
            params: t.Object({
                threadId: t.String(),
            }),
            query: t.Object({
                limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
                before: t.Optional(t.String()),
            }),
        },
    )

    // Reply to a thread (or create thread from a message)
    .post(
        '/threads/:parentMessageId/reply',
        async ({ botAuth, params, body, set }) => {
            console.log(`[BotMessages] POST /threads/${params.parentMessageId}/reply`);
            console.log(
                `[BotMessages] botAuth:`,
                botAuth ? `authType=${botAuth.authType}` : 'null',
            );

            if (!checkBotAuth(botAuth, set)) {
                return { error: 'auth/missing_token', message: 'Bot authentication required' };
            }

            if (!checkBotPermission(botAuth, 'write', set)) {
                return {
                    error: 'auth/insufficient_permissions',
                    message: 'Write permission required',
                };
            }

            // Get parent message
            const parentMessage = await findMessageById(params.parentMessageId);
            if (!parentMessage) {
                set.status = 404;
                return { error: 'resource/not_found', message: 'Parent message not found' };
            }

            // Get page to find notebook
            const page = await findPageByIdForBot(parentMessage.pageId);
            if (!page) {
                set.status = 404;
                return { error: 'resource/not_found', message: 'Page not found' };
            }

            const notebookId = page.tagId || page.notebookId;
            if (!notebookId || !(await checkBotNotebookAccess(botAuth, notebookId, set))) {
                return {
                    error: 'auth/insufficient_permissions',
                    message: 'Bot cannot access this notebook',
                };
            }

            // Get bot info
            const userBot = await findUserBotByIdInternal(botAuth.userBotId);
            if (!userBot) {
                set.status = 500;
                return { error: 'server/bot_not_found', message: 'Bot configuration not found' };
            }

            // Convert content to ProseMirror format if needed
            let content: PageContent;
            if (body.content_type === 'prosemirror') {
                content = body.content as unknown as PageContent;
            } else {
                // Convert plain text/markdown to ProseMirror
                content = markdownToProseMirror(body.content);
            }

            // Get or create thread
            const thread = await getOrCreateThread({
                parentMessageId: params.parentMessageId,
                notebookId,
            });

            // Mark parent as having a thread (if not already)
            if (!parentMessage.hasThread) {
                await markMessageHasThread(params.parentMessageId);
            }

            // Create the message in the thread
            const message = await createMessageInThread({
                pageId: parentMessage.pageId,
                threadId: thread._id,
                userId: botAuth.userId,
                userBotId: botAuth.userBotId,
                senderType: 'bot',
                senderDisplayName: userBot.displayName || userBot.handle,
                senderProfilePictureUrl: userBot.avatar,
                content,
            });

            // Increment thread message count
            await incrementThreadMessageCount(thread._id);

            // Mark any pending invocations as completed
            const pendingInvocations = await findInvocationsBySourceMessage(params.parentMessageId);
            for (const inv of pendingInvocations) {
                if (inv.status === 'running' || inv.status === 'pending') {
                    await updateInvocationStatus(inv._id, 'completed', {
                        responseMessageId: message._id,
                        threadId: thread._id,
                    });
                    // Broadcast bot_invocation_completed
                    broadcastChatEvent(notebookId, {
                        action: 'bot_invocation_completed',
                        data: {
                            invocationId: inv._id,
                            sourceId: inv.sourceId,
                        },
                        pageId: parentMessage.pageId,
                        notebookId: notebookId,
                        userId: botAuth.userId,
                        timestamp: new Date().toISOString(),
                    });
                }
            }

            // Broadcast the message
            broadcastChatEvent(notebookId, {
                action: 'thread_message',
                data: {
                    message: {
                        _id: message._id,
                        id: message.id,
                        pageId: message.pageId,
                        threadId: thread._id,
                        userId: message.userId,
                        senderType: 'bot',
                        senderDisplayName: userBot.displayName || userBot.handle,
                        senderProfilePictureUrl: userBot.avatar,
                        content: message.content,
                        createdAt: message.createdAt,
                    },
                    parentMessageId: params.parentMessageId,
                },
                pageId: parentMessage.pageId,
                notebookId: notebookId,
                userId: botAuth.userId,
                timestamp: new Date().toISOString(),
            });

            return {
                message_id: message.id || message._id,
                thread_id: thread._id,
                created_at: message.createdAt,
            };
        },
        {
            params: t.Object({
                parentMessageId: t.String(),
            }),
            body: t.Object({
                content: t.Union([t.String(), t.Record(t.String(), t.Any())]),
                content_type: t.Optional(t.Union([t.Literal('text'), t.Literal('prosemirror')])),
            }),
        },
    )

    // Create a new message (start a new conversation)
    .post(
        '/pages/:pageId/messages',
        async ({ botAuth, params, body, set }) => {
            if (!checkBotAuth(botAuth, set)) {
                return { error: 'auth/missing_token', message: 'Bot authentication required' };
            }

            if (!checkBotPermission(botAuth, 'write', set)) {
                return {
                    error: 'auth/insufficient_permissions',
                    message: 'Write permission required',
                };
            }

            // Get page to find notebook
            const page = await findPageByIdForBot(params.pageId);
            if (!page) {
                set.status = 404;
                return { error: 'resource/not_found', message: 'Page not found' };
            }

            const notebookId = page.tagId || page.notebookId;
            if (!notebookId || !(await checkBotNotebookAccess(botAuth, notebookId, set))) {
                return {
                    error: 'auth/insufficient_permissions',
                    message: 'Bot cannot access this notebook',
                };
            }

            // Get bot info
            const userBot = await findUserBotByIdInternal(botAuth.userBotId);
            if (!userBot) {
                set.status = 500;
                return { error: 'server/bot_not_found', message: 'Bot configuration not found' };
            }

            // Convert content to ProseMirror format if needed
            let content: PageContent;
            if (body.content_type === 'prosemirror') {
                content = body.content as unknown as PageContent;
            } else {
                // Convert plain text/markdown to ProseMirror
                content = markdownToProseMirror(body.content);
            }

            // Create the message
            const message = await createMessage(
                params.pageId,
                botAuth.userId,
                { content },
                undefined, // senderEmail
                userBot.displayName || userBot.handle,
                userBot.avatar,
                undefined, // threadId
                notebookId,
            );

            // Update senderType and bot sender info
            // Note: createMessage doesn't support senderType directly, so we need to update
            const { getDb } = await import('../../db/client');
            const { ObjectId } = await import('mongodb');
            await getDb()
                .collection('messages')
                .updateOne(
                    { _id: new ObjectId(message._id) },
                    {
                        $set: {
                            senderType: 'bot',
                            userBotId: new ObjectId(botAuth.userBotId),
                            senderDisplayName: userBot.displayName || userBot.handle,
                            senderProfilePictureUrl: userBot.avatar,
                        },
                    },
                );

            // Broadcast the message
            broadcastChatEvent(notebookId, {
                action: 'message',
                data: {
                    _id: message._id,
                    id: message.id,
                    pageId: params.pageId,
                    userId: botAuth.userId,
                    senderType: 'bot',
                    senderDisplayName: userBot.displayName || userBot.handle,
                    senderProfilePictureUrl: userBot.avatar,
                    content: message.content,
                    createdAt: message.createdAt,
                },
                pageId: params.pageId,
                notebookId: notebookId,
                userId: botAuth.userId,
                timestamp: new Date().toISOString(),
            });

            return {
                message_id: message.id || message._id,
                page_id: params.pageId,
                created_at: message.createdAt,
            };
        },
        {
            params: t.Object({
                pageId: t.String(),
            }),
            body: t.Object({
                content: t.Union([t.String(), t.Record(t.String(), t.Any())]),
                content_type: t.Optional(t.Union([t.Literal('text'), t.Literal('prosemirror')])),
            }),
        },
    );

/**
 * Extract plain text from ProseMirror content
 */
function extractText(content: PageContent): string {
    if (!content || typeof content !== 'object') {
        return '';
    }

    const traverse = (node: any): string => {
        if (!node) return '';

        if (node.type === 'text' && typeof node.text === 'string') {
            return node.text;
        }

        if (node.type === 'mention' && node.attrs?.handle) {
            return `@${node.attrs.handle}`;
        }

        if (Array.isArray(node.content)) {
            return node.content.map(traverse).join('');
        }

        return '';
    };

    return traverse(content);
}
