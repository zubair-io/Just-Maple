import { Elysia, t } from 'elysia';
import { jwtPlugin, checkAuth, type AuthContext } from '../middleware/auth';
import { findUserById } from '../repositories/user.repo';
import { findTagById, findTagsByUserId, findTagByIdWithAccess, hasAccess } from '../repositories/tag.repo';
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
import { broadcastChatEvent } from '../services/realtime.service';

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

    // Get messages for a tag (paginated)
    .get(
        '/tags/:id/messages',
        async ({ auth, params, query, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            // Verify user has access to this tag
            const tag = await findTagById(params.id, auth.user._id);
            if (!tag) {
                set.status = 404;
                return { error: 'Tag not found', message: 'Tag does not exist or access denied' };
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

    // Send a message to a tag's chat
    .post(
        '/tags/:id/messages',
        async ({ auth, params, body, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            // Verify user has write access to this tag
            const tag = await findTagByIdWithAccess(params.id, auth.user._id, 'write');
            if (!tag) {
                set.status = 403;
                return { error: 'Forbidden', message: 'You do not have write access to this tag' };
            }

            const message = await createMessage(params.id, auth.user._id, body, auth.user.email);

            // Broadcast message via realtime service
            const chatEvent: ChatEvent = {
                action: 'message',
                data: message,
                tagId: params.id,
                userId: auth.user._id,
                timestamp: new Date().toISOString(),
            };
            broadcastChatEvent(params.id, chatEvent).catch(console.error);

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

    // Mark tag as read
    .post(
        '/tags/:id/read',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            // Verify user has access to this tag
            const tag = await findTagById(params.id, auth.user._id);
            if (!tag) {
                set.status = 404;
                return { error: 'Tag not found', message: 'Tag does not exist or access denied' };
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

    // Get unread count for a specific tag
    .get(
        '/tags/:id/unread',
        async ({ auth, params, set }) => {
            if (!checkAuth(auth, set)) {
                return { error: 'Unauthorized', message: 'Valid authentication required' };
            }

            // Verify user has access to this tag
            const tag = await findTagById(params.id, auth.user._id);
            if (!tag) {
                set.status = 404;
                return { error: 'Tag not found', message: 'Tag does not exist or access denied' };
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
        const tags = await findTagsByUserId(auth.user._id);
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
                return { error: 'Message not found', message: 'Message does not exist or access denied' };
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
                return { error: 'Message not found', message: 'Message does not exist or access denied' };
            }

            const deleted = await softDeleteMessage(params.id, auth.user._id);

            if (!deleted) {
                set.status = 404;
                return { error: 'Message not found', message: 'Message does not exist or access denied' };
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
