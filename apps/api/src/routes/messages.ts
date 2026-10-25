import { ObjectId } from 'mongodb';
import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import {
    findNotebookById,
    findNotebooksByUserId,
    findNotebookByIdWithAccess,
    getNotebookMembers,
} from '../repositories/notebook.repo';
import {
    findPageById,
    findOrCreateMessagesPage,
    findMessagesPageByNotebookId,
} from '../repositories/page.repo';
import type { JWTPayload, ChatEvent } from '@maple/shared';
import {
    findMessagesByPageId,
    findMessageById,
    findMessageByMongoId,
    createMessage,
    updateMessage,
    softDeleteMessage,
} from '../repositories/message.repo';
import {
    getUnreadCountsForUserByPageIds,
    getUnreadCountForPage,
} from '../repositories/unread.repo';
import { findThreadById } from '../repositories/thread.repo';
import { broadcastChatEvent } from '../services/realtime.service';
import { markChatAsRead, sendMessageReceivedNotification } from '../services/notification.service';
import { maybeAutoReply } from '../services/proactive-bot.service';
import { findPageByIdForBot } from '../repositories/page.repo';

export const messageRoutes = new Elysia({ prefix: '/api' })
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
    // Page-based message routes (new)
    // ============================================

    // Get messages for a page (paginated)
    .get(
        '/pages/:id/messages',
        async ({ auth, params, query, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            // Verify user has access to this page
            const page = await findPageById(params.id, auth.user._id);
            if (!page) {
                set.status = 404;
                return {
                    error: 'Page not found',
                    message: 'Page does not exist or access denied',
                };
            }

            if (page.type !== 'message') {
                set.status = 400;
                return {
                    error: 'Invalid page type',
                    message: 'This page is not a messages page',
                };
            }

            const messages = await findMessagesByPageId(params.id, {
                limit: query.limit ? parseInt(query.limit) : 50,
                before: query.before,
            });

            return { messages, page };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            query: t.Object({
                limit: t.Optional(t.String()),
                before: t.Optional(t.String()),
            }),
        },
    )

    // Send a message to a page
    .post(
        '/pages/:id/messages',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            // Verify user has access to this page
            const page = await findPageById(params.id, auth.user._id);
            if (!page) {
                set.status = 404;
                return {
                    error: 'Page not found',
                    message: 'Page does not exist or access denied',
                };
            }

            if (page.type !== 'message') {
                set.status = 400;
                return {
                    error: 'Invalid page type',
                    message: 'This page is not a messages page',
                };
            }

            // Verify write access via notebook
            if (page.notebookId) {
                const notebook = await findNotebookByIdWithAccess(
                    page.notebookId,
                    auth.user._id,
                    'write',
                );
                if (!notebook) {
                    set.status = 403;
                    return {
                        error: 'Forbidden',
                        message: 'You do not have write access to this notebook',
                    };
                }
            }

            // Handle thread creation if replying to a parent message
            let threadId = body.threadId;
            let parentMessageId: string | undefined;

            if (body.parentMessageId) {
                // A thread reply must answer a message in this same notebook.
                if (!(await isMessageInNotebook(body.parentMessageId, page.notebookId))) {
                    set.status = 400;
                    return {
                        error: 'Bad request',
                        message: 'Parent message is not in this notebook',
                    };
                }
                const { getOrCreateThread } = await import('../repositories/thread.repo');
                const { markMessageHasThread } = await import('../repositories/message.repo');
                const thread = await getOrCreateThread({
                    parentMessageId: body.parentMessageId,
                    notebookId: page.notebookId || '',
                });
                threadId = thread._id;
                parentMessageId = body.parentMessageId;
                await markMessageHasThread(body.parentMessageId);
            } else if (body.threadId) {
                const thread = await findThreadById(body.threadId);
                parentMessageId = thread?.parentMessageId;
            }

            const message = await createMessage(
                params.id, // pageId
                auth.user._id,
                body,
                auth.user.email,
                auth.user.displayName,
                auth.user.profilePictureUrl,
                threadId,
                page.notebookId, // notebookId for backward compatibility
            );

            // Broadcast message via realtime service
            const chatEvent: ChatEvent = {
                action: threadId ? 'thread_message' : 'message',
                data: threadId ? { message, parentMessageId } : message,
                pageId: params.id,
                notebookId: page.notebookId,
                userId: auth.user._id,
                timestamp: new Date().toISOString(),
            };

            if (page.notebookId) {
                broadcastChatEvent(page.notebookId, chatEvent).catch(console.error);
            }

            // Broadcast thread flag update
            if (parentMessageId && body.parentMessageId && page.notebookId) {
                const threadFlagEvent: ChatEvent = {
                    action: 'message_updated',
                    data: { id: parentMessageId, hasThread: true },
                    pageId: params.id,
                    notebookId: page.notebookId,
                    userId: auth.user._id,
                    timestamp: new Date().toISOString(),
                };
                broadcastChatEvent(page.notebookId, threadFlagEvent).catch(console.error);
            }

            // A proactive bot answers messages in its page without an @mention.
            if (page.proactive?.enabled) {
                maybeAutoReply({
                    page,
                    message,
                    userId: auth.user._id,
                    parentMessageId,
                }).catch((error) => console.error('[Proactive] Auto-reply failed:', error));
            }

            // Send push notifications
            if (page.notebookId) {
                const tagMembers = await getNotebookMembers(page.notebookId, auth.user._id);
                if (tagMembers) {
                    const notificationPromises = tagMembers
                        .filter((member) => member.userId !== auth.user._id)
                        .map((member) =>
                            sendMessageReceivedNotification(
                                member.userId,
                                page.notebookId!,
                                page.id,
                                message._id,
                                auth.user.email,
                                auth.user.displayName,
                                auth.user.profilePictureUrl,
                                message.content,
                            ),
                        );
                    Promise.allSettled(notificationPromises).catch(console.error);
                }
            }

            return { message };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                content: t.Any(),
                threadId: t.Optional(t.String()),
                parentMessageId: t.Optional(t.String()),
            }),
        },
    )

    // Mark page as read
    .post(
        '/pages/:id/read',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const page = await findPageById(params.id, auth.user._id);
            if (!page) {
                set.status = 404;
                return {
                    error: 'Page not found',
                    message: 'Page does not exist or access denied',
                };
            }

            const { lastReadAt, unreadNotificationCount } = await markChatAsRead(auth.user._id, {
                pageId: params.id,
                notebookId: page.notebookId,
            });

            return { lastReadAt, pageId: params.id, unreadNotificationCount };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Get unread count for a specific page
    .get(
        '/pages/:id/unread',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const page = await findPageById(params.id, auth.user._id);
            if (!page) {
                set.status = 404;
                return {
                    error: 'Page not found',
                    message: 'Page does not exist or access denied',
                };
            }

            const count = await getUnreadCountForPage(auth.user._id, params.id);

            return { pageId: params.id, notebookId: page.notebookId, count };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // ============================================
    // Notebook-based routes (for backward compatibility)
    // These routes find/create the messages page for a notebook
    // ============================================

    // Get messages for a notebook (finds messages page automatically)
    .get(
        '/notebooks/:id/messages',
        async ({ auth, params, query, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const notebook = await findNotebookById(params.id, auth.user._id);
            if (!notebook) {
                set.status = 404;
                return {
                    error: 'Notebook not found',
                    message: 'Notebook does not exist or access denied',
                };
            }

            // Find or create the messages page for this notebook
            const messagesPage = await findOrCreateMessagesPage(params.id, auth.user._id);

            const messages = await findMessagesByPageId(messagesPage.id, {
                limit: query.limit ? parseInt(query.limit) : 50,
                before: query.before,
            });

            return { messages, page: messagesPage };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            query: t.Object({
                limit: t.Optional(t.String()),
                before: t.Optional(t.String()),
            }),
        },
    )

    // Send a message to a notebook's chat (finds/creates messages page)
    .post(
        '/notebooks/:id/messages',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const notebook = await findNotebookByIdWithAccess(params.id, auth.user._id, 'write');
            if (!notebook) {
                set.status = 403;
                return {
                    error: 'Forbidden',
                    message: 'You do not have write access to this notebook',
                };
            }

            // Find or create the messages page for this notebook
            const messagesPage = await findOrCreateMessagesPage(params.id, auth.user._id);

            // Handle thread creation
            let threadId = body.threadId;
            let parentMessageId: string | undefined;

            if (body.parentMessageId) {
                // A thread reply must answer a message in this same notebook.
                if (!(await isMessageInNotebook(body.parentMessageId, params.id))) {
                    set.status = 400;
                    return {
                        error: 'Bad request',
                        message: 'Parent message is not in this notebook',
                    };
                }
                const { getOrCreateThread } = await import('../repositories/thread.repo');
                const { markMessageHasThread } = await import('../repositories/message.repo');
                const thread = await getOrCreateThread({
                    parentMessageId: body.parentMessageId,
                    notebookId: params.id,
                });
                threadId = thread._id;
                parentMessageId = body.parentMessageId;
                await markMessageHasThread(body.parentMessageId);
            } else if (body.threadId) {
                const thread = await findThreadById(body.threadId);
                parentMessageId = thread?.parentMessageId;
            }

            const message = await createMessage(
                messagesPage.id, // pageId
                auth.user._id,
                body,
                auth.user.email,
                auth.user.displayName,
                auth.user.profilePictureUrl,
                threadId,
                params.id, // notebookId
            );

            // Broadcast message
            const chatEvent: ChatEvent = {
                action: threadId ? 'thread_message' : 'message',
                data: threadId ? { message, parentMessageId } : message,
                pageId: messagesPage.id,
                notebookId: params.id,
                userId: auth.user._id,
                timestamp: new Date().toISOString(),
            };
            broadcastChatEvent(params.id, chatEvent).catch(console.error);

            // A proactive bot answers messages in its chat without an @mention.
            if (messagesPage.proactive?.enabled) {
                maybeAutoReply({
                    page: messagesPage,
                    message,
                    userId: auth.user._id,
                    parentMessageId,
                }).catch((error) => console.error('[Proactive] Auto-reply failed:', error));
            }

            if (parentMessageId && body.parentMessageId) {
                const threadFlagEvent: ChatEvent = {
                    action: 'message_updated',
                    data: { id: parentMessageId, hasThread: true },
                    pageId: messagesPage.id,
                    notebookId: params.id,
                    userId: auth.user._id,
                    timestamp: new Date().toISOString(),
                };
                broadcastChatEvent(params.id, threadFlagEvent).catch(console.error);
            }

            // Send notifications
            const tagMembers = await getNotebookMembers(params.id, auth.user._id);
            if (tagMembers) {
                const notificationPromises = tagMembers
                    .filter((member) => member.userId !== auth.user._id)
                    .map((member) =>
                        sendMessageReceivedNotification(
                            member.userId,
                            params.id,
                            messagesPage.id,
                            message._id,
                            auth.user.email,
                            auth.user.displayName,
                            auth.user.profilePictureUrl,
                            message.content,
                        ),
                    );
                Promise.allSettled(notificationPromises).catch(console.error);
            }

            return { message, page: messagesPage };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                content: t.Any(),
                threadId: t.Optional(t.String()),
                parentMessageId: t.Optional(t.String()),
            }),
        },
    )

    // Mark notebook as read (finds messages page)
    .post(
        '/notebooks/:id/read',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const notebook = await findNotebookById(params.id, auth.user._id);
            if (!notebook) {
                set.status = 404;
                return {
                    error: 'Notebook not found',
                    message: 'Notebook does not exist or access denied',
                };
            }

            const messagesPage = await findMessagesPageByNotebookId(params.id);
            if (!messagesPage) {
                // No messages page yet, nothing to mark as read
                return { lastReadAt: new Date().toISOString() };
            }

            const { lastReadAt, unreadNotificationCount } = await markChatAsRead(auth.user._id, {
                pageId: messagesPage.id,
                notebookId: params.id,
            });

            return { lastReadAt, pageId: messagesPage.id, unreadNotificationCount };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Get unread count for a notebook (finds messages page)
    .get(
        '/notebooks/:id/unread',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const notebook = await findNotebookById(params.id, auth.user._id);
            if (!notebook) {
                set.status = 404;
                return {
                    error: 'Notebook not found',
                    message: 'Notebook does not exist or access denied',
                };
            }

            const messagesPage = await findMessagesPageByNotebookId(params.id);
            if (!messagesPage) {
                return { notebookId: params.id, pageId: null, count: 0 };
            }

            const count = await getUnreadCountForPage(auth.user._id, messagesPage.id);

            return { notebookId: params.id, pageId: messagesPage.id, count };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Get all unread counts for user
    .get('/unread', async ({ auth, set }) => {
        if (!checkAuth(auth, set)) {
            return { error: 'Unauthorized', message: 'Valid authentication required' };
        }

        // Get all user's notebooks
        const notebooks = await findNotebooksByUserId(auth.user._id);

        // Find messages pages for all notebooks
        const pagePromises = notebooks.map(async (notebook) => {
            const page = await findMessagesPageByNotebookId(notebook._id);
            return page ? { pageId: page.id, notebookId: notebook._id } : null;
        });

        const pageResults = await Promise.all(pagePromises);
        const validPages = pageResults.filter((p) => p !== null) as {
            pageId: string;
            notebookId: string;
        }[];

        const pageIds = validPages.map((p) => p.pageId);
        const counts = await getUnreadCountsForUserByPageIds(auth.user._id, pageIds);

        // Map counts back to include notebookId for convenience
        const countsWithNotebook = counts.map((c) => {
            const pageInfo = validPages.find((p) => p.pageId === c.pageId);
            return {
                ...c,
                notebookId: pageInfo?.notebookId,
            };
        });

        return { counts: countsWithNotebook };
    })

    // ============================================
    // Message operations (work with pageId)
    // ============================================

    // Edit a message
    .put(
        '/messages/:id',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const message = await updateMessage(params.id, auth.user._id, body);

            if (!message) {
                set.status = 404;
                return {
                    error: 'Message not found',
                    message: 'Message does not exist or access denied',
                };
            }

            // Broadcast edit via realtime service
            const chatEvent: ChatEvent = {
                action: 'edited',
                data: message,
                pageId: message.pageId,
                notebookId: message.notebookId,
                userId: auth.user._id,
                timestamp: new Date().toISOString(),
            };

            if (message.notebookId) {
                broadcastChatEvent(message.notebookId, chatEvent).catch(console.error);
            }

            return { message };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                content: t.Any(),
            }),
        },
    )

    // Delete a message (soft delete)
    .delete(
        '/messages/:id',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            const existingMessage = await findMessageById(params.id, auth.user._id);
            if (!existingMessage) {
                set.status = 404;
                return {
                    error: 'Message not found',
                    message: 'Message does not exist or access denied',
                };
            }

            const deleted = await softDeleteMessage(params.id, auth.user._id);

            if (!deleted) {
                set.status = 404;
                return {
                    error: 'Message not found',
                    message: 'Message does not exist or access denied',
                };
            }

            // Broadcast deletion
            const chatEvent: ChatEvent = {
                action: 'deleted',
                data: { id: params.id },
                pageId: existingMessage.pageId,
                notebookId: existingMessage.notebookId,
                userId: auth.user._id,
                timestamp: new Date().toISOString(),
            };

            if (existingMessage.notebookId) {
                broadcastChatEvent(existingMessage.notebookId, chatEvent).catch(console.error);
            }

            return { message: 'Message deleted' };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    );

/** True when the message exists and belongs to `notebookId`. */
async function isMessageInNotebook(
    messageId: string,
    notebookId: string | undefined,
): Promise<boolean> {
    if (!notebookId) return false;
    // Parents can be referenced by message id or, for older messages, by Mongo _id.
    const message =
        (await findMessageById(messageId)) ??
        (ObjectId.isValid(messageId) ? await findMessageByMongoId(messageId) : null);
    if (!message) return false;
    if (message.notebookId) return message.notebookId === notebookId;
    // Older messages only record their page.
    const page = await findPageByIdForBot(message.pageId);
    return page?.notebookId === notebookId;
}
