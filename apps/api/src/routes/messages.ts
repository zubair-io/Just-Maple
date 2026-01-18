import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import {
    findNotebookById,
    findNotebooksByUserId,
    findNotebookByIdWithAccess,
    hasAccess,
    getNotebookMembers,
} from '../repositories/notebook.repo';
import type { JWTPayload, ChatEvent } from '@maple/shared';
import {
    findMessagesByTagId,
    findMessageById,
    createMessage,
    updateMessage,
    softDeleteMessage,
} from '../repositories/message.repo';
import {
    markAsRead,
    getUnreadCountsForUser,
    getUnreadCountForTag,
} from '../repositories/unread.repo';
import { findThreadById } from '../repositories/thread.repo';
import { broadcastChatEvent } from '../services/realtime.service';
import { sendMessageReceivedNotification } from '../services/notification.service';

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

    // Get messages for a notebook (paginated)
    .get(
        '/notebooks/:id/messages',
        async ({ auth, params, query, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            // Verify user has access to this notebook
            const notebook = await findNotebookById(params.id, auth.user._id);
            if (!notebook) {
                set.status = 404;
                return {
                    error: 'Notebook not found',
                    message: 'Notebook does not exist or access denied',
                };
            }

            const messages = await findMessagesByTagId(params.id, {
                limit: query.limit ? parseInt(query.limit) : 50,
                before: query.before,
            });

            return { messages };
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

    // Send a message to a notebook's chat
    .post(
        '/notebooks/:id/messages',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            // Verify user has write access to this notebook
            const notebook = await findNotebookByIdWithAccess(params.id, auth.user._id, 'write');
            if (!notebook) {
                set.status = 403;
                return {
                    error: 'Forbidden',
                    message: 'You do not have write access to this notebook',
                };
            }

            // Handle thread creation if replying to a parent message
            let threadId = body.threadId;
            let parentMessageId: string | undefined;

            if (body.parentMessageId) {
                // User is replying to a message - get or create thread
                const { getOrCreateThread } = await import('../repositories/thread.repo');
                const { markMessageHasThread } = await import('../repositories/message.repo');
                const thread = await getOrCreateThread({
                    parentMessageId: body.parentMessageId,
                    tagId: params.id,
                });
                threadId = thread._id;
                parentMessageId = body.parentMessageId;

                // Mark the parent message as having a thread
                await markMessageHasThread(body.parentMessageId);
            } else if (body.threadId) {
                // Message is being added to existing thread
                const thread = await findThreadById(body.threadId);
                parentMessageId = thread?.parentMessageId;
            }

            const message = await createMessage(
                params.id,
                auth.user._id,
                body,
                auth.user.email,
                auth.user.displayName,
                auth.user.profilePictureUrl,
                threadId,
            );

            // Broadcast message via realtime service
            // Use different action for thread messages vs top-level messages
            const chatEvent: ChatEvent = {
                action: threadId ? 'thread_message' : 'message',
                data: threadId ? { message, parentMessageId } : message,
                tagId: params.id,
                userId: auth.user._id,
                timestamp: new Date().toISOString(),
            };
            broadcastChatEvent(params.id, chatEvent).catch(console.error);

            // If we created/updated a thread, broadcast that the parent has a thread
            if (parentMessageId && body.parentMessageId) {
                const threadFlagEvent: ChatEvent = {
                    action: 'message_updated',
                    data: { _id: parentMessageId, hasThread: true },
                    tagId: params.id,
                    userId: auth.user._id,
                    timestamp: new Date().toISOString(),
                };
                broadcastChatEvent(params.id, threadFlagEvent).catch(console.error);
            }

            // Send push notifications to all tag members except the author
            const tagMembers = await getNotebookMembers(params.id, auth.user._id);
            if (tagMembers) {
                // Send notification to each member except the message author
                const notificationPromises = tagMembers
                    .filter((member) => member.userId !== auth.user._id)
                    .map((member) =>
                        sendMessageReceivedNotification(
                            member.userId,
                            params.id,
                            message._id,
                            auth.user.email,
                            auth.user.displayName, // Pass sender's display name
                            auth.user.profilePictureUrl, // Pass sender's profile picture
                            message.content, // Pass actual message content
                        ),
                    );

                // Send all notifications in parallel, but don't wait for them
                Promise.allSettled(notificationPromises).catch(console.error);
            }

            return { message };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                content: t.Any(), // TipTap JSON content
                threadId: t.Optional(t.String()), // If continuing an existing thread
                parentMessageId: t.Optional(t.String()), // If starting a new thread (first reply)
            }),
        },
    )

    // Mark notebook as read
    .post(
        '/notebooks/:id/read',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            // Verify user has access to this notebook
            const notebook = await findNotebookById(params.id, auth.user._id);
            if (!notebook) {
                set.status = 404;
                return {
                    error: 'Notebook not found',
                    message: 'Notebook does not exist or access denied',
                };
            }

            const tracking = await markAsRead(auth.user._id, params.id);

            return { lastReadAt: tracking.lastReadAt };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    )

    // Get unread count for a specific notebook
    .get(
        '/notebooks/:id/unread',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            // Verify user has access to this notebook
            const notebook = await findNotebookById(params.id, auth.user._id);
            if (!notebook) {
                set.status = 404;
                return {
                    error: 'Notebook not found',
                    message: 'Notebook does not exist or access denied',
                };
            }

            const count = await getUnreadCountForTag(auth.user._id, params.id);

            return { tagId: params.id, count };
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

        // Get all user's tags
        const tags = await findNotebooksByUserId(auth.user._id);
        const tagIds = tags.map((t) => t._id);

        const counts = await getUnreadCountsForUser(auth.user._id, tagIds);

        return { counts };
    })

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
                tagId: message.tagId,
                userId: auth.user._id,
                timestamp: new Date().toISOString(),
            };
            broadcastChatEvent(message.tagId, chatEvent).catch(console.error);

            return { message };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
            body: t.Object({
                content: t.Any(), // TipTap JSON content
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

            // Get message first to know tagId for broadcasting (verify user has access)
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

            // Broadcast deletion via realtime service
            const chatEvent: ChatEvent = {
                action: 'deleted',
                data: { _id: params.id },
                tagId: existingMessage.tagId,
                userId: auth.user._id,
                timestamp: new Date().toISOString(),
            };
            broadcastChatEvent(existingMessage.tagId, chatEvent).catch(console.error);

            return { message: 'Message deleted' };
        },
        {
            params: t.Object({
                id: t.String(),
            }),
        },
    );
